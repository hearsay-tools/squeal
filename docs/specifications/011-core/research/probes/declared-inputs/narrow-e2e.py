# 011-150 probe (throwaway): cezar's browser tests under narrower declared inputs.
#   S0  today's `packages/web/e2e/*.e2e.ts` inputs
#   S1  S0 without the files no e2e build contains: `*.test.ts(x)` and `*.testkit.ts` under
#       packages/cezar/src (tsconfig excludes them) and packages/web/src, and packages/web/src/test/**
#   S2  S1 with `packages/web/e2e/**` replaced by the spec's own import closure in that folder
#       (other spec files dropped); setup and globalSetup files stay, they key the environment
#   S3  S2 with packages/cezar/src narrowed to the walk from the server entry (src/index.ts) and
#       packages/web/src to the walk from src/main.tsx (lazy routes included)
# For each set: per edit of the window, e2e files re-keyed and their recorded seconds; for each
# e2e FAIL transition (fails.py output), whether a changed path still re-keys the file; and the
# e2e file runs of the window that would not have started, because no closure path that changed
# since the file's previous run in that worktree is in the set (runs from the `runs` table).
# Usage: python3 -I narrow-e2e.py <checkout> <commit> <store copy> <config json> <routes json> <fails json> <hours>
import json, os, re, sys, sqlite3
from collections import defaultdict
tree, commit, store, cfgpath, routes, failsf, hours = sys.argv[1:8]
here = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(here, "walk.py")).read())
exec(open(os.path.join(here, "globre.py")).read())
cfg = json.load(open(cfgpath))
E2E = "packages/web/e2e/*.e2e.ts"
s0 = [glob_re(g) for g in cfg["inputs"][E2E]]
TEST = re.compile(r"^packages/(cezar|web)/src/.*\.(test\.tsx?|testkit\.ts)$|^packages/web/src/test/")
server = reach("packages/cezar/src/index.ts")
web = reach("packages/web/src/main.tsx")
def in_s0(p): return any(r.match(p) for r in s0)
def in_set(k, spec, p):
    if not in_s0(p): return False
    if k >= 1 and TEST.match(p): return False
    if k >= 2 and p.startswith("packages/web/e2e/") and p.endswith((".ts", ".mjs")) and p not in reach(spec) \
            and not p.endswith(("environment.ts", "failure-setup.ts", "fetch-setup.mjs", "vitest.config.ts")): return False
    if k >= 3 and p.startswith("packages/cezar/src/") and p.endswith(".ts") and p not in server: return False
    if k >= 3 and p.startswith("packages/web/src/") and p.endswith((".ts", ".tsx")) and p not in web: return False
    return True
cz = [f for f in files if f.startswith("packages/cezar/src/")]
ws = [f for f in files if f.startswith("packages/web/src/")]
print("packages/cezar/src:", len(cz), "files; tests and testkits", sum(1 for f in cz if TEST.match(f)),
      "; .ts the server entry reaches", len([f for f in cz if f in server]), "of", len([f for f in cz if f.endswith(".ts") and not TEST.match(f)]), "non-test .ts")
print("packages/web/src:", len(ws), "files; tests", sum(1 for f in ws if TEST.match(f)),
      "; .ts/.tsx main.tsx reaches", len([f for f in ws if f in web and f.endswith((".ts", ".tsx")) and not TEST.match(f)]), "of", len([f for f in ws if f.endswith((".ts", ".tsx")) and not TEST.match(f)]), "non-test")
specs = sorted(f for f in files if re.match(r"^packages/web/e2e/[^/]+\.e2e\.ts$", f))
own = [len([p for p in reach(s) if p.startswith("packages/web/e2e/") and p != s]) for s in specs]
print("e2e specs", len(specs), "; e2e-folder files a spec imports: median", sorted(own)[len(own) // 2], "max", max(own),
      "; folder .ts/.mjs files", len([f for f in files if f.startswith("packages/web/e2e/") and f.endswith((".ts", ".mjs"))]))

sizes = [sorted(sum(1 for f in files if in_set(k, sp, f)) for sp in specs) for k in range(4)]
print("declared files per spec at the commit, median (min-max):", "; ".join(f"S{k} {v[len(v) // 2]} ({v[0]}-{v[-1]})" for k, v in enumerate(sizes)))
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
dur = defaultdict(float)
for t, x in db.execute("select c.test_path, (select duration_ms from results r where r.check_id = c.id order by recorded_at desc limit 1) from checks c where c.project = 'e2e'"):
    if x: dur[t] += x / 1000
clo = {t: set(json.loads(c)) for t, c in db.execute("select path, closure_paths from test_files where project = 'e2e'")}
d = json.load(open(routes))
rekey = [[0, 0.0, 0] for _ in range(4)]
for r in d["revisions"]:
    for k in range(4):
        hit = [t for t in clo if re.match(r"^packages/web/e2e/[^/]+\.e2e\.ts$", t) and t in files and
               any(p == t or (p in clo[t] and (not in_s0(p) or in_set(k, t, p))) for p in r["paths"])]
        rekey[k][0] += len(hit); rekey[k][1] += sum(dur[t] for t in hit); rekey[k][2] += 1 if hit else 0
E = d["edits"]
for k in range(4):
    print(f"S{k}: edits re-keying any e2e file {rekey[k][2]} of {E}; e2e file re-keys {rekey[k][0]}; recorded s {round(rekey[k][1])} ({round(rekey[k][1] / E)} per edit)")

fails = json.load(open(failsf))
for k in range(4):
    kept = sum(1 for f in fails if f["file"].endswith(".e2e.ts") and any(
        p == f["file"] or not in_s0(p) or in_set(k, f["file"], p) for p in f["inClosure"]))
    print(f"S{k}: e2e spec FAIL transitions still re-keyed {kept} of {sum(1 for f in fails if f['file'].endswith('.e2e.ts'))}")

# runs of e2e files in the window, per worktree in order
t1 = db.execute("select max(started_at) from runs").fetchone()[0]; t0 = t1 - float(hours) * 3600e3
revs = defaultdict(dict)
for wt, n, ch in db.execute("select worktree_id, number, changes from revisions"):
    revs[wt][n] = [c["path"] for c in json.loads(ch)]
last = {}; total = [0, 0.0]; skipped = [[0, 0.0] for _ in range(4)]; unknown = 0
for wt, rev, tf, st in db.execute("select worktree_id, revision, test_files, started_at from runs order by started_at"):
    for ref in json.loads(tf):
        t = ref["path"] if isinstance(ref, dict) else ref
        if not t.endswith(".e2e.ts"): continue
        key = (wt, t); prev = last.get(key); last[key] = rev
        if st < t0: continue
        total[0] += 1; total[1] += dur[t]
        if prev is None: unknown += 1; continue
        changed = {p for n in range(prev + 1, rev + 1) for p in revs[wt].get(n, [])}
        missing = any(n not in revs[wt] for n in range(prev + 1, rev + 1))
        if missing: unknown += 1; continue
        c = clo.get(t, set())
        for k in range(4):
            if not any(p == t or (p in c and (not in_s0(p) or in_set(k, t, p))) for p in changed):
                skipped[k][0] += 1; skipped[k][1] += dur[t]
print(f"e2e file runs in the window: {total[0]} ({round(total[1])} recorded s); without a judgeable previous run in the store: {unknown}")
for k in range(4):
    print(f"S{k}: runs that would not have started {skipped[k][0]} ({round(skipped[k][1])} recorded s)")

# per worktree: judgeable runs, and what the revisions between a file's runs were
roots = dict(db.execute("select id, root from worktrees").fetchall())
trig = defaultdict(dict)
for wt, n, tr, ch in db.execute("select worktree_id, number, trigger, changes from revisions"):
    trig[wt][n] = "pull" if tr != "watch" or len(json.loads(ch)) >= 10 else "edit"
per = defaultdict(lambda: defaultdict(int)); last = {}
for wt, rev, tf, st in db.execute("select worktree_id, revision, test_files, started_at from runs order by started_at"):
    for ref in json.loads(tf):
        t = ref["path"]
        if not t.endswith(".e2e.ts"): continue
        prev = last.get((wt, t)); last[(wt, t)] = rev
        if st < t0: continue
        w = per[os.path.basename(roots.get(wt, wt))[:12]]; w["runs"] += 1
        if prev is None or any(n not in revs[wt] for n in range(prev + 1, rev + 1)): w["unjudged"] += 1; continue
        kinds = {trig[wt][n] for n in range(prev + 1, rev + 1)}
        w["after pull" if "pull" in kinds else "after edits only" if kinds else "no revision"] += 1
for k, v in sorted(per.items(), key=lambda x: -x[1]["runs"]): print(k, dict(v))
