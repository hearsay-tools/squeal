"""Throwaway: turn observe_plugin edges output into the graph JSON shape for compare.py."""
import json, sys
d = json.load(open(sys.argv[1]))
files = {k: v for k, v in d["files"].items() if not v.endswith("/")}
g = {}
for src, dsts in d["edges"].items():
    if src not in files:
        continue
    g.setdefault(files[src], {"edges": [], "computed": []})["edges"] = sorted({files[x] for x in dsts if x in files and files[x] != files[src]})
for f in files.values():
    g.setdefault(f, {"edges": [], "computed": []})
json.dump({"files": g}, open(sys.argv[2], "w"))
