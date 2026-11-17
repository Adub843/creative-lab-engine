# Creates the NUC task "Creative Lab overnight jobs": every night at 12:40 AM it runs scripts\overnight-jobs.mjs,
# which has the GMKtec's small model draft posts for both brands from the live listings. Drafts only: nothing is
# posted, no store is changed and no key is used. It finishes long before the 2:15 AM backup.
# Run it again any time; it replaces the task. To remove it: Unregister-ScheduledTask "Creative Lab overnight jobs".
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'ai-jobs\runs\overnight'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$node = (Get-Command node).Source
$cmd = Join-Path $out 'run.cmd'
$lines = @('@echo off', 'rem Made by scripts\schedule-overnight-jobs.ps1. One night of overnight jobs; the log keeps every run.',
  "cd /d `"$repo`"", "`"$node`" scripts\overnight-jobs.mjs >> `"$(Join-Path $out 'log.txt')`" 2>&1")
Set-Content -Path $cmd -Value $lines -Encoding ascii
$vbs = Join-Path $repo 'scripts\run-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`" `"$cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '00:40'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Creative Lab overnight jobs' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
'Task "Creative Lab overnight jobs" created: every night at 12:40 AM.'
