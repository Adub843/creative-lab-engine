# Keeps the E: drive library server and its Cloudflare Tunnel running. The "Design Library" task runs this at
# sign-in and every 5 minutes; it starts only the piece that isn't running, so a crash or a dropped tunnel comes
# back within 5 minutes. Made by setup.ps1; safe to run by hand.
$data = Join-Path $env:LOCALAPPDATA "design-library"
# If the folder was made from inside the Claude desktop app, it is in that app's private copy of AppData\Local
# (see config.mjs): use it by its real path so this works the same inside and outside the app.
$private = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue | Sort-Object Name |
  ForEach-Object { Join-Path $_.FullName "LocalCache\Local\design-library" } | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($private) { $data = $private }
$server = Join-Path $PSScriptRoot "server.mjs"
$tunnelYml = Join-Path $data "tunnel.yml"
$cf = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cloudflared.exe'"
$log = Join-Path $data "watch.log"
function Note($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $m" }

if (-not ($procs | Where-Object { $_.CommandLine -match [regex]::Escape($server) })) {
  Start-Process -FilePath "node" -ArgumentList "`"$server`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  Note "started server"
}
if ($cf -and (Test-Path $tunnelYml) -and -not ($procs | Where-Object { $_.CommandLine -match 'tunnel\.yml' })) {
  Start-Process -FilePath $cf -ArgumentList "tunnel --config `"$tunnelYml`" run" -WindowStyle Hidden
  Note "started tunnel"
}
# keep the log short
if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Get-Content $log -Tail 500 | Set-Content $log }
