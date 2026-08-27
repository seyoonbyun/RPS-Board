"""Run a scheduled command without a console window popping up.

Task Scheduler runs this with pythonw.exe, which has no console of its own,
and CREATE_NO_WINDOW gives the child (plus anything it spawns) a console that
is never displayed.  Before this, the 3-minute watcher flashed a black
cmd.exe window onto the desktop 480 times a day (2026-08-24).

    pythonw.exe hidden_run.py [--log NAME] [--cwd DIR] -- <command> [args...]

Without --log the child's output is dropped (watch_run.cmd already writes its
own log).  With --log the output is appended to NAME - relative names land
next to this file - because pythonw.exe cannot redirect anything itself, and a
python child whose stdout is closed dies on its first print().

A relative command path and a relative --log are resolved against this
directory, because Task Scheduler does not hand the job the interactive PATH.
The working directory is left exactly as inherited (the task's own
WorkingDirectory) unless --cwd says otherwise: changing it silently would
break any payload that resolves a path relative to it.
"""

import os
import subprocess
import sys
import time

CREATE_NO_WINDOW = 0x08000000

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    log = None
    cwd = None
    while len(argv) >= 2 and argv[0] in ("--log", "--cwd"):
        if argv[0] == "--log":
            log = argv[1]
        else:
            cwd = argv[1]
        argv = argv[2:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    if not argv:
        return 2

    cmd = list(argv)
    local = os.path.join(HERE, cmd[0])
    if os.path.exists(local):
        cmd[0] = local

    if log is None:
        out = subprocess.DEVNULL
        handle = None
    else:
        if not os.path.isabs(log):
            log = os.path.join(HERE, log)
        handle = open(log, "a", encoding="utf-8", errors="replace")
        handle.write("\n==== %s ====\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
        handle.flush()
        out = handle

    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            creationflags=CREATE_NO_WINDOW,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=subprocess.STDOUT,
        )
    finally:
        if handle is not None:
            handle.close()
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
