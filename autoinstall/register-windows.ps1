# Sets up the auto-installer: copies the extension and native messaging host
# out of the repo into %LocalAppData%\SvbTreeTabs (so switching git branches
# can't remove them) and registers the host. The host installs from this
# repo's dist folder.
#
# Vivaldi looks hosts up under the Chromium and Google Chrome registry keys (not
# its own), so register under both. Vivaldi updates don't touch either key, and
# allowed_origins limits the host to this extension.
#
#   powershell -ExecutionPolicy Bypass -File autoinstall\register-windows.ps1
#   powershell -ExecutionPolicy Bypass -File autoinstall\register-windows.ps1 -Uninstall

param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$HostName = 'com.svb.treetabs_installer'
$ExtensionId = 'iidhijjmejhlnnjimbkdfaflkgebcllm'
$RegKeys = @(
  "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
)
# Earlier versions of this script registered here; Vivaldi never reads it.
$LegacyRegKey = "HKCU:\Software\Vivaldi\NativeMessagingHosts\$HostName"

$InstallRoot = Join-Path $env:LOCALAPPDATA 'SvbTreeTabs'
$HostDir = Join-Path $InstallRoot 'host'
$ExtensionDir = Join-Path $InstallRoot 'extension'
$ManifestPath = Join-Path $HostDir "$HostName.json"
$DistDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dist'))

if (Test-Path $LegacyRegKey) { Remove-Item $LegacyRegKey -Force }

if ($Uninstall) {
  foreach ($key in $RegKeys) {
    if (Test-Path $key) { Remove-Item $key -Force }
  }
  foreach ($dir in @($HostDir, $ExtensionDir)) {
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  }
  Write-Host 'Removed the auto-installer. Also remove the extension in vivaldi://extensions.'
  exit 0
}

foreach ($dir in @($HostDir, $ExtensionDir)) {
  if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
}
Copy-Item (Join-Path $PSScriptRoot 'host\svb-installer.ps1'), (Join-Path $PSScriptRoot 'host\svb-installer.bat') $HostDir -Force
Copy-Item (Join-Path $PSScriptRoot 'extension\*') $ExtensionDir -Recurse -Force

[IO.File]::WriteAllText((Join-Path $HostDir 'config.json'), ([ordered]@{ distDir = $DistDir } | ConvertTo-Json))

$manifest = [ordered]@{
  name = $HostName
  description = 'Vivaldi Tree Style Tabs auto-installer'
  path = (Join-Path $HostDir 'svb-installer.bat')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
[IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json))

foreach ($key in $RegKeys) {
  if (-not (Test-Path $key)) { [void](New-Item -Path $key -Force) }
  Set-Item -Path $key -Value $ManifestPath
  Write-Host "Registered $key"
}

Write-Host "Installs builds from: $DistDir"
Write-Host "Next: load $ExtensionDir as an unpacked extension in vivaldi://extensions."
