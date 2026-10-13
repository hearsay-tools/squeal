"""Throwaway: per-test-file static closure from a graph JSON against the observed truth.

python3 compare.py <fixture> <graph.json> <truth dir> [--collect-only]

Closure roots: the test file, every conftest.py from the fixture root down to its directory,
and the modules named in the root conftest's literal `pytest_plugins`. Closure = files
reachable over the graph's edges. Truth = project files in sys.modules after the run
(or after collection with --collect-only), namespace directories left out.
"""
import ast
import json
import os
import statistics
import sys

fix, graph_path, truth_dir = sys.argv[1:4]
key = "collect" if "--collect-only" in sys.argv else "end"
g = json.load(open(graph_path))["files"]


def plugins(conftest):
    try:
        tree = ast.parse(open(os.path.join(fix, conftest)).read())
    except OSError:
        return []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "pytest_plugins" for t in node.targets):
            return [e.value.replace(".", "/") + ".py" for e in node.value.elts]
    return []


def roots(test):
    out = [test]
    parts = test.split("/")[:-1]
    for i in range(len(parts) + 1):
        c = "/".join(parts[:i] + ["conftest.py"])
        if c in g:
            out.append(c)
            out += [p for p in plugins(c) if p in g]
    return out


def closure(test):
    seen, todo = set(), roots(test)
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        todo += g.get(f, {}).get("edges", [])
    return seen


miss_total, extra_total, sizes, exact, missing_examples = 0, 0, [], 0, {}
n = 0
for name in sorted(os.listdir(truth_dir)):
    t = json.load(open(os.path.join(truth_dir, name)))
    truth = {p for p in t[key].values() if not p.endswith("/")}
    test = [p for p in truth if p.replace("/", "_") + ".json" == name]
    if not test:
        continue
    c = closure(test[0])
    miss, extra = truth - c, c - truth
    n += 1
    miss_total += len(miss)
    extra_total += len(extra)
    sizes.append(len(c))
    exact += not miss
    for m in miss:
        missing_examples.setdefault(m, 0)
        missing_examples[m] += 1
print(json.dumps({
    "graph": os.path.basename(graph_path), "truth": key, "test_files": n,
    "files_with_no_missing": exact, "missing_paths_total": miss_total, "extra_paths_total": extra_total,
    "closure_median": statistics.median(sizes) if sizes else 0, "closure_max": max(sizes) if sizes else 0,
    "missing_by_path": dict(sorted(missing_examples.items(), key=lambda kv: -kv[1])[:8]),
}))
