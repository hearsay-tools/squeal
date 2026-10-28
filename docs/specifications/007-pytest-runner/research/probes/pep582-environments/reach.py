"""Probe only: per-test-file reachability over a squeal_pytest events file, as observed.ts walks it
(edges leave their importer; roots are the test file and its conftests). Counts paths under __pypackages__."""
import json, os, sys, collections
events, root = sys.argv[1], os.path.realpath(sys.argv[2])
edges = collections.defaultdict(set)
for line in open(events):
    r = json.loads(line)
    if r.get("type") == "import" and r.get("from"):
        edges[r["from"]].add(r["to"])
    if r.get("type") == "import" and not r.get("from") and r.get("ctx"):
        edges[r["ctx"]].add(r["to"])
tests = sorted({json.loads(l).get("ctx") for l in open(events) if json.loads(l).get("ctx")})
for t in tests:
    roots = [t] + [os.path.join(d, "conftest.py") for d in {os.path.dirname(t), os.path.dirname(os.path.dirname(t))}]
    seen, stack = set(), [r for r in roots]
    while stack:
        n = stack.pop()
        if n in seen: continue
        seen.add(n); stack.extend(edges.get(n, ()))
    pyp = [p for p in seen if "/__pypackages__/" in p]
    print(f"{os.path.relpath(t, root)}: {len(seen)} reachable, {len(pyp)} under __pypackages__")
