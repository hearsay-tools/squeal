"""Squeal's pytest reporter (spec 007 D6), loaded with `-p squeal_pytest`.

Dependency-free and copied verbatim into each plugin's `dist/pytest/`. Writes
JSON lines to the file `SQUEAL_PYTEST_EVENTS` names, never to stdout, one
flushed line per record so a killed process leaves a readable prefix:

- `start`: the process, Python and pytest versions.
- `refused`: a flag D6 cannot override is in force; pytest then exits 4.
- `collect`: every collector's report (`pytest_make_collect_report`).
- `collected`: the items left after deselection, each with its name and file.
- `deselected`: node ids `-k`, `-m` or a plugin deselected.
- `focused`: per file given texts in `SQUEAL_PYTEST_CHECKS`, how many items
  it collected and how many the texts selected (row 011-135).
- `item`: an item starts.
- `phase`: every `pytest_runtest_logreport` (setup, call, teardown).
- `warning`: a recorded warning.
- `import`: an import edge (spec 007 D6, module-graph Q3).
- `spawned`: a project file a process the test started found to import,
  written by that process's `sitecustomize` (task 007-55).
- `session`: the session finished, with its exit status.

`builtins.__import__` and `importlib.import_module` are wrapped from load,
before any conftest. Each import writes `(importer, imported)` as files: the
importer is the calling module's `__file__`, and the file of the collector or
item in progress (`ctx`) stands in when the importer is not a project file,
such as pytest importing a test module. Outside every collector the nearest
project frame stands in, and with none pytest imported a conftest or a plugin.
The imported module's parent packages are edges too, since importing `a.b.c`
runs `a` and `a.b`; from that module itself when nothing stands in, so a
conftest's test packages belong to the files below it. Only files under
`SQUEAL_PYTEST_ROOT` and outside the environment are written, once per
`(ctx, importer, imported)`.

The file in progress is also `SQUEAL_PYTEST_FILE` in `os.environ`, as pytest
sets `PYTEST_CURRENT_TEST`, so the Python processes a test starts record
what they import under its file (`sitecustomize.py`, task 007-55).
"""

import atexit
import builtins
import importlib
import json
import os
import sys

import pytest

_ROOT = os.path.join(os.path.realpath(os.environ.get("SQUEAL_PYTEST_ROOT", os.getcwd())), "")
_PREFIXES = tuple(
    {os.path.join(os.path.realpath(p), "") for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)}
)
_out = open(os.environ.get("SQUEAL_PYTEST_EVENTS", os.devnull), "a", encoding="utf-8")
# Closed at `pytest_unconfigure`, or at exit when pytest stops before it, so
# no unclosed-file warning reaches a project that shows them (task 007-36).
atexit.register(_out.close)


def _write(record):
    if _out.closed:
        return
    _out.write(json.dumps(record, default=str) + "\n")
    _out.flush()


_write(
    {
        "type": "start",
        "pid": os.getpid(),
        "python": sys.version.split()[0],
        "pytest": pytest.__version__,
    }
)

# Import edges.

_ctx = [None]
_seen = set()
_files = {}


def _enter(path):
    """Makes `path` the file in progress, for this process and the ones it starts; returns the previous one."""
    previous = _ctx[0]
    _ctx[0] = path
    if path is None:
        os.environ.pop("SQUEAL_PYTEST_FILE", None)
    else:
        os.environ["SQUEAL_PYTEST_FILE"] = path
    return previous


def _project_file(path):
    """The real path of a project file, or None: outside the root or inside the environment."""
    if not path:
        return None
    known = _files.get(path)
    if known is None:
        real = os.path.realpath(path)
        inside = real.startswith(_ROOT) and not real.startswith(_PREFIXES)
        known = real if inside else ""
        _files[path] = known
    return known or None


def _module_file(name):
    module = sys.modules.get(name)
    return None if module is None else getattr(module, "__file__", None)


def _edge(ctx, source, imported):
    key = (ctx, source, imported)
    if key not in _seen:
        _seen.add(key)
        _write({"type": "import", "from": source, "to": imported, "ctx": ctx})


def _calling_project_file(frame):
    """The file of the nearest project frame above `frame`, or None."""
    while frame is not None:
        found = _project_file(frame.f_globals.get("__file__"))
        if found is not None:
            return found
        frame = frame.f_back
    return None


def _note(importer, ctx, target, fromlist, frame=None):
    """Writes the edges from `importer` (or `ctx`) to `target`, its parents and `fromlist` submodules.

    With neither, pytest or a library imports `target` outside every
    collector, at start-up or while a conftest loads. The importer is then
    the nearest project frame of the `frame` stack, such as a project module
    loading an entry point through `importlib.metadata` while the root
    conftest imports it. With none, pytest itself imports a conftest or a
    plugin: its parent packages are edges from `target`, so a conftest's test
    packages belong to the files below it, never to the session (task 007-36).
    """
    parts = target.split(".")
    parents = [".".join(parts[: i + 1]) for i in range(len(parts) - 1)]
    names = [target]
    for item in fromlist or ():
        if isinstance(item, str) and item != "*":
            names.append(target + "." + item)
    above = [f for f in (_project_file(_module_file(n)) for n in parents) if f is not None]
    files = [f for f in (_project_file(_module_file(n)) for n in names) if f is not None]
    if not above and not files:
        return
    source = _project_file(importer)
    if source is None and ctx is None and frame is not None:
        source = _calling_project_file(frame.f_back)
    leaf = _project_file(_module_file(target))
    via = leaf if source is None and ctx is None and leaf is not None else source
    for imported in above:
        _edge(ctx, via, imported)
    for imported in files:
        _edge(ctx, source, imported)


_original_import = builtins.__import__
_original_import_module = importlib.import_module


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    __tracebackhide__ = True
    module = _original_import(name, globals, locals, fromlist, level)
    try:
        # A direct `__import__("a.b")` call passes no globals: the caller's frame has them.
        frame = sys._getframe(1)
        caller = frame.f_globals if globals is None else globals
        if level:
            package = caller.get("__package__") or ""
            target = importlib._bootstrap._resolve_name(name, package, level) if name else package
        elif fromlist:
            target = getattr(module, "__name__", name)
        else:
            target = name
        _note(caller.get("__file__"), _ctx[0], target, fromlist, frame)
    except Exception:
        pass
    return module


def _import_module(name, package=None):
    __tracebackhide__ = True
    module = _original_import_module(name, package)
    try:
        frame = sys._getframe(1)
        _note(frame.f_globals.get("__file__"), _ctx[0], module.__name__, (), frame)
    except Exception:
        pass
    return module


builtins.__import__ = _import
importlib.import_module = _import_module

# `pytest_plugins` of a registered module: pytest imports them from its own
# code, so the edge from the module that names them is written here.

_wanted = {}


def _plugin_names(value):
    if isinstance(value, str):
        return [n.strip() for n in value.split(",") if n.strip()]
    if isinstance(value, (list, tuple)):
        return [n for n in value if isinstance(n, str)]
    return []


def pytest_plugin_registered(plugin, manager):
    name = getattr(plugin, "__name__", None)
    path = _project_file(getattr(plugin, "__file__", None))
    if path is not None:
        for wanted in _plugin_names(getattr(plugin, "pytest_plugins", None)):
            if _module_file(wanted) is not None:
                _note(path, None, wanted, ())
            else:
                _wanted.setdefault(wanted, []).append(path)
    for importer in _wanted.pop(name, ()) if name else ():
        _note(importer, None, name, ())


# Flags that change what runs or wait for input (spec 007 D6), by option
# destination, so abbreviations, `addopts`, `PYTEST_ADDOPTS` and plugin
# options are all seen.

_REFUSED = {
    "lf": "--lf",
    "failedfirst": "--ff",
    "stepwise": "--sw",
    "stepwise_skip": "--sw-skip",
    "usepdb": "--pdb",
    "trace": "--trace",
    "looponfail": "--looponfail",
    "update_snapshots": "--snapshot-update",
}


@pytest.hookimpl(trylast=True)
def pytest_configure(config):
    refused = sorted(
        flag for dest, flag in _REFUSED.items() if config.getoption(dest, default=None)
    )
    if refused:
        _write({"type": "refused", "flags": refused})
        raise pytest.UsageError("Squeal does not run pytest with " + ", ".join(refused))


# Reports.


def _text(longrepr):
    if longrepr is None:
        return None
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return str(longrepr[2])
    return str(longrepr)


def _crash(longrepr):
    crash = getattr(longrepr, "reprcrash", None)
    if crash is None:
        return None
    return {"path": crash.path, "line": crash.lineno, "message": crash.message}


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector):
    file = isinstance(collector, pytest.File)
    previous = _enter(os.path.realpath(collector.path)) if file else None
    try:
        report = yield
    finally:
        if file:
            _enter(previous)
    _write(
        {
            "type": "collect",
            "nodeid": report.nodeid,
            "kind": type(collector).__name__,
            "path": os.path.realpath(collector.path),
            "outcome": report.outcome,
            "longrepr": _text(report.longrepr) if report.outcome != "passed" else None,
        }
    )
    return report


def pytest_deselected(items):
    _write({"type": "deselected", "nodeids": [item.nodeid for item in items]})


# A focused run (spec 007 D6, row 011-135): `SQUEAL_PYTEST_CHECKS` maps a test
# file's real path to texts, and an item of that file runs only when its full
# name, the node id after the first `::`, holds one. The others are
# deselected through the hook, so pytest counts them deselected.

_CHECKS = json.loads(os.environ.get("SQUEAL_PYTEST_CHECKS") or "{}")


def _full_name(nodeid):
    return nodeid.split("::", 1)[1] if "::" in nodeid else nodeid


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(session, config, items):
    if not _CHECKS:
        return
    counts = {path: {"collected": 0, "matched": 0} for path in _CHECKS}
    kept = []
    deselected = []
    for item in items:
        path = os.path.realpath(item.path)
        texts = _CHECKS.get(path)
        if texts is None:
            kept.append(item)
            continue
        counts[path]["collected"] += 1
        if any(text in _full_name(item.nodeid) for text in texts):
            counts[path]["matched"] += 1
            kept.append(item)
        else:
            deselected.append(item)
    _write({"type": "focused", "files": counts})
    if deselected:
        config.hook.pytest_deselected(items=deselected)
        items[:] = kept


def pytest_collection_finish(session):
    _write(
        {
            "type": "collected",
            "items": [
                {"nodeid": item.nodeid, "name": item.name, "path": os.path.realpath(item.path)}
                for item in session.items
            ],
        }
    )


@pytest.hookimpl(wrapper=True)
def pytest_runtest_protocol(item, nextitem):
    previous = _enter(os.path.realpath(item.path))
    _write({"type": "item", "nodeid": item.nodeid, "last": nextitem is None})
    try:
        return (yield)
    finally:
        _enter(previous)


def pytest_runtest_logreport(report):
    path, line, domain = report.location
    _write(
        {
            "type": "phase",
            "nodeid": report.nodeid,
            "when": report.when,
            "outcome": report.outcome,
            "duration": report.duration,
            "location": {"path": path, "line": line, "domain": domain},
            "longrepr": _text(report.longrepr),
            "crash": _crash(report.longrepr),
            "wasxfail": getattr(report, "wasxfail", None),
        }
    )


def pytest_warning_recorded(warning_message, when, nodeid, location):
    _write(
        {
            "type": "warning",
            "when": when,
            "nodeid": nodeid,
            "category": warning_message.category.__name__,
            "message": str(warning_message.message),
        }
    )


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    _write({"type": "session", "exitstatus": int(exitstatus)})


@pytest.hookimpl(trylast=True)
def pytest_unconfigure(config):
    _out.close()
