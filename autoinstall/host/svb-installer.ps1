# Installs dist/custom.js and dist/svb-folder.html into every Vivaldi version
# folder that is missing them or has an outdated copy, and injects the
# <script src="custom.js"> tag into window.html.
#
# Two modes:
#   - Native messaging host: Vivaldi starts it (via svb-installer.bat) when the
#     companion extension calls chrome.runtime.sendNativeMessage. Vivaldi passes
#     the caller origin (chrome-extension://...) as the first argument, and the
#     request/response are length-prefixed JSON on stdin/stdout.
#   - Command line: run it directly to install and print a summary.
#
# Overrides (used by tests): SVB_VIVALDI_APP_DIR, SVB_DIST_DIR, SVB_RUNNING_VERSION.

$ErrorActionPreference = 'Stop'

$ScriptTag = '<script src="custom.js"></script>'
$ModFiles = @('custom.js', 'svb-folder.html')
$LogDir = Join-Path $env:LOCALAPPDATA 'SvbTreeTabs'
$LogPath = Join-Path $LogDir 'installer.log'

function Write-Log([string]$message) {
  try {
    if (-not (Test-Path $LogDir)) { [void](New-Item -ItemType Directory -Path $LogDir -Force) }
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 256KB) { Remove-Item $LogPath -Force }
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $message
    [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine)
  } catch {}
}

function Get-VivaldiAppDir {
  if ($env:SVB_VIVALDI_APP_DIR) { return $env:SVB_VIVALDI_APP_DIR }

  $candidates = @()
  try {
    $dest = (Get-ItemProperty 'HKCU:\Software\Vivaldi' -ErrorAction Stop).DestinationFolder
    if ($dest) { $candidates += (Join-Path $dest 'Application') }
  } catch {}
  $candidates += (Join-Path $env:LOCALAPPDATA 'Vivaldi\Application')
  $candidates += (Join-Path $env:ProgramFiles 'Vivaldi\Application')

  foreach ($dir in $candidates) {
    if (Test-Path $dir) { return $dir }
  }
  throw 'Could not find the Vivaldi Application folder.'
}

function Get-DistDir {
  if ($env:SVB_DIST_DIR) { return $env:SVB_DIST_DIR }
  return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\dist'))
}

function Get-RunningVersion([string]$appDir) {
  if ($env:SVB_RUNNING_VERSION) { return $env:SVB_RUNNING_VERSION }
  $exe = Join-Path $appDir 'vivaldi.exe'
  try {
    $proc = Get-Process vivaldi -ErrorAction Stop |
      Where-Object { $_.Path -and ($_.Path -ieq $exe) } |
      Select-Object -First 1
    if ($proc) { return $proc.MainModule.FileVersion }
  } catch {}
  return $null
}

function Test-SameFile([string]$a, [string]$b) {
  if (-not (Test-Path $b)) { return $false }
  return (Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash
}

function Invoke-Install {
  $appDir = Get-VivaldiAppDir
  $distDir = Get-DistDir
  foreach ($file in $ModFiles) {
    if (-not (Test-Path (Join-Path $distDir $file))) {
      throw "Missing $file in $distDir. Run 'npm run build' first."
    }
  }

  $runningVersion = Get-RunningVersion $appDir
  $versions = @(Get-ChildItem $appDir -Directory |
    Where-Object { $_.Name -match '^\d+(\.\d+)+$' -and (Test-Path (Join-Path $_.FullName 'resources\vivaldi\window.html')) } |
    Select-Object -ExpandProperty Name)

  $patched = @()
  foreach ($version in $versions) {
    $uiDir = Join-Path $appDir "$version\resources\vivaldi"
    $changed = $false

    foreach ($file in $ModFiles) {
      $src = Join-Path $distDir $file
      $dst = Join-Path $uiDir $file
      if (-not (Test-SameFile $src $dst)) {
        Copy-Item $src $dst -Force
        $changed = $true
      }
    }

    $windowHtml = Join-Path $uiDir 'window.html'
    $content = [IO.File]::ReadAllText($windowHtml)
    if ($content -notmatch 'src="custom\.js"') {
      $match = [regex]::Match($content, '</body>', 'IgnoreCase')
      if (-not $match.Success) { throw "No </body> tag in $windowHtml" }
      $backup = "$windowHtml.svb-backup"
      if (-not (Test-Path $backup)) { Copy-Item $windowHtml $backup }
      $content = $content.Insert($match.Index, $ScriptTag)
      [IO.File]::WriteAllText($windowHtml, $content)
      $changed = $true
    }

    if ($changed) { $patched += $version }
  }

  return [ordered]@{
    ok = $true
    versions = $versions
    patched = $patched
    runningVersion = $runningVersion
    restartNeeded = [bool]($runningVersion -and ($patched -contains $runningVersion))
  }
}

function Read-NativeMessage {
  $stdin = [Console]::OpenStandardInput()
  $header = New-Object byte[] 4
  $read = 0
  while ($read -lt 4) {
    $n = $stdin.Read($header, $read, 4 - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  $length = [BitConverter]::ToInt32($header, 0)
  $body = New-Object byte[] $length
  $read = 0
  while ($read -lt $length) {
    $n = $stdin.Read($body, $read, $length - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  return [Text.Encoding]::UTF8.GetString($body, 0, $read) | ConvertFrom-Json
}

function Write-NativeMessage($message) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($message | ConvertTo-Json -Compress -Depth 5))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes($bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

$isNativeHost = @($args | Where-Object { "$_" -like 'chrome-extension://*' }).Count -gt 0

if ($isNativeHost) {
  $reason = 'unknown'
  try {
    $request = Read-NativeMessage
    if ($request -and $request.reason) { $reason = $request.reason }
    $result = Invoke-Install
  } catch {
    $result = [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
  if ($result.ok) {
    Write-Log ("[{0}] running={1} patched={2} restartNeeded={3}" -f $reason, $result.runningVersion, ($result.patched -join ','), $result.restartNeeded)
  } else {
    Write-Log ("[{0}] ERROR {1}" -f $reason, $result.error)
  }
  Write-NativeMessage $result
  exit 0
}

try {
  $result = Invoke-Install
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Log "[cli] ERROR $($_.Exception.Message)"
  exit 1
}
Write-Log ("[cli] running={0} patched={1}" -f $result.runningVersion, ($result.patched -join ','))
Write-Host "Vivaldi versions found: $($result.versions -join ', ')"
if ($result.patched.Count -gt 0) {
  Write-Host "Installed the mod into: $($result.patched -join ', ')" -ForegroundColor Green
  if ($result.restartNeeded) { Write-Host 'Restart Vivaldi to load it.' }
} else {
  Write-Host 'Everything is already up to date.'
}
