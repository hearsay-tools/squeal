# Throwaway helpers shared by probes: static closures from a graph JSON and observed closures from truth files.
import ast as _ast, json as _json, os as _os
_fix, _gpath, _truth_dir = sys.argv[1:4]
_g = _json.load(open(_gpath))["files"]

def _plugins(conftest):
    try:
        tree = _ast.parse(open(_os.path.join(_fix, conftest)).read())
    except OSError:
        return []
    for node in tree.body:
        if isinstance(node, _ast.Assign) and any(getattr(t, "id", None) == "pytest_plugins" for t in node.targets):
            return [e.value.replace(".", "/") + ".py" for e in node.value.elts]
    return []

def roots(test):
    out = [test]
    parts = test.split("/")[:-1]
    for i in range(len(parts) + 1):
        c = "/".join(parts[:i] + ["conftest.py"])
        if c in _g:
            out.append(c)
            out += [p for p in _plugins(c) if p in _g]
    return out

def static_closure(test):
    seen, todo = set(), roots(test)
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        todo += _g.get(f, {}).get("edges", [])
    return seen

_truth = {}
for _n in _os.listdir(_truth_dir):
    _t = _json.load(open(_os.path.join(_truth_dir, _n)))
    _s = {p for p in _t["end"].values() if not p.endswith("/")}
    _test = [p for p in _s if p.replace("/", "_") + ".json" == _n]
    if _test:
        _truth[_test[0]] = _s

def affected_static(path):
    return {t for t in _truth if path in static_closure(t) or t == path}

def affected_observed(path):
    return {t for t, s in _truth.items() if path in s}
