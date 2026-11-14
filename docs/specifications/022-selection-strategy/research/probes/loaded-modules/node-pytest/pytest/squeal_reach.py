"""Throwaway: per-test-file reach over the `import` events Squeal's own plugin
(src/runners/pytest/runtime/squeal_pytest.py) writes, mirroring observeBatch in
src/runners/pytest/run/observed.ts (edge from `from` else `ctx`; roots = test file + conftests above).
Usage: python squeal_reach.py <events.jsonl> <root> <test file rel>..."""
import json, os, sys
events, root, *tests = sys.argv[1:]
root = os.path.join(os.path.realpath(root), "")
kids, conftests = {}, set()
for line in open(events):
    e = json.loads(line)
    if e.get("type") != "import":
        continue
    if e["to"].endswith("/conftest.py"):
        conftests.add(e["to"])
    src = e["from"] or e["ctx"]
    if src:
        kids.setdefault(src, set()).add(e["to"])
for t in tests:
    real = os.path.realpath(t)
    own = [c for c in conftests if os.path.dirname(real).startswith(os.path.dirname(c))]
    seen, todo = set(), [real, *own]
    while todo:
        n = todo.pop()
        if n not in seen:
            seen.add(n); todo.extend(kids.get(n, ()))
    print(f"{t:18} squeal-edges", " ".join(sorted(p[len(root):] for p in seen if p.startswith(root))))
