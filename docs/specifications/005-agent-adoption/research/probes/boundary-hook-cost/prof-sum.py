# Throwaway, row 005-110. Mean over several V8 .cpuprofile files: idle, GC, program, and inclusive
# time of named Squeal functions (src/ frames), plus self time of the top frames. Read-only.
# Usage: python3 -I prof-sum.py <file.cpuprofile>...
import json, sys, collections
files = sys.argv[1:]
incl = collections.Counter(); selft = collections.Counter(); special = collections.Counter(); total = 0
for f in files:
    p = json.load(open(f)); nodes = {n["id"]: n for n in p["nodes"]}; parent = {}
    for n in p["nodes"]:
        for c in n.get("children", []): parent[c] = n["id"]
    for sid, d in zip(p["samples"], p["timeDeltas"]):
        ms = d / 1000 / len(files); total += ms
        n = nodes[sid]; fn = n["callFrame"]["functionName"]
        if fn in ("(idle)", "(garbage collector)", "(program)"): special[fn] += ms; continue
        cf = n["callFrame"]; selft[f'{fn or "(anon)"} {cf["url"].split("/src/")[-1]}:{cf["lineNumber"]+1}'] += ms
        seen = set(); i = sid
        while i is not None:
            cf = nodes[i]["callFrame"]
            if "/src/" in cf["url"] and cf["functionName"]:
                k = f'{cf["functionName"]} {cf["url"].split("/src/")[-1]}'
                if k not in seen: incl[k] += ms; seen.add(k)
            i = parent.get(i)
print(f"mean of {len(files)}: sampled {total:.0f} ms; " + ", ".join(f"{k} {v:.0f}" for k, v in special.items()))
print("-- inclusive, src functions (top 45)")
for k, v in incl.most_common(45): print(f"  {v:7.0f}  {k}")
print("-- self (top 15)")
for k, v in selft.most_common(15): print(f"  {v:7.0f}  {k}")
