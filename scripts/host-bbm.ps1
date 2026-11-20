# Host BBM for players on the same Wi-Fi network or hotspot.
#
#   npm run host
#
# This builds the client, starts the BBM server (API + WebSocket + game page) on
# one port, and opens the hosting lobby in your browser. Other players connect to
# the address this script prints, press "Start hosting" only on THIS computer,
# and join with the room code.
#
# No .env editing is needed. Defaults can be overridden with PORT / DATABASE_URL
# environment variables.

$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Ye Abe\Desktop\BBM'

$port = if ($env:PORT) { $env:PORT } else { '3000' }
$env:PORT = $port
$env:LAN_ENABLED = 'false'   # starts on this computer only; lobby enables LAN hosting
$env:HOST = '127.0.0.1'
$env:CLIENT_DIST = 'apps/client/dist'

Write-Host 'Building the client...' -ForegroundColor Cyan
npm.cmd run build --silent
if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }

Write-Host 'Starting the BBM server...' -ForegroundColor Cyan
$server = Start-Process -FilePath 'node' -ArgumentList 'apps/server/dist/index.js' -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 300
    try {
      if ((Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch { }
  }
  if (-not $ready) { throw "The BBM server did not start. Check that PostgreSQL is running." }

  Write-Host ''
  Write-Host '  BBM is running on this computer.' -ForegroundColor Green
  Write-Host "  Open here:  http://127.0.0.1:$port/" -ForegroundColor Green
  Write-Host ''
  Write-Host '  Next: press "Start hosting" in the lobby (this computer only).' -ForegroundColor Yellow
  Write-Host '  Then share the link it shows and your room code with other players.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Press Ctrl+C to stop the server.' -ForegroundColor DarkGray

  Start-Process "http://127.0.0.1:$port/"
  Wait-Process -Id $server.Id
}
finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
