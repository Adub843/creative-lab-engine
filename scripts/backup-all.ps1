# Nightly backup of every machine to the Dell server (\\192.168.1.221\HDD-Storage\Files\Backups). Runs on the NUC at 2:15 AM
# (task "Creative Lab nightly backup"). Nothing is ever deleted on a source machine.
#
#   Blink    Alice, Steve, the console copy and its data, the team board, all service files   -> Backups\Blink
#   GMKtec   its agent setup, scheduled tasks, desktop tools, the model's settings            -> Backups\GMKtec
#   NUC      Creative Lab HQ, Aaron-Data, Documents, the engine code, Claude's notes          -> Backups\NUC\<folder>\ (kept in step)
#
# No clutter (Aaron, 2026-11-15): each machine has ONE file that is replaced every night (<name>-latest.tgz) and one
# weekly file (<name>-week-<date>.tgz) made when the newest weekly one is 7 days old. A weekly file is deleted once it is
# 14 days old, so there are never more than three files per machine.
#
# Left out on purpose (rule 8, never copy secrets): key and password files (.env, auth.json, *.token, client_secret*.json,
# SSH private keys, etsy-secrets.log, the VNC settings). After a restore those are typed in again; the list is in
# Backups\WHAT IS NOT IN THE BACKUP.txt. Also left out: things that can be downloaded again (the AI models, the
# Hermes and LM Studio programs, caches).
#
#   powershell -File scripts\backup-all.ps1                 back up everything now
#   powershell -File scripts\backup-all.ps1 -Only Blink     one machine: Blink, GMKtec or NUC
#   powershell -File scripts\backup-all.ps1 -Install        create the nightly task
param([ValidateSet('All', 'Blink', 'GMKtec', 'NUC')][string]$Only = 'All', [switch]$Install)
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$hq = Join-Path $env:USERPROFILE 'OneDrive\Desktop\Creative Lab HQ'
$dest = '\\192.168.1.221\HDD-Storage\Files\Backups'
$log = Join-Path $hq '00 Recovery\backup-log.txt'
$blink = 'aaronlewis@100.70.128.45'
$k15 = 'AI1@100.99.149.38'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$weeklyEveryDays = 7
$deleteAfterDays = 14

if ($Install) {
  $vbs = Join-Path $repo 'scripts\run-hidden.vbs'
  $arg = "//B //Nologo `"$vbs`" powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $arg -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Daily -At '2:15 AM'
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'Creative Lab nightly backup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  'Task "Creative Lab nightly backup" created: every night at 2:15 AM.'
  exit 0
}

function Say($text) { $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $text; Add-Content -Path $log -Value $line -Encoding utf8; $line }
# Puts a finished archive in place: replaces <name>-latest.tgz, makes this week's file when it is due, and deletes
# weekly files that are 14 days old or more. Returns the path of the latest file.
function Store($file, $folder, $name) {
  $latest = Join-Path $folder "$name-latest.tgz"
  Move-Item $file $latest -Force
  $weekly = Get-ChildItem $folder -Filter "$name-week-*.tgz" -ErrorAction SilentlyContinue | Sort-Object Name
  $newest = $weekly | Select-Object -Last 1
  $due = (-not $newest) -or (((Get-Date).Date - [datetime]::ParseExact($newest.BaseName.Substring($newest.BaseName.Length - 10), 'yyyy-MM-dd', $null)).Days -ge $weeklyEveryDays)
  if ($due) { Copy-Item $latest (Join-Path $folder "$name-week-$stamp.tgz") -Force }
  Get-ChildItem $folder -Filter "$name-week-*.tgz" -ErrorAction SilentlyContinue | Where-Object {
    ((Get-Date).Date - [datetime]::ParseExact($_.BaseName.Substring($_.BaseName.Length - 10), 'yyyy-MM-dd', $null)).Days -ge $deleteAfterDays
  } | Remove-Item -Force -ErrorAction SilentlyContinue
  # files from the first day's naming (blink-2026-11-15.tgz) are folded into the scheme
  Get-ChildItem $folder -Filter "$name-20*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $latest
}
function Size($path) { '{0:N1} MB' -f ((Get-Item $path).Length / 1MB) }

if (-not (Test-Path '\\192.168.1.221\HDD-Storage\Files')) { Say 'FAILED: the Dell server share is not reachable. Nothing was backed up.'; exit 1 }
foreach ($d in 'Blink', 'GMKtec', 'NUC') { New-Item -ItemType Directory -Force -Path (Join-Path $dest $d) | Out-Null }
$tmp = Join-Path $env:TEMP 'creative-lab-backup'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$failed = @()

# ---------------------------------------------------------------- Blink
if ($Only -in 'All', 'Blink') {
  $remote = "cd ~ && tar czf /tmp/blink-backup.tgz --ignore-failed-read --warning=no-file-changed " +
    "--exclude=.env --exclude='.env.*' --exclude=auth.json --exclude=auth.lock --exclude='*.token' --exclude='*.pem' " +
    "--exclude=.hermes/hermes-agent --exclude=.hermes/tools --exclude=.hermes/cache --exclude=.hermes/sandboxes --exclude=.hermes/logs " +
    "--exclude=.hermes/audio_cache --exclude=.hermes/image_cache --exclude=node_modules --exclude=__pycache__ --exclude='*.sock' --exclude='*.pid' " +
    ".hermes alice-web console-web steve-web team-notes qwen-google Desktop .config/systemd/user .local/bin .local/share/blink-shortcuts .lmstudio/settings.json " +
    "2>/dev/null; chmod 600 /tmp/blink-backup.tgz; ls -l /tmp/blink-backup.tgz | awk '{print `$5}'"
  $bytes = & ssh -o BatchMode=yes -o ConnectTimeout=15 $blink $remote 2>$null
  $file = Join-Path $tmp "blink-$stamp.tgz"
  & scp -q -o BatchMode=yes "${blink}:/tmp/blink-backup.tgz" $file 2>$null
  & ssh -o BatchMode=yes $blink 'rm -f /tmp/blink-backup.tgz' 2>$null
  if ((Test-Path $file) -and (Get-Item $file).Length -gt 1MB -and "$bytes" -eq "$((Get-Item $file).Length)") {
    $kept = Store $file (Join-Path $dest 'Blink') 'blink'
    Say "Blink backed up: $(Size $kept) (Alice, Steve, console copy and data, team board, service files)."
  } else { $failed += 'Blink'; Say 'FAILED: the Blink backup did not come back whole. Is the Blink on?' }
}

# ---------------------------------------------------------------- GMKtec
if ($Only -in 'All', 'GMKtec') {
  $ps = @'
$s = Join-Path $env:USERPROFILE 'backup-staging'
Remove-Item $s -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$s\tasks", "$s\desktop", "$s\openclaw" | Out-Null
Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' } | ForEach-Object { try { Export-ScheduledTask -TaskName $_.TaskName | Set-Content (Join-Path "$s\tasks" ($_.TaskName + '.xml')) -Encoding utf8 } catch {} }
Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 20MB } | Copy-Item -Destination "$s\desktop" -ErrorAction SilentlyContinue
$oc = Join-Path $env:USERPROFILE '.openclaw'
if (Test-Path $oc) { robocopy $oc "$s\openclaw" /E /XF auth-profiles.json *.token .env *.pem /XD node_modules cache logs /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null }
$ol = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (Test-Path $ol) { (& $ol list 2>$null) | Set-Content "$s\ollama-models.txt"; (& $ol show --modelfile qwen3:4b-instruct 2>$null) | Set-Content "$s\qwen3-4b-instruct.Modelfile" }
Copy-Item (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\Chat with Qwen.cmd') $s -ErrorAction SilentlyContinue
Get-Service sshd, Tailscale, uvnc_service -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType | Out-File "$s\services.txt"
Set-Location $env:USERPROFILE
tar -czf k15-backup.tgz -C $s .
(Get-Item k15-backup.tgz).Length
'@
  $script = Join-Path $tmp 'k15-stage.ps1'; Set-Content -Path $script -Value $ps -Encoding utf8
  & scp -q -o BatchMode=yes $script "${k15}:C:/Users/AI1/k15-stage.ps1" 2>$null
  $bytes = & ssh -o BatchMode=yes -o ConnectTimeout=15 $k15 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\AI1\k15-stage.ps1' 2>$null | Select-Object -Last 1
  $file = Join-Path $tmp "k15-$stamp.tgz"
  & scp -q -o BatchMode=yes "${k15}:C:/Users/AI1/k15-backup.tgz" $file 2>$null
  if ((Test-Path $file) -and (Get-Item $file).Length -gt 2KB -and "$bytes".Trim() -eq "$((Get-Item $file).Length)") {
    $kept = Store $file (Join-Path $dest 'GMKtec') 'k15'
    Say "GMKtec backed up: $(Size $kept) (agent setup, scheduled tasks, desktop tools, model settings)."
  } else { $failed += 'GMKtec'; Say 'FAILED: the GMKtec backup did not come back whole. Is the GMKtec on?' }
}

# ---------------------------------------------------------------- NUC
if ($Only -in 'All', 'NUC') {
  $secret = @('etsy-secrets.log', 'client_secret*.json', '.env', '*.pem', 'id_rsa', 'id_ed25519', '*.kdbx', '*.dpapi', '.credentials.json')
  $jobs = @(
    @{ name = 'Creative Lab HQ'; src = $hq },
    @{ name = 'Aaron-Data'; src = (Join-Path $env:USERPROFILE 'Aaron-Data') },
    @{ name = 'Documents'; src = (Join-Path $env:USERPROFILE 'Documents') },
    @{ name = 'creative-lab-engine'; src = $repo },
    @{ name = 'Claude notes and settings'; src = (Join-Path $env:USERPROFILE '.claude') }
  )
  foreach ($j in $jobs) {
    if (-not (Test-Path $j.src)) { continue }
    $to = Join-Path $dest ("NUC\" + $j.name)
    & robocopy $j.src $to /E /COPY:DAT /DCOPY:DAT /R:1 /W:2 /MT:4 /XJ /FFT /NP /NFL /NDL /NJH /XF $secret /XD node_modules dist .wrangler __pycache__ 'shell-snapshots' 'statsig' "/LOG+:$(Join-Path $tmp 'nuc-robocopy.log')" | Out-Null
    if ($LASTEXITCODE -ge 8) { $failed += "NUC: $($j.name)"; Say "FAILED: some files in '$($j.name)' on the NUC did not copy (robocopy code $LASTEXITCODE)." }
    else { Say "NUC backed up: $($j.name)." }
  }
  $tasks = Join-Path $dest 'NUC\Scheduled tasks'; New-Item -ItemType Directory -Force -Path $tasks | Out-Null
  Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' } | ForEach-Object { try { Export-ScheduledTask -TaskName $_.TaskName | Set-Content (Join-Path $tasks ($_.TaskName + '.xml')) -Encoding utf8 } catch {} }
}

Set-Content -Path (Join-Path $dest 'WHAT IS NOT IN THE BACKUP.txt') -Encoding utf8 -Value @"
Last backup run: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

These are left out on purpose, because keys and passwords are never copied. After a restore you type them in again:
- Blink: the Hermes key files (.env, auth.json), the console copy's sign-in file and token, Alice's Google sign-in.
- GMKtec: the UltraVNC password, the agent app's sign-in file.
- NUC: SSH private keys, the saved console key, any client_secret or etsy-secrets file.

These are left out because they can be downloaded again:
- The AI models (Blink: qwen/qwen3-4b-2507 in LM Studio. GMKtec: qwen3:4b-instruct in Ollama).
- The programs themselves: LM Studio, Hermes Agent, Ollama, Tailscale, UltraVNC.

How to restore is in the recovery guide: Creative Lab HQ\00 Recovery\1 System recovery guide.html, section "Restoring from a backup".
"@
if ($failed.Count) { Say ("Backup finished with problems: " + ($failed -join '; ')); exit 1 }
Say 'Backup finished: everything asked for was copied to the Dell.'
