"""Q1: how a test file's module duration changes with load at the time it ran. Throwaway, read only.

Usage: python3 -I slowdown.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART [GROUP=day|head|day-wt] [FILTER=all|no-baseline|baseline]

A record is one file's module duration in one run that ended without a failure line, inside the sar window.
Content control (the store keeps one result per check and key, so earlier runs at a key leave no key):
  day     the same project and file on the same UTC day, any worktree
  day-wt  the same project, file, worktree and UTC day
  head    the same project and file at the same commit with a clean tree (revision rows that still exist)
Two load measures per record: sar busy cores of the 10-minute sample at the run's midpoint, and Squeal's own
concurrency, the mean number of test files running at once across all copied stores during the run.
The slowdown of a band is, per group with records in the band and in the reference band, the median duration in
the band over the median in the reference band; the line gives the median of those group ratios, their p25 and
p75, the number of groups and records. A second estimate fits log duration = group + band by alternating medians.
"""
import collections, json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import Sar, Step, band, label, load_runs, med, quant

runs_path, sar_path, exclude = sys.argv[1:4]
group_by = sys.argv[4] if len(sys.argv) > 4 else "day"
filt = sys.argv[5] if len(sys.argv) > 5 else "all"
MIN_MS = 100

sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
conc = Step([(r["start"], r["end"], r["par"]) for r in runs])
t0, t1 = sar.s[0][0], sar.s[-1][1]

BUSY = [0, 6, 12, 16, 20, 24.01]
BUSY2 = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24.01]
CONC = [0, 4, 8, 12, 16, 24, float("inf")]

recs = []
for r in runs:
    if r["failure"] or r["state"] != "completed":
        continue
    if filt == "no-baseline" and r["kind"] == "baseline":
        continue
    if filt == "baseline" and r["kind"] != "baseline":
        continue
    mid = (r["start"] + r["end"]) / 2000
    if not (t0 <= mid <= t1):
        continue
    s = sar.at(mid)
    if s is None:
        continue
    c = conc.mean(r["start"], r["end"])
    day = time.strftime("%Y-%m-%d", time.gmtime(mid))
    for f, d in r["files"]:
        if d < MIN_MS:
            continue
        if group_by == "head":
            if r["head"] is None or r["dirty"] != 0:
                continue
            g = (r["project"], f, r["head"])
        elif group_by == "day-wt":
            g = (r["project"], f, r["wt"], day)
        else:
            g = (r["project"], f, day)
        recs.append({"g": g, "d": d, "busy": s[2], "steal": s[4], "conc": c, "project": r["project"], "kind": r["kind"]})


def pairwise(key, edges, ref=0):
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for x in recs:
        by[x["g"]][band(x[key], edges)].append(x["d"])
    out = []
    for b in range(len(edges) - 1):
        ratios, n = [], 0
        for g, bands in by.items():
            if b in bands and ref in bands and (b != ref):
                ratios.append(med(bands[b]) / med(bands[ref]))
                n += len(bands[b])
        allrec = sum(1 for x in recs if band(x[key], edges) == b)
        out.append({"band": label(edges, b), "records": allrec, "groups": len(ratios) if b != ref else None,
                    "pairedRecords": n if b != ref else None,
                    "median": round(med(ratios), 3) if ratios else (1.0 if b == ref else None),
                    "p25": round(quant(ratios, .25), 3) if ratios else None, "p75": round(quant(ratios, .75), 3) if ratios else None})
    return out


def fixed_effects(key, edges, ref=0, iters=30):
    """log d = g + b, solved by alternating medians on groups that have records in two or more bands."""
    by = collections.defaultdict(set)
    for x in recs:
        by[x["g"]].add(band(x[key], edges))
    use = [x for x in recs if len(by[x["g"]]) > 1]
    for x in use:
        x["ld"], x["b"] = math.log(x["d"]), band(x[key], edges)
    b = [0.0] * (len(edges) - 1)
    for _ in range(iters):
        gs = collections.defaultdict(list)
        for x in use:
            gs[x["g"]].append(x["ld"] - b[x["b"]])
        gm = {g: med(v) for g, v in gs.items()}
        bs = collections.defaultdict(list)
        for x in use:
            bs[x["b"]].append(x["ld"] - gm[x["g"]])
        b = [med(bs[i]) if bs[i] else float("nan") for i in range(len(edges) - 1)]
        b = [v - b[ref] for v in b]
    res = collections.defaultdict(list)
    for x in use:
        res[x["b"]].append(math.exp(x["ld"] - gm[x["g"]] - b[ref]))
    return [{"band": label(edges, i), "factor": round(math.exp(b[i]), 3) if not math.isnan(b[i]) else None,
             "records": len(res[i]), "p25": round(quant(res[i], .25), 3) if res[i] else None,
             "p75": round(quant(res[i], .75), 3) if res[i] else None} for i in range(len(edges) - 1)]


print(json.dumps({"group": group_by, "filter": filt, "records": len(recs), "groups": len({x["g"] for x in recs}),
                  "projects": collections.Counter(x["project"] for x in recs)}))
for name, key, edges in (("busy", "busy", BUSY), ("busy2", "busy", BUSY2), ("squealConcurrency", "conc", CONC)):
    print(json.dumps({"measure": name, "pairwise": pairwise(key, edges)}))
    print(json.dumps({"measure": name, "fixedEffects": fixed_effects(key, edges)}))
# Per project, busy bands, pairwise.
for p in sorted({x["project"] for x in recs}):
    keep = recs
    recs = [x for x in keep if x["project"] == p]
    print(json.dumps({"project": p, "busy": [(o["band"], o["median"], o["groups"]) for o in pairwise("busy", BUSY)]}))
    recs = keep
# Steal: records by steal band, and the busy factor among samples with steal under 1%.
st = collections.Counter(band(x["steal"], [0, 1, 2, 5, 100]) for x in recs)
print(json.dumps({"stealBands": {label([0, 1, 2, 5, 100], k): v for k, v in sorted(st.items())}}))
keep = recs
recs = [x for x in keep if x["steal"] < 1]
print(json.dumps({"stealUnder1": [(o["band"], o["median"], o["groups"]) for o in pairwise("busy", BUSY)]}))
recs = keep
