import os
import subprocess
import sys
import time


def test_hang():
    # A child of the test's own, which a deadline must kill with the run's process group.
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    pid_file = os.environ.get("FIXTURE_HANG_PID_FILE")
    if pid_file:
        # Written whole, by temp file and rename: a reader that sees the file sees the pid
        # (row 011-430; an empty read gave pid 0, which always looks alive).
        with open(pid_file + ".tmp", "w") as f:
            f.write(str(child.pid))
        os.replace(pid_file + ".tmp", pid_file)
    time.sleep(600)
