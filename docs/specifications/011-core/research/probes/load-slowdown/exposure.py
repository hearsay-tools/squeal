"""Q2, Q5 and Q6b: where Squeal's test seconds ran on the load curve, who ran above the knee, and the host's
throughput at each load. Throwaway, read only.

Usage: python3 -I exposure.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART KNEE

A run's worker seconds are its mean files at once times its wall (load.py, `par`), spread over the sar samples it
overlaps. Kinds: `baseline` and `run-all` are checkpoint runs (restart baselines and `squeal run --all`); a run with
no checkpoint is an `edit` tier when it is the first run of its worktree and revision and picked at most 4 files
(runner.tierSize), else `backlog` (inferred: the store does not record why a tier ran).
"""
import bisect, collections, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import Sar, band, label, load_runs

runs_path, sar_path, exclude, knee = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
BUSY = [0, 6, 12, 16, 20, 24.01]
seen = set()
for r in runs:
    k = (r["project"], r["wt"], r["revision"])
    if r["kind"] == "tier":
        r["kind"] = "edit" if k not in seen and r["picked"] <= 4 else "backlog"
    seen.add(k)

t0, t1 = sar.s[0][0] * 1000, sar.s[-1][1] * 1000
per_sample = collections.defaultdict(float)  # sample end -> Squeal worker seconds
by_band = collections.Counter()
wall_band = collections.Counter()
above = collections.Counter()
total = 0.0
for r in runs:
    if r["end"] < t0 or r["start"] > t1:
        continue
    for s in sar.s[bisect.bisect_left(sar.ends, r["start"] / 1000):]:
        if s[0] * 1000 >= r["end"]:
            break
        a, b = max(r["start"], s[0] * 1000), min(r["end"], s[1] * 1000)
        if b <= a:
            continue
        ws = r["par"] * (b - a) / 1000
        bi = band(s[2], BUSY)
        by_band[bi] += ws
        wall_band[bi] += (b - a) / 1000
        per_sample[s[1]] += ws
        total += ws
        if s[2] >= knee:
            above[(r["project"], r["kind"])] += ws

print(json.dumps({"squealWorkerHours": round(total / 3600, 1),
                  "shareByBusyBand": {label(BUSY, i): round(100 * by_band[i] / total, 1) for i in sorted(by_band)},
                  "runWallShareByBusyBand": {label(BUSY, i): round(100 * wall_band[i] / sum(wall_band.values()), 1) for i in sorted(wall_band)}}))
ab = sum(above.values())
print(json.dumps({"aboveKnee": knee, "squealWorkerHoursAbove": round(ab / 3600, 1), "shareOfSquealAbove": round(100 * ab / total, 1),
                  "byProjectKind": {f"{p} {k}": [round(v / 3600, 1), round(100 * v / ab, 1)] for (p, k), v in above.most_common()}}))
kinds = collections.Counter()
for (p, k), v in above.items():
    kinds[k] += v
print(json.dumps({"aboveByKind": {k: round(100 * v / ab, 1) for k, v in kinds.most_common()}}))

# The host above the knee: sample time, its busy cores, and %nice (Squeal's tests run at nice 10).
hi = [s for s in sar.s if s[2] >= knee]
dur = lambda ss: sum(s[1] - s[0] for s in ss)
print(json.dumps({"samples": len(sar.s), "samplesAbove": len(hi), "timeShareAbove": round(100 * dur(hi) / dur(sar.s), 1),
                  "meanBusyAbove": round(sum(s[2] for s in hi) / len(hi), 1), "meanNiceCoresAbove": round(sum(s[3] for s in hi) / len(hi), 1),
                  "busyMinusNiceAbove": round(sum(s[2] - s[3] for s in hi) / len(hi), 1),
                  "samplesAboveIfNoNice": sum(1 for s in sar.s if s[2] - s[3] >= knee),
                  "squealCoresFromStoresAbove": round(sum(per_sample[s[1]] / (s[1] - s[0]) for s in hi) / len(hi), 1)}))

# Q6b: throughput as isolated-speed core seconds per wall second, busy / S(busy), with S from the 2-core fixed-effects
# curve of slowdown.py (day groups, all runs), interpolated at band midpoints. Inferred: every busy core is slowed as
# test files are.
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


print(json.dumps({"throughputByBusy": {b: round(b / S(b), 1) for b in (6, 8, 10, 12, 14, 16, 18, 20, 22, 24)}}))
tp = [(s[2] / S(s[2]), s) for s in sar.s]
cap = 12 / S(12)
over = [(t, s) for t, s in tp if t > cap]
print(json.dumps({"meanThroughput": round(sum(t for t, _ in tp) / len(tp), 2), "cap12Throughput": round(cap, 2),
                  "samplesOverCap": len(over), "shareOverCap": round(100 * len(over) / len(tp), 1),
                  "deferredIsolatedCoreHoursPerDay": round(sum((t - cap) * (s[1] - s[0]) for t, s in over) / 3600 / (dur(sar.s) / 86400), 1),
                  "meanThroughputWhenOver": round(sum(t for t, _ in over) / max(1, len(over)), 2)}))
