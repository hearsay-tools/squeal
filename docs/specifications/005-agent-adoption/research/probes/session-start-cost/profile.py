# Throwaway. Self and inclusive time per function of a V8 .cpuprofile, inside registerNow only.
# Several profiles: times are the mean per profile. Callees are cut at the first child of
# root-function (depth 1) for the "children" list.
# Usage: python3 -I profile.py <root-function> <file.cpuprofile>...
import json, sys, collections
root_name = sys.argv[1]; files = sys.argv[2:]
nodes = {}; parent = {}; dt = collections.Counter()
for fi, f in enumerate(files):
    prof = json.load(open(f))
    for n in prof["nodes"]:
        nodes[(fi, n["id"])] = n
        for c in n.get("children", []): parent[(fi, c)] = (fi, n["id"])
    for sid, d in zip(prof["samples"], prof["timeDeltas"]): dt[(fi, sid)] += d / 1000 / len(files)
def name(n):
    cf = n["callFrame"]; return f'{cf["functionName"] or "(anon)"} {cf["url"].split("/src/")[-1]}:{cf["lineNumber"] + 1}'
def chain(i):
    out = []
    while i in nodes: out.append(i); i = parent.get(i)
    return out
self_t = collections.Counter(); incl = collections.Counter(); total = 0
for sid, ms in dt.items():
    ids = chain(sid)
    if not any(nodes[i]["callFrame"]["functionName"] == root_name for i in ids): continue
    total += ms; self_t[name(nodes[sid])] += ms
    seen = set()
    for i in ids:
        k = name(nodes[i])
        if k not in seen: incl[k] += ms; seen.add(k)
        if nodes[i]["callFrame"]["functionName"] == root_name: break
print(f"inside {root_name}: {total:.0f} ms sampled, mean of {len(files)} profiles")
child = collections.Counter()
for sid, ms in dt.items():
    ids = chain(sid)
    for j, i in enumerate(ids):
        if nodes[i]["callFrame"]["functionName"] == root_name:
            below = [k for k in ids[:j] if nodes[k]["callFrame"]["url"].find("/src/") >= 0 and nodes[k]["callFrame"]["functionName"] not in ("transaction", "#plain", "")]
            child[name(nodes[below[-1]]) if below else "(self)"] += ms
            break
print("-- first named callee under it")
for k, v in child.most_common(25): print(f"  {v:7.0f}  {k}")
print("-- inclusive (top 30)")
for k, v in incl.most_common(30): print(f"  {v:7.0f}  {k}")
print("-- self (top 15)")
for k, v in self_t.most_common(15): print(f"  {v:7.0f}  {k}")
