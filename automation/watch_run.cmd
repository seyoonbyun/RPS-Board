@echo off
REM ---------------------------------------------------------------
REM RPS Board admin watchers - runs every 3 minutes via Task Scheduler.
REM
REM   intake_ack    new applications  -> "we got it" SMS to the applicant
REM   board_watch   new board posts   -> SMS + ledger
REM   region_watch  new region        -> sheet / RPI / QR / banner / imweb
REM   watcher       new chapter       -> full launch pipeline
REM   publish_watch page went live    -> notify owner + post the result
REM   dropdowns     keep intake sheet lists in step with Master
REM
REM Order matters: acknowledge first (fastest, cheapest), create next,
REM finish last. publish_watch only acts on rows already marked created.
REM
REM ASCII ONLY, CRLF ONLY. cmd.exe reads this in the OEM codepage; a single
REM Korean character in a comment kills the whole batch silently (it did,
REM 2026-08-23). Keep every byte in this file under 0x80.
REM
REM SMS is in TEST mode by default (everything goes to the admin number).
REM To go live, set MYPT_SMS_LIVE=1 in the scheduled task environment.
REM ---------------------------------------------------------------
setlocal
REM The watchers print UTF-8. Without this the log is written as CP949
REM mojibake and becomes unreadable exactly when you need it.
chcp 65001 > nul
set "HERE=%~dp0"
set "LOG=%HERE%watch_run.log"
REM Absolute path on purpose. Task Scheduler does not get the interactive
REM PATH, so a bare "python" resolves to nothing and the job dies silently.
set "PY=C:\Python314\python.exe"
if not exist "%PY%" set "PY=python"

echo. >> "%LOG%"
echo ==== %DATE% %TIME% ==== >> "%LOG%"

"%PY%" -u "%HERE%intake_ack.py" --apply >> "%LOG%" 2>&1
echo -- intake_ack exit=%ERRORLEVEL% >> "%LOG%"

"%PY%" -u "%HERE%board_watch.py" --apply >> "%LOG%" 2>&1
echo -- board_watch exit=%ERRORLEVEL% >> "%LOG%"

"%PY%" -u "%HERE%region_watch.py" --run --apply >> "%LOG%" 2>&1
echo -- region_watch exit=%ERRORLEVEL% >> "%LOG%"

"%PY%" -u "%HERE%watcher.py" --run --apply >> "%LOG%" 2>&1
echo -- watcher exit=%ERRORLEVEL% >> "%LOG%"

"%PY%" -u "%HERE%publish_watch.py" --apply >> "%LOG%" 2>&1
echo -- publish_watch exit=%ERRORLEVEL% >> "%LOG%"

"%PY%" -u "%HERE%dropdowns.py" --apply >> "%LOG%" 2>&1
echo -- dropdowns exit=%ERRORLEVEL% >> "%LOG%"

endlocal
