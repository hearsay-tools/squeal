"""Q5: wait seconds each class holds, as ranges for the changes that target it. Throwaway.
Usage: python3 -I savings.py CLS.jsonl TL.jsonl DAYS
upper: every second of the first 60 s that timed-out waits of the class spent, per day.
state: the seconds of those waits spent in the state the change removes (timeline.mjs split, scaled from the
       waits with store data to all waits of the class): promoted and daemon -> no run; behind -> other runs only;
       running -> named run running; unlisted -> other runs + no run.
excess: the class's timed-out waits per 100 above the 0-12 rate, times the waits at 12+ busy, times 60 s, per day:
        the part linked to load.
Seconds after the first 60 s (the agent waits again) are not counted, so all three are low."""
import json, sys, collections
cls = [json.loads(l) for l in open(sys.argv[1])]
tl = [json.loads(l) for l in open(sys.argv[2]) if l.strip()]
days = float(sys.argv[3])
tl = [t for t in tl if t["storeHasWorktree"] and t["nTests"] > 0]
STATE = {"promoted": ("idle",), "daemon": ("idle",), "behind": ("other",), "running": ("covered",), "unlisted": ("other", "idle"),
         "quiet": ("idle", "other"), "ended": ("covered", "other"), "noholder": ("idle",)}
to = [r for r in cls if r["timedOut"]]
lo_n = sum(1 for r in cls if r["band"] < 2); hi = [r for r in cls if r["band"] >= 2]
print("class | timed out | upper h/day | state share | state h/day | excess per 100 (12+ vs 0-12) | excess h/day")
for k, n in collections.Counter(r["primary"] for r in to).most_common():
    t = [x for x in tl if x["primary"] == k]
    share = sum(sum(x[s] for s in STATE.get(k, ("covered", "other", "idle"))) for x in t) / max(1, sum(x["covered"] + x["other"] + x["idle"] for x in t))
    up = n * 60 / 3600 / days
    lo_rate = sum(1 for r in to if r["primary"] == k and r["band"] < 2) / lo_n
    hi_rate = sum(1 for r in to if r["primary"] == k and r["band"] >= 2) / len(hi)
    ex = max(0.0, hi_rate - lo_rate) * len(hi) * 60 / 3600 / days
    print(f"{k} | {n} | {up:.2f} | {share:.0%} (n {len(t)}) | {up * share:.2f} | {100 * (hi_rate - lo_rate):+.1f} | {ex:.2f}")
print("all timed out:", len(to), f"{len(to) * 60 / 3600 / days:.2f} h/day in their first 60 s")
