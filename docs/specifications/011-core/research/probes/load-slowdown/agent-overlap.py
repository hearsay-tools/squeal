"""Q3 and Q4 cost side: how agents' own test runs overlapped each other and Squeal's runs, the slowdown they had,
and the slowdown they would have had without Squeal's load. Throwaway, read only.

Usage: python3 -I agent-overlap.py AGENT-CLS.jsonl AGENT-RUNS.jsonl RUNS.jsonl SAR-U.csv EXCLUDE_TASK8

The low bound (`addedLow`) is in the code below.
AGENT-CLS and AGENT-RUNS come from ../host-load/011-181/classify.py and extract.py. A run in the background is left
out (its wall is the time to start it). Load during a run: sar busy and nice cores, time-weighted over the samples it
overlaps. S(b) is the slowdown curve of slowdown.py (2-core fixed effects, day groups). Without Squeal, busy cores are
busy minus %nice cores (Squeal's tests run at nice 10; inferred: nothing else on this host runs niced at that volume,
and no other work fills the freed cores). The seconds Squeal added to a run: wall * (1 - S(busy - nice) / S(busy)).
"""
import bisect, collections, json, os, re, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import Sar, Step, load_runs, med, quant

cls_path, raw_path, runs_path, sar_path, exclude = sys.argv[1:6]
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


ms = lambda iso: datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
sar = Sar(sar_path)
squeal = load_runs(runs_path)
sq = Step([(r["start"], r["end"], r["par"]) for r in squeal])
raw = {}
for line in open(raw_path):
    r = json.loads(line)
    raw[(r["session"] or "")[:8] + " " + r["start"][:19]] = r
runs = []
for line in open(cls_path):
    r = json.loads(line)
    if r.get("task") == exclude or r.get("background") or not r.get("wallS"):
        continue
    s = ms(r["start"])
    r["s"], r["e"] = s, s + float(r["wallS"]) * 1000
    x = raw.get(r["key"], {})
    r["locked"] = "squeal-full-run.lock" in (x.get("cmd") or r.get("cmd") or "")
    m = re.search(r"Duration\s+([\d.]+)\s*(ms|s)\b", (x.get("resultTail") or ""))
    r["vitestS"] = (float(m.group(1)) / (1000 if m.group(2) == "ms" else 1)) if m else None
    runs.append(r)
t0, t1 = sar.s[0][0] * 1000, sar.s[-1][1] * 1000
runs = [r for r in runs if r["s"] >= t0 and r["e"] <= t1 and r["e"] > r["s"]]
ag = Step([(r["s"], r["e"], 1) for r in runs])


def load_during(s, e):
    busy = nice = 0.0
    for x in sar.s[bisect.bisect_left(sar.ends, s / 1000):]:
        if x[0] * 1000 >= e:
            break
        a, b = max(s, x[0] * 1000), min(e, x[1] * 1000)
        if b > a:
            busy += x[2] * (b - a)
            nice += x[3] * (b - a)
    return busy / (e - s), nice / (e - s)


for r in runs:
    s, e = r["s"], r["e"]
    r["others"] = ag.mean(s, e) - 1  # other agent runs at once, on average
    # Share of the run's time with at least one other agent run: from the step function's pieces.
    i = bisect.bisect_right(ag.t, s) - 1
    t, over = s, 0.0
    while t < e and i < len(ag.t):
        nxt = ag.t[i + 1] if i + 1 < len(ag.t) else e
        seg = min(nxt, e) - t
        if i >= 0 and ag.v[i] >= 2:
            over += seg
        t, i = min(nxt, e), i + 1
    r["overShare"] = over / (e - s)
    r["sq"] = sq.mean(s, e)
    r["busy"], r["nice"] = load_during(s, e)
    r["S"], r["Scf"] = S(r["busy"]), S(max(1.0, r["busy"] - r["nice"]))
    r["added"] = (e - s) / 1000 * (1 - r["Scf"] / r["S"])
    # Low bound: a nice-0 run takes a contested vCPU from nice-10 work, so it keeps only the shared-hardware part of
    # the curve (SMT siblings, cache, clock), taken as the curve held flat above 19 busy cores, where the run queue
    # stays under the 24 vCPUs (sar -q). Inferred.
    lo, lcf = S(min(r["busy"], 19)), S(min(max(1.0, r["busy"] - r["nice"]), 19))
    r["addedLow"] = (e - s) / 1000 * (1 - lcf / lo)


def summary(rs):
    w = sum((r["e"] - r["s"]) / 1000 for r in rs)
    if not rs:
        return None
    wsum = lambda f: sum(f(r) * (r["e"] - r["s"]) / 1000 for r in rs) / w
    return {"runs": len(rs), "wallH": round(w / 3600, 2), "medianWallS": round(med([float(r["wallS"]) for r in rs]), 1),
            "runsOverlappingAnotherAgentRun": round(100 * sum(1 for r in rs if r["overShare"] > 0) / len(rs), 1),
            "timeWithAnotherAgentRun": round(100 * wsum(lambda r: r["overShare"]), 1),
            "meanOtherAgentRuns": round(wsum(lambda r: r["others"]), 2),
            "timeWithSquealRunning": round(100 * wsum(lambda r: 1.0 if r["sq"] >= 1 else r["sq"]), 1),
            "meanSquealFiles": round(wsum(lambda r: r["sq"]), 1), "meanBusy": round(wsum(lambda r: r["busy"]), 1),
            "meanNice": round(wsum(lambda r: r["nice"]), 1), "slowdownWithLoad": round(wsum(lambda r: r["S"]), 3),
            "slowdownWithoutSqueal": round(wsum(lambda r: r["Scf"]), 3),
            "addedBySquealH": round(sum(r["added"] for r in rs) / 3600, 2),
            "addedShare": round(100 * sum(r["added"] for r in rs) / w, 1),
            "addedLowH": round(sum(r["addedLow"] for r in rs) / 3600, 2),
            "addedLowShare": round(100 * sum(r["addedLow"] for r in rs) / w, 1)}


days = (t1 - t0) / 86400_000
print(json.dumps({"days": round(days, 2), "all": summary(runs)}))
for c in sorted({r["class"] for r in runs}):
    print(json.dumps({"class": c, **summary([r for r in runs if r["class"] == c])}))
for role in sorted({r["role"] for r in runs}):
    print(json.dumps({"role": role, **summary([r for r in runs if r["role"] == role])}))
lk = [r for r in runs if r["locked"]]
print(json.dumps({"lockedFullRuns": summary(lk)}))
print(json.dumps({"notLocked": summary([r for r in runs if not r["locked"]])}))
# The locked full runs' own Vitest durations against the load they ran in: a direct check of the curve.
pts = sorted((r["nice"], r["busy"], r["vitestS"], r["start"][:16]) for r in lk if r["vitestS"])
print(json.dumps({"lockedWithVitestDuration": len(pts)}))
for lo, hi in ((0, 2), (2, 4), (4, 6), (6, 30)):
    v = [p[2] for p in pts if lo <= p[0] < hi]
    b = [p[1] for p in pts if lo <= p[0] < hi]
    if v:
        print(json.dumps({"niceCores": f"{lo}-{hi}", "runs": len(v), "medianVitestS": round(med(v)), "p25": round(quant(v, .25)),
                          "p75": round(quant(v, .75)), "meanBusy": round(sum(b) / len(b), 1)}))
for lo, hi in ((0, 12), (12, 16), (16, 20), (20, 25)):
    v = [p[2] for p in pts if lo <= p[1] < hi]
    if v:
        print(json.dumps({"busyCores": f"{lo}-{hi}", "runs": len(v), "medianVitestS": round(med(v)), "p25": round(quant(v, .25)), "p75": round(quant(v, .75))}))
