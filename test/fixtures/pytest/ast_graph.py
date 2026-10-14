"""Graph oracle (spec 007 Testing): static import graph with the project's own interpreter, `ast` + its real finders.

<venv>/bin/python -I ast_graph.py <root> <out.json> [--skip-type-checking]

Parses every .py under <root> (skipping .venv*), resolves each import through the
interpreter's own sys.meta_path (PathFinder, editable finders) without executing any
project module: parent __path__ lists are computed from specs, never from imports.
pytest's prepend rule is modelled: each test/conftest's basedir is put first on sys.path.
Output: {"files": {path: {"module": name, "edges": [path...], "unresolved": [...],
                           "computed": [lineno...], "candidates": [absent path...]}},
         "timing": {...}}
"""
import ast
import importlib.machinery
import json
import os
import sys
import time

root = os.path.realpath(sys.argv[1])
out = sys.argv[2]
SKIP_TC = "--skip-type-checking" in sys.argv
t0 = time.perf_counter()

py_files = []
for d, dirs, files in os.walk(root):
    dirs[:] = [x for x in dirs if not x.startswith(".venv") and x not in ("__pycache__", ".git", "node_modules")]
    py_files += [os.path.join(d, f) for f in files if f.endswith(".py")]
py_files.sort()


def basedir(path):
    """pytest prepend: first directory upwards without __init__.py; module name relative to it."""
    d = os.path.dirname(path)
    parts = [os.path.splitext(os.path.basename(path))[0]]
    while os.path.exists(os.path.join(d, "__init__.py")):
        parts.insert(0, os.path.basename(d))
        d = os.path.dirname(d)
    return d, ".".join(parts)


def is_tc(test):
    return (isinstance(test, ast.Name) and test.id == "TYPE_CHECKING") or (
        isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING")


def scan(tree):
    """Yield (kind, module, names, level, lineno). kind: import|from|dynamic|computed."""
    stack = [(tree, False)]
    while stack:
        node, in_tc = stack.pop()
        for child in ast.iter_child_nodes(node):
            tc = in_tc
            if isinstance(node, ast.If) and is_tc(node.test) and child in node.body:
                tc = True
            if tc and SKIP_TC:
                continue
            if isinstance(child, ast.Import):
                for a in child.names:
                    yield "import", a.name, (), 0, child.lineno
            elif isinstance(child, ast.ImportFrom):
                yield "from", child.module or "", tuple(a.name for a in child.names), child.level, child.lineno
            elif isinstance(child, ast.Call):
                fn = child.func
                fname = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
                if fname in ("import_module", "__import__") and child.args:
                    a0 = child.args[0]
                    if isinstance(a0, ast.Constant) and isinstance(a0.value, str):
                        yield "dynamic", a0.value, (), 0, child.lineno
                    else:
                        yield "computed", None, (), 0, child.lineno
            stack.append((child, tc))


spec_cache = {}


def find(fullname):
    """Resolve like the import system, without executing modules."""
    if fullname in spec_cache:
        return spec_cache[fullname]
    spec = None
    parent_path = None
    if "." in fullname:
        parent = find(fullname.rpartition(".")[0])
        if parent is None or parent.submodule_search_locations is None:
            spec_cache[fullname] = None
            return None
        parent_path = list(parent.submodule_search_locations)
    for finder in sys.meta_path:
        fs = getattr(finder, "find_spec", None)
        if fs is None:
            continue
        try:
            spec = fs(fullname, parent_path)
        except Exception:
            spec = None
        if spec is not None:
            break
    if spec is None and parent_path:
        # PathFinder builds a child namespace spec only when the parent is in sys.modules
        # (it raises KeyError otherwise); build the portion list as it would.
        last = fullname.rpartition(".")[2]
        portions = [os.path.join(p, last) for p in parent_path if os.path.isdir(os.path.join(p, last))]
        if portions:
            spec = importlib.machinery.ModuleSpec(fullname, None, is_package=True)
            spec.submodule_search_locations = portions
    spec_cache[fullname] = spec
    return spec


_real = {}


def realpath(p):
    r = _real.get(p)
    if r is None:
        r = _real[p] = os.path.realpath(p)
    return r


def spec_files(spec):
    """Project files a spec stands for: its origin, or for a namespace package nothing."""
    if spec is None or not spec.origin or spec.origin in ("built-in", "frozen"):
        return []
    p = realpath(spec.origin)
    return [p] if p.startswith(root + os.sep) and "/.venv" not in p else []


def candidates(fullname):
    """Absent paths inside the root that would take over `fullname` if created: in every
    search location before the winning one (all of them when it does not resolve)."""
    parent, _, last = fullname.rpartition(".")
    if parent:
        ps = find(parent)
        locs = list(ps.submodule_search_locations) if ps is not None and ps.submodule_search_locations else []
    else:
        locs = [p for p in sys.path if p]
    spec = find(fullname)
    won = os.path.dirname(spec.origin) if spec is not None and spec.origin else None
    out = []
    for d in locs:
        rd = realpath(d)
        if won and spec.origin and os.path.dirname(realpath(spec.origin)) in (rd, os.path.join(rd, last)):
            break
        if (not rd.startswith(root + os.sep) and rd != root) or "/.venv" in rd:
            continue
        for c in (os.path.join(rd, last + ".py"), os.path.join(rd, last, "__init__.py")):
            if not os.path.exists(c):
                out.append(c)
    return out


def resolve_chain(name):
    """`import a.b.c` loads a, a.b, a.b.c: return files of each, and whether the leaf resolved."""
    files, parts = [], name.split(".")
    for i in range(1, len(parts) + 1):
        s = find(".".join(parts[:i]))
        if s is None:
            return files, False
        files += spec_files(s)
    return files, True


for path in py_files:
    b = os.path.basename(path)
    if b == "conftest.py" or (b.startswith("test_") and b.endswith(".py")) or b.endswith("_test.py"):
        bd = basedir(path)[0]
        if bd not in sys.path:
            sys.path.insert(0, bd)
importlib.machinery.PathFinder.invalidate_caches()

parse_s = 0.0
resolve_s = 0.0
result = {}
for path in py_files:
    t = time.perf_counter()
    try:
        tree = ast.parse(open(path, "rb").read(), path)
    except SyntaxError as e:
        result[os.path.relpath(path, root)] = {"edges": [], "unresolved": [], "computed": [], "syntax_error": str(e)}
        continue
    imports = list(scan(tree))
    parse_s += time.perf_counter() - t
    t = time.perf_counter()
    bd, modname = basedir(path)
    is_pkg = path.endswith("__init__.py")
    if modname.endswith(".__init__"):
        modname = modname[: -len(".__init__")]
    package = modname if is_pkg else modname.rpartition(".")[0]
    edges, unresolved, computed = set(), [], []
    cands = set()
    # Loading a.b.c runs a/__init__.py and a/b/__init__.py first, whoever imports it.
    d = os.path.dirname(os.path.dirname(path)) if is_pkg else os.path.dirname(path)
    for _ in range(modname.count(".")):
        edges.add(os.path.join(d, "__init__.py"))
        d = os.path.dirname(d)
    for kind, mod, names, level, lineno in imports:
        if kind == "computed":
            computed.append(lineno)
            continue
        if level:
            base = package.rsplit(".", level - 1)[0] if level > 1 else package
            mod = f"{base}.{mod}" if mod else base
        files, ok = resolve_chain(mod)
        edges.update(files)
        parts = mod.split(".")
        for i in range(1, len(parts) + 1):
            cands.update(candidates(".".join(parts[:i])))
            if find(".".join(parts[:i])) is None:
                break
        if not ok:
            unresolved.append(mod)
            continue
        for n in names:
            if n == "*":
                continue
            s = find(f"{mod}.{n}")  # `from a import b`: b is a submodule when one exists
            if s is not None:
                edges.update(spec_files(s))
            cands.update(candidates(f"{mod}.{n}"))
    resolve_s += time.perf_counter() - t
    rel = os.path.relpath(path, root)
    result[rel] = {
        "module": modname,
        "edges": sorted(os.path.relpath(e, root) for e in edges if e != path),
        "unresolved": unresolved,
        "computed": computed,
        "candidates": sorted(os.path.relpath(c, root) for c in cands),
    }

timing = {"files": len(py_files), "parse_s": parse_s, "resolve_s": resolve_s, "total_s": time.perf_counter() - t0,
          "python": sys.version.split()[0]}
json.dump({"files": result, "timing": timing}, open(out, "w"))
print(json.dumps(timing))
