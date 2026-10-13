"""Throwaway: per-file edge differences between two graph JSONs (a = reference)."""
import json, sys
a = json.load(open(sys.argv[1]))["files"]; b = json.load(open(sys.argv[2]))["files"]
diff = 0
for f in sorted(set(a) | set(b)):
    ea, eb = set(a.get(f, {}).get("edges", [])), set(b.get(f, {}).get("edges", []))
    ca, cb = a.get(f, {}).get("computed", []), b.get(f, {}).get("computed", [])
    if ea != eb or len(ca) != len(cb):
        diff += 1
        if diff <= 6:
            print(f, "only-a:", sorted(ea - eb)[:4], "only-b:", sorted(eb - ea)[:4], "computed:", ca, cb)
print("files differing:", diff, "of", len(set(a) | set(b)))
