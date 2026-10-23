# 011-150 probe (throwaway): why each real edit re-keyed each test file.
# For every watch revision of 1 to 9 paths in the window, every test file whose stored closure
# holds a changed path is re-keyed; its route is "self" (the edited test file), "import" (a
# regex walk of static imports from the test file reaches the path), "declared" (a policy
# `inputs` glob of a rule that applies to the test file matches the path), "observed" (the
# path is in the project's observed set for the file, or is the listing `dir/` of an added or
# deleted path). A path neither declared nor observed is the runner's own (imports,
# unresolved candidates, snapshot path), so the walk decides only paths that are both. A file re-keyed by several paths takes the first
# route of self, import, declared, observed; "declared" with observed too is kept apart.
# Seconds: per test file the sum of each check's newest recorded duration (as edit-load).
# Usage: python3 -I routes.py <repo> <store copy> <checkout> <commit> <config json> <hours> <out.json>
import json, os, re, sqlite3, subprocess, sys, time
from collections import defaultdict

repo, store, tree, commit, cfgpath, hours, out = sys.argv[1:8]
hours = float(hours)
cfg = json.load(open(cfgpath))
inputs = cfg.get("inputs", [])
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
now_ms = max(r[0] for r in db.execute("select max(created_at) from revisions"))
t0 = now_ms - hours * 3600e3

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "globre.py")).read())

rules = [("**", inputs)] if isinstance(inputs, list) else list(inputs.items())
rules = [(tg, glob_re(tg), [(g, glob_re(g)) for g in gs]) for tg, gs in rules if gs]

# ---- store ----
clo = {}
for proj, path, c in db.execute("select project, path, closure_paths from test_files"):
    clo[(proj, path)] = set(json.loads(c))
obs = {}
for k, v in db.execute("select key, value from meta where key like 'observed.%' or key like 'nodeTest.observed.%' or key like 'pytest.observed.%'"):
    proj = k.split("observed.", 1)[1]
    val = json.loads(v)
    if not isinstance(val, dict): continue
    for t, ps in val.items(): obs.setdefault((proj, t), set()).update(ps)
dur = defaultdict(float)
for proj, path, d in db.execute("""select c.project, c.test_path,
    (select duration_ms from results r where r.check_id = c.id order by recorded_at desc limit 1)
    from checks c"""):
    if d is not None: dur[(proj, path)] += d / 1000

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "walk.py")).read())

def declared_of(t, p):
    return [(tg, g) for tg, tre, gs in rules if tre.match(t) for g, gre in gs if gre.match(p)]

# ---- walk accuracy: files with no declared and no observed input ----
acc = {"files": 0, "closure_static": 0, "walk_hits": 0, "walk_extra": 0}
for (proj, t), c in clo.items():
    if t not in files or obs.get((proj, t)) or any(tre.match(t) for _, tre, _ in rules): continue
    stat = {p for p in c if p in files}
    w = reach(t)
    if len(stat - w) and acc.get("miss_samples", 0) < 12: print("MISS", t, sorted(stat - w)[:4], file=sys.stderr); acc["miss_samples"] = acc.get("miss_samples", 0) + 1
    acc["files"] += 1; acc["closure_static"] += len(stat); acc["walk_hits"] += len(stat & w); acc["walk_extra"] += len(w - stat)
    if acc["files"] >= 150: break

# ---- edits ----
revs = []
for wt, n, at, trig, ch in db.execute("select worktree_id, number, created_at, trigger, changes from revisions where created_at > ? and trigger = 'watch' order by created_at", (t0,)):
    changes = json.loads(ch)
    if 1 <= len(changes) < 10: revs.append((wt, n, at, changes))
ORDER = ["self", "import", "declared", "declared+observed", "observed", "rest"]
per_rev, rule_stats = [], defaultdict(lambda: {"edits": set(), "files_alone": 0, "seconds_alone": 0.0, "files_any": 0, "seconds_any": 0.0})
for wt, n, at, changes in revs:
    paths = [c["path"] for c in changes]
    listing = {os.path.dirname(c["path"]) + "/" if "/" in c["path"] else "./" for c in changes if c.get("oldHash") is None or c.get("newHash") is None}
    routes = {}
    for key, c in clo.items():
        proj, t = key
        hit = [p for p in paths if p in c or p == t] + [d for d in listing if d in c or d in obs.get(key, ())]
        if not hit: continue
        best = None; why = []
        for p in hit:
            if p == t: r = "self"
            else:
                d = declared_of(t, p); o = p in obs.get(key, ())
                # a path neither declared nor observed is the runner's (static imports,
                # unresolved candidates, snapshot); the walk decides only the overlaps
                if (not d and not o) or p in reach(t): r = "import"
                else: r = "declared+observed" if d and o else "declared" if d else "observed"
                why += d
            if best is None or ORDER.index(r) < ORDER.index(best): best = r
        routes[key] = (best, why)
    sums = defaultdict(float); counts = defaultdict(int)
    for key, (r, why) in routes.items():
        sums[r] += dur.get(key, 0); counts[r] += 1
        for pair in set(why):
            s = rule_stats[pair]; s["edits"].add((wt, n)); s["files_any"] += 1; s["seconds_any"] += dur.get(key, 0)
            if r in ("declared", "declared+observed"): s["files_alone"] += 1; s["seconds_alone"] += dur.get(key, 0)
    per_rev.append({"wt": wt, "rev": n, "at": at, "paths": paths, "counts": counts, "seconds": {k: round(v, 1) for k, v in sums.items()},
                    "files": {r: sorted(f"{k[0]}:{k[1]}" for k, (rr, _) in routes.items() if rr == r) for r in ("declared", "declared+observed", "observed", "rest")}})

inventory = []
for tg, tre, gs in rules:
    carriers = [k for k in clo if k[1] in files and tre.match(k[1])]
    for g, gre in gs:
        s = rule_stats.get((tg, g), {"edits": set(), "files_alone": 0, "seconds_alone": 0.0, "files_any": 0, "seconds_any": 0.0})
        inventory.append({"testGlob": tg, "input": g, "covers": sum(1 for f in files if gre.match(f)),
                          "carriers": len(carriers), "carrierSeconds": round(sum(dur.get(k, 0) for k in carriers)),
                          "editsHit": len(s["edits"]), "filesAny": s["files_any"], "secondsAny": round(s["seconds_any"]),
                          "filesAlone": s["files_alone"], "secondsAlone": round(s["seconds_alone"])})
json.dump({"repo": repo, "commit": commit, "windowHours": hours, "windowEnd": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(now_ms / 1000)),
           "edits": len(per_rev), "walkAccuracy": acc, "inventory": inventory, "revisions": per_rev}, open(out, "w"), indent=1, default=list)
tot = defaultdict(float)
for r in per_rev:
    for k, v in r["seconds"].items(): tot[k] += v
print(repo, "edits", len(per_rev), "walk", acc)
print(" recorded s re-keyed per edit, by route:", {k: round(tot[k] / max(1, len(per_rev))) for k in ORDER})
print(" total:", {k: round(tot[k]) for k in ORDER})
