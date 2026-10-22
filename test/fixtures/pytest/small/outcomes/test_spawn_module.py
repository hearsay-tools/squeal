"""Runs `python -m app` in a child process; nothing here imports `app.cli` (task 007-55)."""

import subprocess
import sys


def test_module_runs():
    done = subprocess.run([sys.executable, "-m", "app"], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "app 0.1.0\n"
