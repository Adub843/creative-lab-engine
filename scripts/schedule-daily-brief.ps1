# Schedules the daily brief on this PC: every morning at 7:50 (after the engine saves its digest at 11:30 UTC, in
# both winter and summer time) it runs scripts\daily-brief.mjs for both brands on the local model.
# It runs as the signed-in user, because the console key is encrypted for that Windows account. No admin needed.
# Run it again any time; it replaces the task. To remove it: Unregister-ScheduledTask "Creative Lab daily brief".
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source
$runs = Join-Path $repo "ai-jobs\runs\daily-brief"
New-Item -ItemType Directory -Force $runs | Out-Null

# Where the console key file really is. When drive-server\setup.ps1 was run from inside the Claude desktop app,
# Windows kept its files in the app's own private copy of AppData\Local, which a scheduled task does not see.
$data = Join-Path $env:LOCALAPPDATA "design-library"
$private = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName "LocalCache\Local\design-library" } | Where-Object { Test-Path (Join-Path $_ "studio-key.dpapi") } | Select-Object -First 1
if ($private) { $data = $private }
if (-not (Test-Path (Join-Path $data "studio-key.dpapi"))) { throw "No console key on this PC yet: run drive-server\setup.ps1 first." }

$run = Join-Path $runs "run.cmd"
@"
@echo off
rem Made by scripts\schedule-daily-brief.ps1. Runs the daily brief and keeps the last run's output next to it.
set "DRIVE_DATA=$data"
cd /d "$repo"
"$node" scripts\daily-brief.mjs > "$runs\last-run.log" 2>&1
"@ | Set-Content -LiteralPath $run -Encoding ascii

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$run'`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At "7:50AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Creative Lab daily brief" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
  -Description "Writes the daily brief for each brand on the local model (creative-lab-engine\scripts\daily-brief.mjs)." | Out-Null
Get-ScheduledTask -TaskName "Creative Lab daily brief" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
