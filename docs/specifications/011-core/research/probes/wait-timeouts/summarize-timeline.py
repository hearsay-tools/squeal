"""Q3 summary of timeline.mjs output: where the first 60 s of each timed-out wait went, per band and class. Throwaway.
Usage: python3 -I summarize-timeline.py TL.jsonl"""
import json, sys, os, collections
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "load-slowdown"))
from load import med, quant  # noqa: E402
EDG = ["0-6", "6-12", "12-16", "16-20", "20-24"]
tl = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
x = [t for t in tl if t["storeHasWorktree"] and t["nTests"] > 0]
print("timed-out waits with named test files and the worktree's runs in the store:", len(x), "of", len(tl))


def split(rows, title):
    if not rows:
        return
    c = sum(r["covered"] for r in rows); o = sum(r["other"] for r in rows); i = sum(r["idle"] for r in rows); T = c + o + i
    ans = [r["answeredAfter"] for r in rows if r["answeredAfter"] is not None]
    fs = [r["firstNamedStartAfter"] for r in rows if r["firstNamedStartAfter"] is not None]
    print(f"{title:22} n {len(rows):4} | named run running {c / T:4.0%} | other runs only {o / T:4.0%} | no run {i / T:4.0%} |"
          f" first named run starts +{med(fs) or 0:5.1f} s (n {len(fs)}) | answered +{med(ans) or 0:6.1f} s p75 {quant(ans, .75) or 0:6.1f} (n {len(ans)} of {len(rows)})")


split(x, "all")
for b in range(5):
    split([r for r in x if r["band"] == b], "band " + EDG[b])
for k in collections.Counter(r["primary"] for r in x):
    split([r for r in x if r["primary"] == k], "class " + k)
for p in ("cezar", "squeal"):
    split([r for r in x if r["project"] == p], "project " + p)
# Runs started before the wait that held a named file and ended inside the 60 s: the answer was in flight.
inflight = [r for r in x if any(u["named"] and u["start"] < 0 < u["end"] for u in r["runs"])]
print("a run holding a named file was already running at the wait's start:", len(inflight), f"({len(inflight) / len(x):.0%})")
# Several revisions in the window.
rv = [r for r in x if r["revisions"]]
print("waits with revision rows still in the store:", len(rv), "; with a revision inside the 60 s:", sum(any(0 <= v["at"] < 60 for v in r["revisions"]) for r in rv))
# Tiers ahead: in 'other' time, the size of the runs that ran.
sizes = [u["n"] for r in x for u in r["runs"] if not u["named"] and u["start"] < 60 and u["end"] > 0]
print("runs without a named file that ran in the window: n", len(sizes), "median files", med(sizes), "share >= 20 files", f"{sum(s >= 20 for s in sizes) / max(1, len(sizes)):.0%}", "checkpoint share",
      f"{sum(1 for r in x for u in r['runs'] if not u['named'] and u['start'] < 60 and u['end'] > 0 and u['cp']) / max(1, len(sizes)):.0%}")
# Which classes hold the 'no run' and 'other runs only' seconds of timed-out waits at 16+ busy.
hi = [r for r in x if r["band"] >= 3]
for st in ("idle", "other"):
    tot = sum(r[st] for r in hi)
    by = collections.Counter()
    for r in hi:
        by[r["primary"]] += r[st]
    print(f"16+ busy, '{st}' seconds by class:", ", ".join(f"{k} {v / tot:.0%}" for k, v in by.most_common(6)), f"(total {tot / 3600:.1f} h)")
