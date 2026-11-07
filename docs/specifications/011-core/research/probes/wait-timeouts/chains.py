"""Q5: the full cost of a timed-out wait. A chain is a timed-out named 60 s wait followed by the same session's next
`squeal status --wait` calls, each starting within 30 s of the previous one's end. Throwaway.
Usage: python3 -I chains.py WAITS.jsonl CLS.jsonl DAYS"""
import json, sys, collections
from datetime import datetime
sys.dont_write_bytecode = True
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "load-slowdown"))
from load import med, quant  # noqa: E402
days = float(sys.argv[3])
ws = [json.loads(l) for l in open(sys.argv[1])]
by = collections.defaultdict(list)
for w in ws:
    s = datetime.fromisoformat(w["start"]).timestamp()
    by[w["session"]].append((s, s + w["wall"], w))
for k in by:
    by[k].sort(key=lambda x: x[0])
cls = {(c["session"], c["start"]): c for c in map(json.loads, open(sys.argv[2]))}
chains = []
for c in cls.values():
    if not c["timedOut"]:
        continue
    seq = by[c["session"]]
    i = next(j for j, x in enumerate(seq) if x[2]["start"] == c["start"])
    total, n, end = min(seq[i][2]["wall"], 65), 1, seq[i][1]
    verdict = False
    for s, e, w in seq[i + 1:]:
        if s - end > 30:
            break
        total += min(w["wall"], 65); n += 1; end = e
        if "the deadline passed after" not in w["out"]:
            verdict = True
            break
    chains.append((c["band"], total, n, verdict))
print("timed-out waits", len(chains), "| followed by another wait within 30 s:", sum(1 for x in chains if x[2] > 1),
      f"| chain seconds median {med([x[1] for x in chains]):.0f} p75 {quant([x[1] for x in chains], .75):.0f} | chain h/day {sum(x[1] for x in chains) / 3600 / days:.2f}")
for b, name in enumerate(["0-6", "6-12", "12-16", "16-20", "20-24"]):
    x = [c for c in chains if c[0] == b]
    if x:
        print(name, "n", len(x), "re-waited", f"{sum(1 for c in x if c[2] > 1) / len(x):.0%}", "chain median", f"{med([c[1] for c in x]):.0f} s", "mean", f"{sum(c[1] for c in x) / len(x):.0f} s")
named = list(cls.values())
tot = sum(min(c["wall"], 65) for c in named)
b0 = [min(c["wall"], 65) for c in named if c["band"] == 0]
m0 = sum(b0) / len(b0)
ex = sum(max(0, min(c["wall"], 65) - m0) for c in named if c["band"] >= 2)
exm = sum(min(c["wall"], 65) for c in named if c["band"] >= 2) - m0 * sum(1 for c in named if c["band"] >= 2)
print(f"named 60 s waits: {len(named)}, {tot / 3600 / days:.2f} h/day; 0-6 mean {m0:.1f} s; excess of 12+ waits over that mean {exm / 3600 / days:.2f} h/day")
