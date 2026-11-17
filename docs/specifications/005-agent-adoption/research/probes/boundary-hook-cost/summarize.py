# Throwaway, row 005-110. Median / p90 / max of boundary.ts JSON lines per group, with the load range,
# the times the eval window covers (from 19:50Z on 2026-11-17, coordinator's note), errors and text.
# Usage: python3 -I summarize.py <file.jsonl>... [--by key,key]
import json, sys, collections
args = [a for a in sys.argv[1:] if not a.startswith("--")]
by = next((a[5:].split(",") for a in sys.argv[1:] if a.startswith("--by=")), ["repo", "src", "kind", "daemon", "lock"])
g = collections.defaultdict(list)
for f in args:
    for line in open(f):
        r = json.loads(line)
        if r["hook"] == "register": continue
        r["kind"] = r["hook"] + ("-news" if r.get("news") else "-silent" if r["hook"] == "ptb" else "")
        if "first" in r: r["kind"] = f"ptb-first{r['first']}"
        g[tuple(str(r.get(k)) for k in by)].append(r)
def q(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))]
print(" ".join(by), "| n median p90 max | over2s(+0.08s start) | errors | with text | load | at")
for k in sorted(g):
    rs = g[k]; t = [r["total"] for r in rs]
    print(" ".join(k), f"| {len(rs)} {q(t,.5):.0f} {q(t,.9):.0f} {max(t):.0f} | {sum(x + 82 > 2000 for x in t)} | {sum(r['error'] is not None for r in rs)} | {sum(r['textLen'] > 0 for r in rs)} | {min(r['load1'] for r in rs)}-{max(r['load1'] for r in rs)} | {min(r['at'] for r in rs)[11:16]}-{max(r['at'] for r in rs)[11:16]}Z")
