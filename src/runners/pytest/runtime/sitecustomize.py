"""Squeal's start-up hook for the Python processes a test starts (spec 007 D6, task 007-55).

Dependency-free and copied verbatim beside `squeal_pytest.py`, whose
directory is on the run's `PYTHONPATH`, so every Python process of the run
imports this module at start-up: the pytest process, and each process a
test starts with the environment it inherited, a console script's too.
`squeal_pytest` names the test file in progress in `SQUEAL_PYTEST_FILE`;
the pytest process starts without it, so only the processes a test starts
record. Such a process appends a `spawned` record to the batch's events file
(`SQUEAL_PYTEST_EVENTS`) for each project file it finds to import, and for
the script it runs, under that test file. Only files under
`SQUEAL_PYTEST_ROOT` and outside the environment are written, once each.

A file is recorded when the import system finds it, before it runs, so a
module that raises on import is recorded too. Each record is one `write` to
a file opened for appending, so records of processes running at once do not
interleave.

Python imports only the first `sitecustomize` on `sys.path`: the one this
module shadows, an environment's or a distribution's, runs after it.
Without `SQUEAL_PYTEST_FILE` that is all this module does.
"""

import os
import sys


class _Recorder:
    """A `sys.meta_path` finder: asks the finders after it, and records the project file they found."""

    def __init__(self, test_file, events, root):
        self.test_file = test_file
        self.events = events
        self.root = os.path.join(os.path.realpath(root), "")
        self.prefixes = tuple(
            {os.path.join(os.path.realpath(p), "") for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)}
        )
        self.seen = set()
        self.fd = None
        self.script = False

    def find_spec(self, name, path=None, target=None):
        if not self.script:
            # `python tool.py` runs its script, which no finder finds, before its first import.
            main = getattr(sys.modules.get("__main__"), "__file__", None)
            if main:
                self.script = True
                self.record(main)
        for at, finder in enumerate(sys.meta_path):
            if finder is self:
                break
        else:
            return None
        for finder in sys.meta_path[at + 1 :]:
            find = getattr(finder, "find_spec", None)
            if find is None:
                # A finder of the old protocol: the import system asks it and those after it.
                return None
            spec = find(name, path, target)
            if spec is not None:
                if spec.has_location:
                    self.record(spec.origin)
                return spec
        return None

    def record(self, path):
        try:
            real = os.path.realpath(path)
            if real in self.seen:
                return
            self.seen.add(real)
            if real.startswith(self.root) and not real.startswith(self.prefixes):
                self.write({"type": "spawned", "to": real, "ctx": self.test_file, "pid": os.getpid()})
        except Exception:
            pass

    def write(self, record):
        import json

        if self.fd is None:
            self.fd = os.open(self.events, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        os.write(self.fd, (json.dumps(record) + "\n").encode("utf-8"))


def _record():
    test_file = os.environ.get("SQUEAL_PYTEST_FILE")
    events = os.environ.get("SQUEAL_PYTEST_EVENTS")
    root = os.environ.get("SQUEAL_PYTEST_ROOT")
    if test_file and events and root:
        sys.meta_path.insert(0, _Recorder(test_file, events, root))


def _chain():
    """Runs the next `sitecustomize` on `sys.path` after this module's directory, as `site` would have."""
    here = os.path.dirname(os.path.abspath(__file__))
    entries = [os.path.abspath(p) for p in sys.path]
    if here not in entries:
        return
    # After its last entry: the directory twice on `PYTHONPATH` must not find this module again.
    last = len(entries) - 1 - entries[::-1].index(here)
    from importlib.machinery import PathFinder

    spec = PathFinder.find_spec("sitecustomize", sys.path[last + 1 :])
    if spec is None or spec.loader is None:
        return
    from importlib.util import module_from_spec

    module = module_from_spec(spec)
    sys.modules["sitecustomize"] = module
    spec.loader.exec_module(module)


try:
    _record()
except Exception:
    pass
_chain()
