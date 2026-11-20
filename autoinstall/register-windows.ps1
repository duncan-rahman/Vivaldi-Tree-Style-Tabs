# Registers the native messaging host that the auto-installer extension calls.
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
$HostDir = Join-Path $PSScriptRoot 'host'
$ManifestPath = Join-Path $HostDir "$HostName.json"

if (Test-Path $LegacyRegKey) { Remove-Item $LegacyRegKey -Force }

if ($Uninstall) {
  foreach ($key in $RegKeys) {
    if (Test-Path $key) { Remove-Item $key -Force }
  }
  if (Test-Path $ManifestPath) { Remove-Item $ManifestPath -Force }
  Write-Host 'Removed the native messaging host. You can now remove the extension in vivaldi://extensions.'
  exit 0
}

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

Write-Host "Host manifest: $ManifestPath"
Write-Host "Next: load $(Join-Path $PSScriptRoot 'extension') as an unpacked extension in vivaldi://extensions."
