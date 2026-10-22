"""Runs the `app-cli` console script from `PATH`; nothing here imports `app.cli` (task 007-55)."""

import subprocess


def test_console_script_runs():
    done = subprocess.run(["app-cli"], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "app 0.1.0\n"
