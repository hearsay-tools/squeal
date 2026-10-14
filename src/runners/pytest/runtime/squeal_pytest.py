"""Squeal's pytest reporter (spec 007 D6), loaded with `-p squeal_pytest`.

Dependency-free and copied verbatim into each plugin's `dist/pytest/`. Writes
JSON lines to the file `SQUEAL_PYTEST_EVENTS` names, never to stdout, one
flushed line per record so a killed process leaves a readable prefix:

- `start`: the process, Python and pytest versions.
- `refused`: a flag D6 cannot override is in force; pytest then exits 4.
- `collect`: every collector's report (`pytest_make_collect_report`).
- `collected`: the items left after deselection, each with its file.
- `deselected`: node ids `-k`, `-m` or a plugin deselected.
- `item`: an item starts.
- `phase`: every `pytest_runtest_logreport` (setup, call, teardown).
- `warning`: a recorded warning.
- `import`: an import edge (spec 007 D6, module-graph Q3).
- `session`: the session finished, with its exit status.

`builtins.__import__` and `importlib.import_module` are wrapped from load,
before any conftest. Each import writes `(importer, imported)` as files: the
importer is the calling module's `__file__`, and the file of the collector or
item in progress (`ctx`) stands in when the importer is not a project file,
such as pytest importing a test module. The imported module's parent packages
are edges too, since importing `a.b.c` runs `a` and `a.b`. Only files under
`SQUEAL_PYTEST_ROOT` and outside the environment are written, once per
`(ctx, importer, imported)`.
"""

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


def _write(record):
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


def _note(importer, ctx, target, fromlist):
    """Writes the edges from `importer` (or `ctx`) to `target`, its parents and `fromlist` submodules."""
    source = _project_file(importer)
    parts = target.split(".")
    names = [".".join(parts[: i + 1]) for i in range(len(parts))]
    for item in fromlist or ():
        if isinstance(item, str) and item != "*":
            names.append(target + "." + item)
    for name in names:
        imported = _project_file(_module_file(name))
        if imported is None:
            continue
        key = (ctx, source, imported)
        if key in _seen:
            continue
        _seen.add(key)
        _write({"type": "import", "from": source, "to": imported, "ctx": ctx})


_original_import = builtins.__import__
_original_import_module = importlib.import_module


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    module = _original_import(name, globals, locals, fromlist, level)
    try:
        # A direct `__import__("a.b")` call passes no globals: the caller's frame has them.
        caller = sys._getframe(1).f_globals if globals is None else globals
        if level:
            package = caller.get("__package__") or ""
            target = importlib._bootstrap._resolve_name(name, package, level) if name else package
        elif fromlist:
            target = getattr(module, "__name__", name)
        else:
            target = name
        _note(caller.get("__file__"), _ctx[0], target, fromlist)
    except Exception:
        pass
    return module


def _import_module(name, package=None):
    module = _original_import_module(name, package)
    try:
        caller = sys._getframe(1).f_globals
        _note(caller.get("__file__"), _ctx[0], module.__name__, ())
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
    previous = _ctx[0]
    if isinstance(collector, pytest.File):
        _ctx[0] = os.path.realpath(collector.path)
    try:
        report = yield
    finally:
        _ctx[0] = previous
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


def pytest_collection_finish(session):
    _write(
        {
            "type": "collected",
            "items": [
                {"nodeid": item.nodeid, "path": os.path.realpath(item.path)}
                for item in session.items
            ],
        }
    )


@pytest.hookimpl(wrapper=True)
def pytest_runtest_protocol(item, nextitem):
    previous = _ctx[0]
    _ctx[0] = os.path.realpath(item.path)
    _write({"type": "item", "nodeid": item.nodeid, "last": nextitem is None})
    try:
        return (yield)
    finally:
        _ctx[0] = previous


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
