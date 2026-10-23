# 011-150 probe (throwaway): which `src/**/*.ts` files squeal's plugin bundles can contain: the
# import walk from the entry points of `bundleOptions` (src/harness/build.ts) and each plugin's
# entries directory, type-only imports dropped as esbuild drops them. Then, over the window's
# edits, the declared-alone re-keys through `src/**/*.ts` whose changed paths are outside it.
# Usage: python3 -I bundle-closure.py <checkout> <commit> <routes-squeal.json> <store copy>
import json, os, sys, sqlite3
from collections import defaultdict
tree, commit, routes, store = sys.argv[1:5]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "walk.py")).read())
entries = ["src/cli/index.ts", "src/cli/ps-index.ts", "src/core/daemon/front-desk.ts"]
entries += sorted(f for f in files if f.startswith("src/harness/") and "/entries/" in f and f.endswith(".ts"))
entries += sorted(f for f in files if f in ("src/harness/opencode/plugin.ts", "src/harness/pi/extension.ts"))
bundle = set()
for e in entries: bundle |= reach(e)
src = {f for f in files if f.startswith("src/") and f.endswith(".ts")}
print("entries", len(entries), "src/**/*.ts", len(src), "in some bundle closure", len(src & bundle), "outside", len(src - bundle))
out = sorted(src - bundle)
from collections import Counter
print("outside by dir:", Counter("/".join(p.split("/")[:3]) for p in out).most_common(12))
d = json.load(open(routes))
db = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
dur = defaultdict(float)
for t, x in db.execute("select c.test_path, (select duration_ms from results r where r.check_id = c.id order by recorded_at desc limit 1) from checks c where c.project = ''"):
    if x: dur[t] += x / 1000
saved = kept = 0.0; saved_edits = 0
for r in d["revisions"]:
    srcpaths = [p for p in r["paths"] if p in src]
    if not r["files"]["declared"] or not srcpaths: continue
    if all(p not in bundle for p in r["paths"] if p.startswith("src/")):
        s = sum(dur[f.split(":", 1)[1]] for f in r["files"]["declared"]); saved += s; saved_edits += 1
print("edits whose src changes are all outside every bundle:", saved_edits, "declared-alone recorded s they re-keyed:", round(saved))
