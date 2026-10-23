# Reference CC per function from radon's own ComplexityVisitor, for 015-05's stored counts.
# Usage: python -I radon_counts.py <root> <out.json> [relative files...] (files from stdin when none
# are given), with radon 6.0.1 installed. See ../README.md.
import json, os, sys
from importlib.metadata import version
from radon.visitors import ComplexityVisitor

root, out, *files = sys.argv[1:]
if not files:
    files = sys.stdin.read().split()
result = {**({"commit": os.environ["COMMIT"]} if os.environ.get("COMMIT") else {}), "radon": version("radon"), "files": {}, "errors": {}}
def flat(fn):
    yield fn
    for c in fn.closures:
        yield from flat(c)
for f in files:
    try:
        v = ComplexityVisitor.from_code(open(f"{root}/{f}", encoding="utf-8").read())
    except Exception as e:  # radon cannot read it: no reference count
        result["errors"][f] = f"{type(e).__name__}: {e}"[:120]
        continue
    fns = [x for fn in v.functions for x in flat(fn)] + [x for c in v.classes for m in c.methods for x in flat(m)]
    # [startLine, startColumn, cc], 1-based as CodeRange.
    result["files"][f] = sorted([fn.lineno, fn.col_offset + 1, fn.complexity] for fn in fns)
json.dump(result, open(out, "w"))
print(json.dumps({"files": len(files), "functions": sum(len(v) for v in result["files"].values()), "errors": list(result["errors"])}))
