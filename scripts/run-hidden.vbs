' Runs a command with no window at all and passes its exit code back. Scheduled tasks use this because
' "powershell -WindowStyle Hidden" still flashes a window on the screen each time it starts.
'   wscript.exe //B //Nologo run-hidden.vbs powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\script.ps1"
Dim sh, cmd, a
Set sh = CreateObject("WScript.Shell")
cmd = ""
For Each a In WScript.Arguments
  If InStr(a, " ") > 0 Then
    cmd = cmd & """" & a & """ "
  Else
    cmd = cmd & a & " "
  End If
Next
If Len(cmd) = 0 Then WScript.Quit 64
WScript.Quit sh.Run(Trim(cmd), 0, True)
