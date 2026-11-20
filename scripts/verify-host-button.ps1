# End-to-end check of the one-command host flow:
# start the server loopback-only, press "Start hosting" in the real page, then
# load the game from the LAN address the way another device does.
$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\Ye Abe\Desktop\BBM'
$port = '3200'
$env:PORT = $port
$env:LAN_ENABLED = 'false'
$env:HOST = '127.0.0.1'
$env:CLIENT_DIST = 'apps/client/dist'
$env:DATABASE_REQUIRED = 'true'

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) { throw "port $port already in use by pid(s): $($existing.OwningProcess -join ',')" }

$server = Start-Process -FilePath 'node' -ArgumentList 'apps/server/dist/index.js' -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 300
    try { if ((Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch { }
  }
  Write-Output "READY=$ready"
  if (-not $ready) { throw 'server did not start' }

  $before = (Invoke-WebRequest "http://127.0.0.1:$port/api/lan-info" -UseBasicParsing).Content
  Write-Output "BEFORE=$before"

  node 'C:\Users\Ye Abe\.codegpt\skills\browser-automation\browser.mjs' "http://127.0.0.1:$port/" --timeout 30000 --wait '#lobby-root .lobby-shell' --script 'C:\Users\Ye Abe\Desktop\BBM\scripts\verify-host-button.mjs' 2>&1 | Out-String | Write-Output

  $after = (Invoke-WebRequest "http://127.0.0.1:$port/api/lan-info" -UseBasicParsing).Content
  Write-Output "AFTER=$after"
}
finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
