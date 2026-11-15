# Creates the NUC task "Creative Lab price requests": every minute it carries out the price changes Aaron confirmed
# with Steve (scripts\price-requests.mjs). A pass with nothing to do takes about a second and changes nothing.
# The console key is read from the saved store on this PC; it is never typed here and never printed.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'ai-jobs\runs\price-requests'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$node = (Get-Command node).Source
# The saved key lives in the Claude app's private folder; a scheduled task has to be told where that is.
$data = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\design-library' } | Where-Object { Test-Path $_ } | Select-Object -First 1
$cmd = Join-Path $out 'run.cmd'
$lines = @('@echo off', 'rem Made by scripts\schedule-price-requests.ps1. One pass of the price requests; the log keeps every change.')
if ($data) { $lines += "set `"DRIVE_DATA=$data`"" }
$lines += "cd /d `"$repo`""
$lines += "`"$node`" scripts\price-requests.mjs >> `"$(Join-Path $out 'log.txt')`" 2>&1"
Set-Content -Path $cmd -Value $lines -Encoding ascii
$vbs = Join-Path $repo 'scripts\run-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`" `"$cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Creative Lab price requests' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
'Task "Creative Lab price requests" created: every minute.'
