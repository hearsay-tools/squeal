"""Q4: Squeal's own edit tiers. Their wall, the slowdown at their load, the slowdown without Squeal's other work
(backlog, baselines, run --all), and the delay from the revision to the tier's start. Throwaway, read only.

Usage: python3 -I edit-tiers.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART

Kinds as in exposure.py (an edit tier is inferred: the first run of a worktree and revision, at most 4 files, no
checkpoint). Edit tiers run at nice 10 like the rest of Squeal's work, so the measured curve applies to them as it is.
Without Squeal's other work, busy cores drop by the nice cores times the other work's share of Squeal's files at
once during the tier (inferred: cores split as files do).
"""
import bisect, collections, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import Sar, Step, load_runs, med, quant

runs_path, sar_path, exclude = sys.argv[1:4]
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
seen = set()
for r in runs:
    k = (r["project"], r["wt"], r["revision"])
    if r["kind"] == "tier":
        r["kind"] = "edit" if k not in seen and r["picked"] <= 4 else "backlog"
    seen.add(k)
allq = Step([(r["start"], r["end"], r["par"]) for r in runs])
other = Step([(r["start"], r["end"], r["par"]) for r in runs if r["kind"] != "edit"])
t0, t1 = sar.s[0][0] * 1000, sar.s[-1][1] * 1000


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


out = collections.defaultdict(lambda: {"n": 0, "wall": [], "S": 0.0, "Scf": 0.0, "w": 0.0, "added": 0.0, "delay": []})
for r in runs:
    if r["kind"] != "edit" or r["start"] < t0 or r["end"] > t1:
        continue
    b, n = load_during(r["start"], r["end"])
    a = allq.mean(r["start"], r["end"])
    share = other.mean(r["start"], r["end"]) / a if a > 0 else 0.0
    s, scf = S(b), S(max(1.0, b - n * share))
    for key in (r["project"], "all"):
        o = out[key]
        o["n"] += 1
        o["wall"].append(r["wall"])
        o["w"] += r["wall"]
        o["S"] += s * r["wall"]
        o["Scf"] += scf * r["wall"]
        o["added"] += r["wall"] * (1 - scf / s)
        if r["revAt"]:
            o["delay"].append((r["start"] - r["revAt"]) / 1000)
for k, o in out.items():
    print(json.dumps({"project": k, "editTiers": o["n"], "medianWallS": round(med(o["wall"]), 1), "p90WallS": round(quant(o["wall"], .9), 1),
                      "wallH": round(o["w"] / 3600, 1), "slowdown": round(o["S"] / o["w"], 3), "slowdownWithoutOtherSquealWork": round(o["Scf"] / o["w"], 3),
                      "addedByOtherSquealWorkH": round(o["added"] / 3600, 2), "addedShare": round(100 * o["added"] / o["w"], 1),
                      "revisionToStart": {"n": len(o["delay"]), "median": round(med(o["delay"]), 1) if o["delay"] else None,
                                          "p75": round(quant(o["delay"], .75), 1) if o["delay"] else None,
                                          "p90": round(quant(o["delay"], .9), 1) if o["delay"] else None}}))
