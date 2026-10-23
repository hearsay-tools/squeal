# 011-143 probe (throwaway): per edit cell, from a store copy's warm closures and last durations:
# files re-keyed, recorded file-seconds, the slow part, and the part a static import walk from
# each test file reaches (relative and package-name imports resolved by file candidates).
# Usage: python3 -I cells.py <store copy> <checkout> <slow regex or -> <path>...
import json, os, re, sqlite3, sys
store, tree, slow = sys.argv[1:4]; paths = sys.argv[4:]
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
clo = {p: set(json.loads(c)) for p, c in db.execute("select path, closure_paths from test_files") if os.path.exists(os.path.join(tree, p))}
dur = {}
for p, d in db.execute("select c.test_path, sum((select duration_ms from results r where r.check_id=c.id order by recorded_at desc limit 1)) from checks c group by 1"):
    dur[p] = (d or 0) / 1000
ANY = re.compile(r'(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["\']([^"\']+)["\']')
def resolve(frm, spec):
    if spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    elif spec.startswith("@/"): base = "packages/web/src/" + spec[2:]
    elif spec.startswith("@open-mercato/cezar-contract"): base = "packages/contract/src/index" if spec.count("/") == 1 else "packages/contract/src/" + spec.split("/", 2)[2]
    else: return None
    for c in (base, re.sub(r"\.js$", ".ts", base), re.sub(r"\.js$", ".tsx", base), base + ".ts", base + ".tsx", base + "/index.ts", base + ".mjs", base + ".js"):
        if os.path.isfile(os.path.join(tree, c)): return c
    return None
cache = {}
def reach(t):
    if t in cache: return cache[t]
    seen, todo = {t}, [t]
    while todo:
        m = todo.pop()
        try: text = open(os.path.join(tree, m), encoding="utf8", errors="replace").read()
        except OSError: continue
        for s in ANY.findall(text):
            r = resolve(m, s)
            if r and r not in seen: seen.add(r); todo.append(r)
    cache[t] = seen; return seen
for path in paths:
    files = [t for t, c in clo.items() if t == path or path in c]
    sl = [t for t in files if slow != "-" and re.search(slow, t)]
    st = [t for t in files if path in reach(t)]
    s = lambda fs: round(sum(dur.get(t, 0) for t in fs))
    print(json.dumps({"path": path, "rekeyed": len(files), "fileSeconds": s(files), "slow": len(sl), "slowSeconds": s(sl),
                      "staticImport": len(st), "staticSeconds": s(st), "noDuration": sum(1 for t in files if t not in dur)}))
