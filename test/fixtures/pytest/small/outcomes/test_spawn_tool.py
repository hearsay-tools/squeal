"""Runs `python tool.py`, a script that imports nothing (task 007-55, review 0.1.268 B2)."""

import os
import subprocess
import sys


def test_tool_runs():
    tool = os.path.join(os.path.dirname(__file__), "tool.py")
    done = subprocess.run([sys.executable, tool], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "ok\n"
