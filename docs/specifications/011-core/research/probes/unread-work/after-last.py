"""Class 1 timing: for background records outside every session span (`nos_any`), minutes from the root's last
session event before the run started to the run's start, or that the run came before the root's first event.
Throwaway, read only. Usage: python3 -I after-last.py REC.jsonl SESSIONS"""
import bisect, collections, json, sys
ev = collections.defaultdict(list)
for line in open(sys.argv[2]):
    s = json.loads(line)
    ev[s["root"]].extend(e[0] * 1000 for e in s["events"])
for k in ev:
    ev[k].sort()
bins = [(0, 3), (3, 10), (10, 30), (30, 60), (60, 180), (180, 1e9)]
c, n = collections.Counter(), collections.Counter()
nosess = collections.Counter()
for line in open(sys.argv[1]):
    r = json.loads(line)
    if r["kind"] not in ("baseline", "backlog") or not r["nos_any"]:
        continue
    lst = ev.get(r["root"], [])
    i = bisect.bisect_left(lst, r["s"])
    if not lst:
        k = "root has no session at all"
    elif i == 0:
        k = "before the root's first session event"
    else:
        m = (r["s"] - lst[i - 1]) / 60000
        k = next(f"{a}-{b if b < 1e9 else 'inf'} min after the last event" for a, b in bins if a <= m < b)
    c[(k, r["kind"])] += r["sec"]
    n[k] += r["sec"]
    if "main" in r["root"] or r["root"].count("/") == 4:
        nosess["main checkout"] += r["sec"]
tot = sum(n.values())
for k, v in sorted(n.items()):
    print(f"{k}: {v/3600:.1f} h ({100*v/tot:.1f}%)  baseline {c[(k,'baseline')]/3600:.1f} h, backlog {c[(k,'backlog')]/3600:.1f} h")
print("main checkout:", round(nosess["main checkout"] / 3600, 1), "h")
