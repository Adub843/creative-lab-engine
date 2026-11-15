# Keeps the local agents in step with Aaron's rules. Runs every 5 minutes on the NUC (task "Creative Lab context sync").
#
# When Creative Lab HQ\CLAUDE.md or MARKETING-CONTEXT.md changes it:
#   1. copies them to their other homes on the NUC (the same thing "Sync rules files.cmd" does),
#   2. copies them to Steve's folder on the Blink (~/Desktop/Business), where he reads them,
#   3. posts a note on the team notes board, so Alice and Steve both know on their very next answer,
#   4. checks that every numbered hard rule in CLAUDE.md is also in Steve's instructions (agents/steve-web/SOUL.md)
#      and says so on the board and in the log if one is missing. Writing a new rule into Steve's instructions,
#      his checker and his tests is still done by Claude the same day (rule 20); this makes sure it is not forgotten.
#
#   powershell -File scripts\sync-agent-context.ps1            the scheduled run (does nothing when nothing changed)
#   powershell -File scripts\sync-agent-context.ps1 -Force     push now even if nothing changed
#   powershell -File scripts\sync-agent-context.ps1 -Install   create the 5-minute task
param([switch]$Force, [switch]$Install)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$hq = Join-Path $env:USERPROFILE 'OneDrive\Desktop\Creative Lab HQ'
$files = @((Join-Path $hq 'CLAUDE.md'), (Join-Path $hq 'MARKETING-CONTEXT.md'))
$stateFile = Join-Path $hq '05 Tools\Blink\context-sync-state.json'
$logFile = Join-Path $hq '05 Tools\Blink\context-sync-log.txt'
$blink = 'aaronlewis@100.70.128.45'

if ($Install) {
  $vbs = Join-Path $repo 'scripts\run-hidden.vbs'
  $arg = "//B //Nologo `"$vbs`" powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $arg -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'Creative Lab context sync' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  'Task "Creative Lab context sync" created: every 5 minutes.'
  exit 0
}

function Say($text) { Add-Content -Path $logFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $text) -Encoding utf8 }
function Note($kind, $text) {
  # Posts to the team board on the Blink. The text goes on standard input, so nothing is quoted on a command line.
  $ErrorActionPreference = 'Continue'
  $r = $text | & ssh -o BatchMode=yes -o ConnectTimeout=10 $blink "python3 ~/team-notes/post_note.py $kind nuc" 2>$null
  if ("$r" -notmatch 'posted|skipped') { Say "Could not post a $kind note to the team board." }
}

$now = @{}
foreach ($f in $files) { if (Test-Path $f) { $now[(Split-Path $f -Leaf)] = (Get-FileHash $f -Algorithm SHA256).Hash } }
$old = @{}
if (Test-Path $stateFile) { (Get-Content $stateFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $old[$_.Name] = $_.Value } }
$changed = @($now.Keys | Where-Object { $old[$_] -ne $now[$_] })
if (-not $Force -and $changed.Count -eq 0) { exit 0 }
if ($Force -and $changed.Count -eq 0) { $changed = @($now.Keys) }

# 1. The other homes on this PC.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hq 'Business Handoff\06 OpenClaw Setup\sync-rules-files.ps1') | Out-Null

# 2. Steve's folder on the Blink.
$sent = $true
foreach ($name in $changed) {
  & scp -q -o BatchMode=yes -o ConnectTimeout=10 (Join-Path $hq $name) "${blink}:Desktop/Business/$name" 2>$null
  if ($LASTEXITCODE -ne 0) { $sent = $false }
}
if (-not $sent) { Say "Could not reach the Blink; will try again in 5 minutes. Changed: $($changed -join ', ')"; exit 1 }

# 3. Tell every agent, right now.
$when = Get-Date -Format 'MMM d, h:mm tt'
foreach ($name in $changed) {
  if ($name -eq 'CLAUDE.md') { Note 'rules' "Aaron's rules file changed ($when). The current copy is /business/CLAUDE.md. For any question about a rule, open it and use what it says now." }
  else { Note 'rules' "The marketing playbook changed ($when). The current copy is /business/MARKETING-CONTEXT.md. Read it before any marketing or social work." }
}

# 4. Every numbered hard rule must also be in Steve's instructions.
$drift = ''
if ($changed -contains 'CLAUDE.md') {
  $text = Get-Content (Join-Path $hq 'CLAUDE.md') -Raw
  $start = $text.IndexOf('## 1. Hard rules'); $end = $text.IndexOf('## 2.', [Math]::Max($start, 0))
  if ($start -ge 0 -and $end -gt $start) {
    $master = [regex]::Matches($text.Substring($start, $end - $start), '(?m)^(\d+)\. \*\*') | ForEach-Object { [int]$_.Groups[1].Value }
    $soul = [regex]::Matches((Get-Content (Join-Path $repo 'agents\steve-web\SOUL.md') -Raw), '(?m)^(\d+)\. ') | ForEach-Object { [int]$_.Groups[1].Value }
    $missing = @($master | Where-Object { $soul -notcontains $_ })
    if ($missing.Count) {
      $drift = "Hard rule $($missing -join ', ') is in the rules file but not yet in Steve's own instructions or checker. Until Claude adds it, read it in /business/CLAUDE.md and follow it."
      Note 'rules' $drift
    }
  }
}

$now | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8
Say ("Pushed to the agents: {0}.{1}" -f ($changed -join ', '), $(if ($drift) { " NEEDS CLAUDE: $drift" } else { '' }))
"Pushed: $($changed -join ', '). $drift"
