# Creates the NUC task "Creative Lab request sorting": every hour it runs scripts\request-triage.mjs, which sorts new
# Charleston 3D custom requests on the local model and saves a draft reply for Aaron. Drafts only: nothing is sent to
# a customer and no order is changed. The console key is read from the saved store on this PC and never printed.
# Run it again any time; it replaces the task. To remove it: Unregister-ScheduledTask "Creative Lab request sorting".
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'ai-jobs\runs\request-triage'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$node = (Get-Command node).Source
# The saved key lives in the Claude app's private folder; a scheduled task has to be told where that is.
$data = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\design-library' } | Where-Object { Test-Path $_ } | Select-Object -First 1
$cmd = Join-Path $out 'run.cmd'
$lines = @('@echo off', 'rem Made by scripts\schedule-request-triage.ps1. One pass of request sorting; the log keeps every run.')
if ($data) { $lines += "set `"DRIVE_DATA=$data`"" }
$lines += "cd /d `"$repo`""
$lines += "`"$node`" scripts\request-triage.mjs >> `"$(Join-Path $out 'log.txt')`" 2>&1"
Set-Content -Path $cmd -Value $lines -Encoding ascii
$vbs = Join-Path $repo 'scripts\run-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`" `"$cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours((Get-Date).Hour + 1).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Creative Lab request sorting' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
'Task "Creative Lab request sorting" created: every hour at ten past.'
