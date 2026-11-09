# Register "MyPowerteam RPS Sheet Touch" - reads every _rps sheet every 20 min
# so IMPORTRANGE views stay fresh (RPS-02, 2026-11-09). ASCII only on purpose.
# Run once:  powershell -NoProfile -ExecutionPolicy Bypass -File C:\DEV\RPS-Board\automation\register_sheet_touch.ps1
$name = 'MyPowerteam RPS Sheet Touch'
$here = 'C:\DEV\RPS-Board\automation'
$act  = New-ScheduledTaskAction -Execute 'C:\Python314\pythonw.exe' `
          -Argument "`"$here\hidden_run.py`" --log rps_sheet_touch.log -- C:\Python314\python.exe -X utf8 rps_sheet_touch.py" `
          -WorkingDirectory $here
$trig = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 20)
$set  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew -Hidden
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trig -Settings $set `
  -Description 'Read all RPS_Sheets _rps sheets every 20 min to refresh IMPORTRANGE (read-only). RPS-02 2026-11-09' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 90
$i = Get-ScheduledTaskInfo $name
"Last=$($i.LastRunTime) Result=$($i.LastTaskResult) Next=$($i.NextRunTime)"
Get-Content "$here\rps_sheet_touch.log" -Tail 4
