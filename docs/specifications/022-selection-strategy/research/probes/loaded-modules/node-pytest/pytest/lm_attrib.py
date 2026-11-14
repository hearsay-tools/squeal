"""Throwaway pytest plugin: three ways to attribute loaded project modules to a test file
in ONE pytest process, written as JSON to $LM_OUT at session end.

- sysmodules: set(sys.modules) difference over the file's collection plus its items' run.
- metapath:   a sys.meta_path finder at position 0; each project module found (first import
              only, since cached imports never reach finders) goes to the file in progress.
- edges:      builtins.__import__ wrapper writing importer->imported file edges (every import
              statement, cached too), then reachability from the test file and its conftests
              over the whole session's edges (the approach of Squeal's squeal_pytest.py).
Load with `-p lm_attrib` and this directory on PYTHONPATH. LM_ROOT = fixture root.
"""
import builtins, json, os, sys

ROOT = os.path.join(os.path.realpath(os.environ["LM_ROOT"]), "")
_cur = [None]
sysmods, metapath, edges = {}, {}, set()

def _proj(path):
    if not path:
        return None
    real = os.path.realpath(path)
    return real[len(ROOT):] if real.startswith(ROOT) and "site-packages" not in real else None

def _file_of(name):
    return _proj(getattr(sys.modules.get(name), "__file__", None))

class Finder:
    def find_spec(self, name, path=None, target=None):
        for f in sys.meta_path:
            if f is self or not hasattr(f, "find_spec"):
                continue
            spec = f.find_spec(name, path, target)
            if spec is not None:
                p = _proj(spec.origin)
                if p and _cur[0]:
                    metapath.setdefault(_cur[0], set()).add(p)
                return spec
        return None

sys.meta_path.insert(0, Finder())
_orig = builtins.__import__

def _import(name, globals=None, locals=None, fromlist=(), level=0):
    mod = _orig(name, globals, locals, fromlist, level)
    try:
        g = globals if globals is not None else sys._getframe(1).f_globals
        src = _proj(g.get("__file__")) or _cur[0]
        if level:
            import importlib._bootstrap as b
            target = b._resolve_name(name, g.get("__package__") or "", level) if name else g.get("__package__")
        else:
            target = getattr(mod, "__name__", name) if fromlist else name
        parts = target.split(".")
        names = [".".join(parts[: i + 1]) for i in range(len(parts))] + [target + "." + x for x in (fromlist or ()) if isinstance(x, str) and x != "*"]
        for n in names:
            t = _file_of(n)
            if t and src and t != src:
                edges.add((src, t))
    except Exception:
        pass
    return mod

builtins.__import__ = _import

import pytest  # noqa: E402

def _span(path):
    before = set(sys.modules)
    return before

_open = {}

@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector):
    if not isinstance(collector, pytest.File):
        return (yield)
    f = _proj(str(collector.path)); prev = _cur[0]; _cur[0] = f
    before = set(sys.modules)
    try:
        return (yield)
    finally:
        sysmods.setdefault(f, set()).update(filter(None, (_file_of(n) for n in set(sys.modules) - before)))
        _cur[0] = prev

@pytest.hookimpl(wrapper=True)
def pytest_runtest_protocol(item, nextitem):
    f = _proj(str(item.path)); prev = _cur[0]; _cur[0] = f
    before = set(sys.modules)
    try:
        return (yield)
    finally:
        sysmods.setdefault(f, set()).update(filter(None, (_file_of(n) for n in set(sys.modules) - before)))
        _cur[0] = prev

def pytest_sessionfinish(session):
    tests = sorted(set(sysmods) | set(metapath))
    conftests = sorted({b for a, b in edges if b.endswith("conftest.py")} | {a for a, b in edges if a.endswith("conftest.py")})
    kids = {}
    for a, b in edges:
        kids.setdefault(a, set()).add(b)
    def reach(roots):
        seen, todo = set(), list(roots)
        while todo:
            n = todo.pop()
            if n in seen:
                continue
            seen.add(n); todo.extend(kids.get(n, ()))
        return seen
    out = {}
    for t in tests:
        own = [c for c in conftests if os.path.dirname(t).startswith(os.path.dirname(c))]
        out[t] = {"sysmodules": sorted(sysmods.get(t, ())), "metapath": sorted(metapath.get(t, ())), "edges": sorted(reach([t, *own]) - {t})}
    out["_session_all_modules"] = sorted(filter(None, (_file_of(n) for n in list(sys.modules))))
    with open(os.environ["LM_OUT"], "w") as fh:
        json.dump(out, fh, indent=1)
