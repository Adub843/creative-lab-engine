# Links Autodesk Fusion on this PC to the Lab. Run it again any time (after a pull) to update; no admin needed.
#   1. copies the LabBridge add-in (tools\fusion\LabBridge) into Fusion's add-in folder; it starts with Fusion;
#   2. schedules "Creative Lab Fusion jobs": every minute it runs scripts\fusion-runner.mjs, which takes the Lab's
#      Fusion jobs, has Fusion build them and saves the files in the Charleston 3D library.
# Fusion must be signed in and open for jobs to run; while it's closed, jobs just wait.
# To remove: Unregister-ScheduledTask "Creative Lab Fusion jobs"; delete the LabBridge folder under API\AddIns.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source

# 1. The add-in.
$addins = Join-Path $env:APPDATA "Autodesk\Autodesk Fusion 360\API\AddIns"
New-Item -ItemType Directory -Force $addins | Out-Null
$dest = Join-Path $addins "LabBridge"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Force (Join-Path $repo "tools\fusion\LabBridge\*") $dest
New-Item -ItemType Directory -Force (Join-Path $env:LOCALAPPDATA "CreativeLab\fusion-jobs\inbox") | Out-Null

# 2. The runner, with the console key file found the same way as Alice's mailbox.
$runs = Join-Path $repo "ai-jobs\runs\fusion"
New-Item -ItemType Directory -Force $runs | Out-Null
$data = Join-Path $env:LOCALAPPDATA "design-library"
$private = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName "LocalCache\Local\design-library" } | Where-Object { Test-Path (Join-Path $_ "studio-key.dpapi") } | Select-Object -First 1
if ($private) { $data = $private }
if (-not (Test-Path (Join-Path $data "studio-key.dpapi"))) { throw "No console key on this PC yet: run drive-server\setup.ps1 first." }

$run = Join-Path $runs "run.cmd"
@"
@echo off
rem Made by scripts\setup-fusion.ps1. Builds the Lab's Fusion jobs; keeps the last run's output.
set "DRIVE_DATA=$data"
set "LAB_FUSION_JOBS=$env:LOCALAPPDATA\CreativeLab\fusion-jobs"
cd /d "$repo"
"$node" scripts\fusion-runner.mjs > "$runs\last-run.log" 2>&1
"@ | Set-Content -LiteralPath $run -Encoding ascii

$vbs = Join-Path $repo "scripts\run-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$vbs`" cmd.exe /c `"$run`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 55) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Creative Lab Fusion jobs" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
  -Description "Builds the Lab's Fusion jobs in Autodesk Fusion (creative-lab-engine\scripts\fusion-runner.mjs)." | Out-Null
Write-Host "LabBridge add-in installed in $dest"
Write-Host "Restart Fusion once (or Utilities > Add-Ins > LabBridge > Run) so the add-in starts."
Get-ScheduledTask -TaskName "Creative Lab Fusion jobs" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
