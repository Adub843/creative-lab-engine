# Network heartbeat for the Creative Lab console's System map (Network tab).
# Runs on NUC_SKULL every 5 minutes (install-heartbeat.ps1 sets that up). It checks the home network and writes
# one small JSON file, status/network.json, into the creative-lab-engine R2 bucket with the wrangler login that is
# already on this PC. No key or password is stored or typed. If this PC stops sending, the map raises an alarm
# after 15 minutes ("lost contact").
#
# What it checks: the AT&T gateway, the internet, the Epson printer, the E: drive (Samsung T9), the E: drive
# tunnel (cloudflared + the library server on 127.0.0.1:8787), every Tailscale device, and which devices are on Wi-Fi.
param(
  [string]$EngineDir = "$env:USERPROFILE\OneDrive\Desktop\creative-lab-engine",
  [string]$Printer = "192.168.1.205",
  [switch]$DryRun
)
$ErrorActionPreference = "SilentlyContinue"

function Ping-Ms([string]$Target) {
  $r = Test-Connection -ComputerName $Target -Count 1 -ErrorAction SilentlyContinue
  if ($r) { $ms = $r.ResponseTime; if ($null -eq $ms) { $ms = $r.Latency }; return @{ up = $true; ms = [int]$ms } }
  return @{ up = $false; ms = $null }
}

$gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
$gateway = if ($gw) { Ping-Ms $gw } else { @{ up = $false; ms = $null } }
$internet = Ping-Ms "1.1.1.1"
$printer = Ping-Ms $Printer

$e = Get-PSDrive -Name E -PSProvider FileSystem -ErrorAction SilentlyContinue
$edrive = if ($e -and (Test-Path "E:\")) { @{ present = $true; freeGB = [math]::Round($e.Free / 1GB) } } else { @{ present = $false; freeGB = $null } }

$cf = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
$lib = [bool](Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
$tunnel = @{ up = ($cf -and $lib); ms = $null }

$ts = @()
$tsExe = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $tsExe) {
  $j = & $tsExe status --json | ConvertFrom-Json
  if ($j) {
    $self = $j.Self
    $ts += @{ name = $self.HostName; ip = ($self.TailscaleIPs | Select-Object -First 1); os = $self.OS; online = $true; lastSeen = $null }
    foreach ($p in $j.Peer.PSObject.Properties.Value) {
      $seen = $null; if ($p.LastSeen -and -not "$($p.LastSeen)".StartsWith("0001")) { $seen = ([datetime]$p.LastSeen).ToUniversalTime().ToString("o") }
      $ts += @{ name = $p.HostName; ip = ($p.TailscaleIPs | Select-Object -First 1); os = $p.OS; online = [bool]$p.Online; lastSeen = $seen }
    }
  }
}

$lan = @(Get-NetNeighbor -AddressFamily IPv4 -State Reachable, Stale, Delay, Probe -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "192.168.*" -and $_.IPAddress -ne $gw -and $_.LinkLayerAddress -notmatch "^(FF-|00-00-00|01-00-5E)" } |
  ForEach-Object { @{ ip = $_.IPAddress; name = "" } })

$beat = [ordered]@{
  at = (Get-Date).ToUniversalTime().ToString("o"); host = $env:COMPUTERNAME
  gateway = $gateway; internet = $internet; printer = $printer; tunnel = $tunnel; edrive = $edrive
  tailscale = $ts; lan = $lan
}
$file = Join-Path $env:TEMP "creative-lab-network.json"
$beat | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $file -Encoding UTF8
if ($DryRun) { Get-Content $file; exit 0 }

Push-Location $EngineDir
& npx.cmd wrangler r2 object put "creative-lab-engine/status/network.json" --file $file --content-type "application/json" --remote 2>&1 | Out-Null
$code = $LASTEXITCODE
Pop-Location
exit $code
