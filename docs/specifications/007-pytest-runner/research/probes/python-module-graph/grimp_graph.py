"""Throwaway: grimp's graph of the fixture in the same JSON shape. Run with PYTHONPATH set to the fixture's roots."""
import json, os, sys, time
import grimp
root = os.path.realpath(sys.argv[1]); out = sys.argv[2]; pkgs = sys.argv[3].split(",")
t = time.perf_counter()
g = grimp.build_graph(*pkgs, cache_dir=None, exclude_type_checking_imports="--skip-type-checking" in sys.argv)
build = time.perf_counter() - t
import importlib.util
def file_of(mod):
    # grimp knows modules, not files: map through the package's directory
    top = mod.split(".")[0]
    base = os.path.dirname(importlib.util.find_spec(top).origin)
    rel = mod.split(".")[1:]
    p = os.path.join(base, *rel)
    return p + "/__init__.py" if os.path.isdir(p) else p + ".py"
res = {}
for m in g.modules:
    f = os.path.relpath(os.path.realpath(file_of(m)), root)
    edges = set()
    for d in g.find_modules_directly_imported_by(m):
        edges.add(os.path.relpath(os.path.realpath(file_of(d)), root))
    res[f] = {"module": m, "edges": sorted(edges), "computed": []}
json.dump({"files": res, "timing": {"build_s": build, "grimp": grimp.__version__ if hasattr(grimp, "__version__") else "?"}}, open(out, "w"))
print(json.dumps({"modules": len(g.modules), "build_s": build}))
