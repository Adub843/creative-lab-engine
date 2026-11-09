# Sets up the network heartbeat on NUC_SKULL: a Windows scheduled task that runs network-heartbeat.ps1 every
# 5 minutes, hidden, as you. Run once in PowerShell from this folder:  .\install-heartbeat.ps1
# Remove it any time with:  Unregister-ScheduledTask -TaskName "Creative Lab network heartbeat" -Confirm:$false
$script = Join-Path $PSScriptRoot "network-heartbeat.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Creative Lab network heartbeat" -Action $action -Trigger $trigger -Settings $settings -Description "Sends the home network status to the Creative Lab console's System map every 5 minutes." -Force | Out-Null
Write-Host "Installed. The console's Network map goes live within 5 minutes."
