"""Passes when the environment's own `sitecustomize` ran here and in a child process (task 007-55).

Squeal's start-up hook shadows it on `PYTHONPATH` and must run it. The test
that installs one that sets the marker is `test/runners/pytest/spawned.test.ts`.
"""

import builtins
import subprocess
import sys


def test_environment_sitecustomize_ran():
    assert getattr(builtins, "FIXTURE_SITECUSTOMIZE", None) == "ran"
    check = "import builtins; print(builtins.FIXTURE_SITECUSTOMIZE)"
    done = subprocess.run([sys.executable, "-c", check], capture_output=True, text=True)
    assert done.stdout == "ran\n", done.stderr
