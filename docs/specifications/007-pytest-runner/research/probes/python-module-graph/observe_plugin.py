"""Throwaway pytest plugin: what did each test file import? Load with `-p observe_plugin`.

OBSERVE_OUT=<file.json>   where to write
OBSERVE_MODE=modules      sys.modules snapshots: after collection and after the run (one file per process)
OBSERVE_MODE=edges        wrap builtins.__import__ and importlib.import_module from plugin load,
                          record (importer, imported) edges, per-file closure = reachability
OBSERVE_MODE=audit        sys.addaudithook "import" events, attributed to the file being collected/run
OBSERVE_MODE=none         load and do nothing (overhead baseline)
"""
import builtins
import importlib
import json
import os
import sys
import time

MODE = os.environ.get("OBSERVE_MODE", "modules")
OUT = os.environ.get("OBSERVE_OUT", "observe.json")
ROOT = os.path.realpath(os.environ.get("OBSERVE_ROOT", os.getcwd())) + os.sep


def project_modules():
    out = {}
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if f and os.path.realpath(f).startswith(ROOT) and "/.venv" not in f:
            out[name] = os.path.relpath(os.path.realpath(f), ROOT)
        elif f is None and hasattr(mod, "__path__"):
            # namespace package: record its directories
            for p in list(mod.__path__):
                if os.path.realpath(p).startswith(ROOT):
                    out[name] = os.path.relpath(os.path.realpath(p), ROOT) + "/"
    return out


edges = {}
current = {"file": None}
audit = {}
t0 = time.perf_counter()

if MODE == "edges":
    _orig_import = builtins.__import__
    _orig_import_module = importlib.import_module

    def _add(src, dst):
        edges.setdefault(src, set()).add(dst)

    def _record(src, mod, fromlist):
        name = getattr(mod, "__name__", None)
        if not name:
            return
        parts = name.split(".")
        for i in range(1, len(parts) + 1):
            _add(src, ".".join(parts[:i]))
        for item in fromlist or ():
            sub = f"{name}.{item}"
            if sub in sys.modules:
                _add(src, sub)

    def traced_import(name, globals=None, locals=None, fromlist=(), level=0):
        mod = _orig_import(name, globals, locals, fromlist, level)
        src = (globals or {}).get("__name__", "?")
        if level:
            pkg = (globals or {}).get("__package__") or ""
            full = importlib._bootstrap._resolve_name(name, pkg, level) if name else pkg
            target = sys.modules.get(full)
        elif fromlist:
            target = mod
        else:
            target = sys.modules.get(name)
        if target is not None:
            _record(src, target, fromlist)
        return mod

    def traced_import_module(name, package=None):
        mod = _orig_import_module(name, package)
        caller = sys._getframe(1).f_globals.get("__name__", "?")
        _record(caller, mod, ())
        return mod

    builtins.__import__ = traced_import
    importlib.import_module = traced_import_module

if MODE == "audit":
    def hook(event, args):
        if event == "import":
            audit.setdefault(current["file"] or "<session>", set()).add(args[0])
    sys.addaudithook(hook)


import pytest


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector):
    # a Module's collect() imports it: attribute imports to that file meanwhile
    prev = current["file"]
    if type(collector).__name__ == "Module":
        current["file"] = str(collector.path)
    try:
        return (yield)
    finally:
        current["file"] = prev


snap = {}


def pytest_collection_finish(session):
    if MODE == "modules":
        snap["collect"] = project_modules()


def pytest_runtest_setup(item):
    current["file"] = str(item.path)


def pytest_sessionfinish(session):
    data = {"mode": MODE, "plugin_s": time.perf_counter() - t0}
    if MODE == "modules":
        snap["end"] = project_modules()
        data.update(snap)
    elif MODE == "edges":
        data["edges"] = {k: sorted(v) for k, v in edges.items()}
        data["files"] = project_modules()
    elif MODE == "audit":
        data["audit"] = {k: sorted(v) for k, v in audit.items()}
    if MODE != "none":
        with open(OUT, "w") as f:
            json.dump(data, f)
