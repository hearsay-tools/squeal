import os
import subprocess
import sys
import time


def test_hang():
    # A child of the test's own, which a deadline must kill with the run's process group.
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    pid_file = os.environ.get("FIXTURE_HANG_PID_FILE")
    if pid_file:
        with open(pid_file, "w") as f:
            f.write(str(child.pid))
    time.sleep(600)
