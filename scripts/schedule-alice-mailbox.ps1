# Schedules Alice's mailbox on this PC: every minute it runs scripts\alice-mailbox.mjs, which answers the questions
# people sent Alice from the Lab console with the model already loaded on the Blink (it never loads one).
# It runs as the signed-in user, because the console key is encrypted for that Windows account. No admin needed.
# Run it again any time; it replaces the task. To remove it: Unregister-ScheduledTask "Creative Lab Alice mailbox".
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source
$runs = Join-Path $repo "ai-jobs\runs\alice-mailbox"
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
rem Made by scripts\schedule-alice-mailbox.ps1. Answers Alice's console questions; keeps the last run's log (names and times only).
set "DRIVE_DATA=$data"
cd /d "$repo"
"$node" scripts\alice-mailbox.mjs > "$runs\last-run.log" 2>&1
"@ | Set-Content -LiteralPath $run -Encoding ascii

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$run'`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Creative Lab Alice mailbox" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
  -Description "Answers questions sent to Alice from the Lab console (creative-lab-engine\scripts\alice-mailbox.mjs)." | Out-Null
Get-ScheduledTask -TaskName "Creative Lab Alice mailbox" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
