# Throwaway: compare two squeal-results/1 exports. Prints per-file key equality and, per project,
# the environment descriptor fields that differ.
import gzip, json, sys
a, b = (json.load(gzip.open(p)) for p in sys.argv[1:3])
def files(x): return {(f["project"], f["path"]): f for f in x["testFiles"]}
fa, fb = files(a), files(b)
same = [k for k in fa if k in fb and fa[k]["key"] == fb[k]["key"]]
print(f"files: A {len(fa)}, B {len(fb)}, equal key {len(same)}")
for k in sorted(set(fa) & set(fb)):
    if fa[k]["key"] != fb[k]["key"]:
        da, db = fa[k], fb[k]
        diffs = [f for f in sorted(set(da) | set(db)) if f != "key" and da.get(f) != db.get(f)]
        print("  differs:", k, "fields:", diffs)
def envs(x):
    e = x["environments"]
    return {d.get("descriptor", d).get("project", h) if isinstance(d, dict) else h: d for h, d in (e.items() if isinstance(e, dict) else [(i.get("hash"), i) for i in e])}
ea, eb = envs(a), envs(b)
def flat(d, p=""):
    out = {}
    if isinstance(d, dict):
        for k, v in d.items(): out.update(flat(v, f"{p}.{k}" if p else k))
    else: out[p] = d
    return out
for proj in sorted(set(ea) | set(eb)):
    xa, xb = flat(ea.get(proj, {})), flat(eb.get(proj, {}))
    d = {k: (xa.get(k), xb.get(k)) for k in sorted(set(xa) | set(xb)) if xa.get(k) != xb.get(k)}
    print(f"environment {proj}: {'equal' if not d else ''}")
    for k, v in d.items(): print(f"  {k}: A={str(v[0])[:90]} | B={str(v[1])[:90]}")
