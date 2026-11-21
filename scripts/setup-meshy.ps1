# Links the Lab's 3D maker (Meshy) to the Meshy CLI signed in on this PC, so no Meshy API key is needed anywhere.
# Run it again any time (after a pull) to update; no admin needed.
#   1. installs the Meshy CLI (meshy-cli 0.4.0) in %LOCALAPPDATA%\CreativeLab\meshy-cli;
#   2. checks it is signed in (if not: run "meshy auth login" once and approve it in the browser);
#   3. schedules "Creative Lab Meshy jobs": every minute it runs scripts\meshy-runner.mjs, which sends the Lab's
#      Meshy jobs with the CLI, follows them and brings the finished models back to the Lab.
# To remove: Unregister-ScheduledTask "Creative Lab Meshy jobs".
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node).Source

# 1. The CLI, pinned, in its own folder (run with node directly, so no PowerShell script policy gets in the way).
$cliDir = Join-Path $env:LOCALAPPDATA "CreativeLab\meshy-cli"
New-Item -ItemType Directory -Force $cliDir | Out-Null
& npm.cmd install --prefix $cliDir --no-audit --no-fund meshy-cli@0.4.0 | Out-Null
$cli = Join-Path $cliDir "node_modules\meshy-cli\dist\index.js"
if (-not (Test-Path $cli)) { throw "The Meshy CLI didn't install." }

# 2. Signed in? (reads the balance only; never prints the sign-in)
& $node (Join-Path $repo "scripts\meshy-runner.mjs") --status
if ($LASTEXITCODE -ne 0) { Write-Host "Sign in once: & `"$node`" `"$cli`" auth login   (approve it in the browser), then run this again." }

# 3. The runner, with the console key file found the same way as the Fusion runner.
$runs = Join-Path $repo "ai-jobs\runs\meshy"
New-Item -ItemType Directory -Force $runs | Out-Null
$data = Join-Path $env:LOCALAPPDATA "design-library"
$private = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName "LocalCache\Local\design-library" } | Where-Object { Test-Path (Join-Path $_ "studio-key.dpapi") } | Select-Object -First 1
if ($private) { $data = $private }
if (-not (Test-Path (Join-Path $data "studio-key.dpapi"))) { throw "No console key on this PC yet: run drive-server\setup.ps1 first." }

$run = Join-Path $runs "run.cmd"
@"
@echo off
rem Made by scripts\setup-meshy.ps1. Runs the Lab's Meshy jobs; keeps the last run's output.
set "DRIVE_DATA=$data"
cd /d "$repo"
"$node" scripts\meshy-runner.mjs > "$runs\last-run.log" 2>&1
"@ | Set-Content -LiteralPath $run -Encoding ascii

$vbs = Join-Path $repo "scripts\run-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$vbs`" cmd.exe /c `"$run`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Creative Lab Meshy jobs" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
  -Description "Runs the Lab's Meshy jobs with the Meshy CLI signed in on this PC (creative-lab-engine\scripts\meshy-runner.mjs)." | Out-Null
Get-ScheduledTask -TaskName "Creative Lab Meshy jobs" | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
