"""Throwaway bounded PTY check of installed btop; no unrelated rows saved."""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

prefix = "squeal cezarion daemon"
node = subprocess.check_output(["which", "node"], text=True).strip()
with tempfile.TemporaryDirectory(prefix="squeal-prefix-ui-") as temporary:
    config = Path(temporary) / "btop"
    config.mkdir()
    (config / "btop.conf").write_text(
        'shown_boxes = "proc"\nproc_tree = False\n'
        'proc_filter = "squeal-prefix-ui-probe"\n'
        'proc_sorting = "pid"\nupdate_ms = 1000\n'
        'check_temp = False\nshow_battery = False\n'
    )
    child = subprocess.Popen(
        [prefix, "-e", "setTimeout(()=>{},10000)", "squeal-prefix-ui-probe"],
        executable=node,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    monitor, fd = pty.fork()
    if monitor == 0:
        os.environ["XDG_CONFIG_HOME"] = temporary
        os.environ["TERM"] = "xterm-256color"
        os.execvp("btop", ["btop", "--utf-force", "-u", "1000"])
    data = bytearray()
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 160, 0, 0))
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], 0.2)
            if readable:
                try:
                    data.extend(os.read(fd, 65536))
                except OSError:
                    break
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", data.decode(errors="replace"))
        # Match the fixture's PID, process-name field and Command prefix together.
        match = re.search(r"\b" + str(child.pid) + r"\s+(?:MainThread|node)\s+" + re.escape(prefix) + r"[^\r\n]{0,80}", text)
        assert match, "fixture PID and prefix were not rendered together"
        print(json.dumps({
            "btop": subprocess.check_output(["btop", "--version"], text=True).strip(),
            "terminal": "160 columns x 40 rows, normal process view",
            "fixturePid": child.pid,
            "renderedRowStart": match.group(0),
            "prefixObserved": True,
        }, indent=2))
    finally:
        try:
            os.write(fd, b"q")
        except OSError:
            pass
        # Bound shutdown; waitpid reaps the monitor even after a failed assertion.
        time.sleep(0.2)
        if os.waitpid(monitor, os.WNOHANG)[0] == 0:
            os.kill(monitor, signal.SIGTERM)
            os.waitpid(monitor, 0)
        os.close(fd)
        child.terminate()
        child.wait(timeout=2)
