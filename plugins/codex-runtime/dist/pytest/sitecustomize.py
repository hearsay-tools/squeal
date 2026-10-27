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

The script, the file `sys.argv[0]` names, is recorded at start-up, so one
that imports nothing is recorded too. A module is recorded when the import
system finds it, before it runs, so one that raises on import is recorded
too. Each record is one `write` to a file opened for appending, so records
of processes running at once do not interleave.

Directory creates and removes (spec 016 D4, the written-directory bound):
in every process of the run, the pytest process too, `os.mkdir`,
`os.rmdir`, `os.rename` and `os.replace` append a `written` record of the
project path they name, before the call, under the test file in progress,
`SQUEAL_PYTEST_FILE` read at the call (the plugin sets it in the pytest
process). `os.makedirs`, `tempfile.mkdtemp` and `pathlib` make their
directories through `os.mkdir`; `shutil.rmtree` removes the directory it
is given through `os.rmdir`, so `shutil` is not imported here. A call that
names its path relative to a `dir_fd` is not recorded, nor is a file write.

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

    def find_spec(self, name, path=None, target=None):
        finders = list(sys.meta_path)
        # Those after this one: none when a caller holds it off `sys.meta_path`.
        later = finders[finders.index(self) + 1 :] if self in finders else []
        for finder in later:
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
        recorder = _Recorder(test_file, events, root)
        sys.meta_path.insert(0, recorder)
        # `python tool.py` runs a file no finder finds; one that imports nothing asks no finder at all.
        if os.path.isfile(sys.argv[0]):
            recorder.record(sys.argv[0])


def _record_directories():
    events = os.environ.get("SQUEAL_PYTEST_EVENTS")
    root = os.environ.get("SQUEAL_PYTEST_ROOT")
    if not events or not root:
        return
    inside = os.path.join(os.path.realpath(root), "")
    prefixes = tuple(
        {os.path.join(os.path.realpath(p), "") for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)}
    )
    named = set()
    seen = set()
    fd = [None]

    def record(path):
        try:
            test_file = os.environ.get("SQUEAL_PYTEST_FILE")
            if not test_file:
                return
            # A path named before costs one `getcwd` and one set lookup; a new one a `realpath`.
            asked = (test_file, os.path.join(os.getcwd(), os.fsdecode(os.fspath(path))))
            if asked in named:
                return
            named.add(asked)
            real = os.path.realpath(asked[1])
            if (test_file, real) in seen:
                return
            seen.add((test_file, real))
            if real.startswith(inside) and not real.startswith(prefixes):
                import json

                if fd[0] is None:
                    fd[0] = os.open(events, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
                line = json.dumps({"type": "written", "path": real, "ctx": test_file})
                os.write(fd[0], (line + "\n").encode("utf-8"))
        except Exception:
            pass

    class Recorded:
        """Records the paths a call names, then calls `original`.

        An object, not a function: a function is a descriptor, and Python
        3.10's `pathlib` holds `os.mkdir` as a class attribute, which would
        then bind as a method; a builtin, as this, does not bind.
        """

        __slots__ = ("count", "__wrapped__")

        def __init__(self, original, count):
            self.__wrapped__ = original
            self.count = count

        def __call__(self, *args, **kwargs):
            if kwargs.get("dir_fd") is None and kwargs.get("src_dir_fd") is None:
                named = [kwargs[k] for k in ("path", "src", "dst") if k in kwargs]
                for path in [*args[: self.count], *named]:
                    record(path)
            return self.__wrapped__(*args, **kwargs)

    for name, count in (("mkdir", 1), ("rmdir", 1), ("rename", 2), ("replace", 2)):
        setattr(os, name, Recorded(getattr(os, name), count))


def _chain():
    """Runs the next `sitecustomize` on `sys.path` after this module's directory, as `site` would have."""
    here = os.path.dirname(os.path.abspath(__file__))
    entries = [os.path.abspath(p) for p in sys.path]
    # After its last entry: the directory twice on `PYTHONPATH` must not find this module again.
    after = len(entries) - entries[::-1].index(here) if here in entries else len(entries)
    from importlib.machinery import PathFinder

    spec = PathFinder.find_spec("sitecustomize", sys.path[after:])
    if spec is None or spec.loader is None:
        return
    from importlib.util import module_from_spec

    module = module_from_spec(spec)
    sys.modules["sitecustomize"] = module
    spec.loader.exec_module(module)


_record()
_record_directories()
_chain()
