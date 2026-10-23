# 011-149 probe (throwaway): for each code path edit whose emitted code is equal (same, or code equal with moved
# positions), the test files whose closures hold the path and their last recorded seconds, split by how the path
# enters each closure: import only, observed read, declared input, the test file itself.
# Usage: python3 -I q1.py <store copy> <corpus.tsv> <emit.jsonl> <squeal.config.json> [since ms]
import collections, json, re, sqlite3, sys
sys.argv += [None] * 2
store, corpus, emit, config, since = sys.argv[1:6]
since = int(since or 0)
exec(open(__file__.replace("q1.py", "globs.py")).read())  # glob_re, declared_rules
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
rules = declared_rules(config)
closures = {(p, t): set(json.loads(c)) | {t} for p, t, c in db.execute("select project, path, closure_paths from test_files")}
observed = {}
for key, value in db.execute("select key, value from meta where key like 'observed.%'"):
    for t, ps in json.loads(value).items(): observed[(key[9:], t)] = set(ps)
fdur = {(p, t): (d or 0) / 1000 for p, t, d in db.execute(
    "select c.project, c.test_path, (select duration_ms from results r where r.check_id = c.id order by recorded_at desc limit 1) from checks c where c.kind = 'file'")}
cls = {}
for line in open(emit):
    j = json.loads(line)
    v = [x.get("cls") for x in j["vite"].values()]
    cls[(j["path"], j["oldH"], j["newH"])] = "unknown" if not v or any(x in ("error", None) for x in v) else \
        "differs" if "differs" in v else "moved" if "same-code-moved" in v else "same"
holders = collections.defaultdict(list)
for (p, t), c in closures.items():
    for path in c: holders[path].append((p, t))
out = collections.defaultdict(lambda: collections.Counter())
n = collections.Counter()
for line in open(corpus):
    w, rev, t, k, path, o, nw, ho, hn = line.rstrip("\n").split("\t")
    if int(t) < since or not path.endswith((".ts", ".tsx", ".mts", ".cts")): continue
    c = cls.get((path, o, nw), "unknown")
    size = "agent" if int(k) <= 3 else "bulk"
    n[(size, c)] += 1
    if c not in ("same", "moved"): continue
    for p, test in holders.get(path, []):
        via = "own" if test == path else "declared" if any(tr.match(test) and any(g.match(path) for g in gs) for tr, gs in rules) \
            else "observed" if path in observed.get((p, test), ()) else "import"
        out[(size, c)][via] += fdur.get((p, test), 0)
for key in sorted(n): print(key, n[key], {v: round(s) for v, s in out[key].items()} if key in out else "")
