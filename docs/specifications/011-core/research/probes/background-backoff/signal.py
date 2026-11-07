"""Shape 1: the self-calibrating slowdown signal, read from history. Throwaway, read only.

Usage: python3 -I signal.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART OUT-EPS.json [WINDOW_DAYS=7] [Q=0.25] [MIN_REFS=5]

A record is one file's module duration in one run that ended without a failure line (as load-slowdown/slowdown.py),
at the run's end. Its reference is causal and needs no load label: the Q-quantile of the same project and file's
records in the WINDOW_DAYS before it, once there are MIN_REFS of them. Its ratio is duration / reference.
- A run's signal is the median ratio of its referenced files: what one daemon sees when that tier ends.
- A sar sample's signal is the median ratio of all records whose run ended in it: what the daemons see together.
Prints coverage, the signal per busy band, how often a threshold flags each band, and writes, per sample, the signal
and its residual against the load-slowdown curve S(busy) (OUT-EPS.json), for replay.py.
"""
import bisect, collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "load-slowdown")]
from load import Sar, band, label, load_runs, med, quant
from curve import S

runs_path, sar_path, exclude, out = sys.argv[1:5]
WINDOW = float(sys.argv[5]) * 86400e3 if len(sys.argv) > 5 else 7 * 86400e3
Q = float(sys.argv[6]) if len(sys.argv) > 6 else 0.25
MIN_REFS = int(sys.argv[7]) if len(sys.argv) > 7 else 5
sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
BUSY = [0, 6, 12, 16, 20, 24.01]
t0, t1 = sar.s[0][0] * 1000, sar.s[-1][1] * 1000

recs = []  # (end_ms, key, dur, run index)
for i, r in enumerate(runs):
    if r["failure"] or r["state"] != "completed":
        continue
    for f, d in r["files"]:
        if d >= 100:
            recs.append((r["end"], (r["project"], f), d, i))
recs.sort()
hist = collections.defaultdict(list)  # key -> [(t, d)] in time order
ratio_of_run = collections.defaultdict(list)
per_sample = collections.defaultdict(list)
n_in = n_ref = 0
timed = []  # (end_ms, ratio, daemon) for the sliding windows
for t, key, d, i in recs:
    h = hist[key]
    while h and h[0][0] < t - WINDOW:
        h.pop(0)
    if t0 <= t <= t1:
        n_in += 1
        if len(h) >= MIN_REFS:
            ref = quant([x for _, x in h], Q)
            ratio = d / ref
            n_ref += 1
            ratio_of_run[i].append(ratio)
            timed.append((t, ratio, runs[i]["project"] + ":" + runs[i]["wt"]))
            s = sar.at(t / 1000)
            if s is not None:
                per_sample[s[1]].append(ratio)
    h.append((t, d))

print(json.dumps({"window_days": WINDOW / 86400e3, "q": Q, "min_refs": MIN_REFS, "records_in_window": n_in,
                  "with_reference": n_ref, "coverage_pct": round(100 * n_ref / n_in, 1)}))

# Run-level: one daemon's view at its tier's end, by the busy band at the run's midpoint.
run_sig = collections.defaultdict(list)
for i, rs in ratio_of_run.items():
    r = runs[i]
    s = sar.at((r["start"] + r["end"]) / 2000)
    if s is not None:
        run_sig[band(s[2], BUSY)].append((med(rs), len(rs)))
THETAS = [1.15, 1.2, 1.25, 1.3, 1.4, 1.5]
rows = {}
for b in sorted(run_sig):
    v = [x for x, _ in run_sig[b]]
    rows[label(BUSY, b)] = {"runs": len(v), "median": round(med(v), 2), "p25": round(quant(v, .25), 2), "p75": round(quant(v, .75), 2),
                            "curveS": round(S((BUSY[b] + min(BUSY[b + 1], 24)) / 2), 2),
                            "flagged_pct": {t: round(100 * sum(x > t for x in v) / len(v), 1) for t in THETAS}}
print(json.dumps({"run_level": rows}))

# Sample-level: all daemons' ratios pooled per 10-minute sample.
smp = collections.defaultdict(list)
eps = {}
for s in sar.s:
    rs = per_sample.get(s[1])
    if not rs:
        continue
    sig = med(rs)
    smp[band(s[2], BUSY)].append(sig)
    eps[s[1]] = {"signal": round(sig, 3), "n": len(rs), "busy": round(s[2], 2), "eps": round(sig / S(s[2]), 3)}
rows = {}
for b in sorted(smp):
    v = smp[b]
    rows[label(BUSY, b)] = {"samples": len(v), "median": round(med(v), 2), "p25": round(quant(v, .25), 2), "p75": round(quant(v, .75), 2),
                            "flagged_pct": {t: round(100 * sum(x > t for x in v) / len(v), 1) for t in THETAS}}
print(json.dumps({"sample_level": rows, "samples_with_signal": len(eps), "samples": len(sar.s)}))
# Detection of "above the knee" (busy >= 16) from the pooled signal: hits and false alarms per threshold.
above = [e for e in eps.values() if e["busy"] >= 16]
below = [e for e in eps.values() if e["busy"] < 12]
print(json.dumps({"detect_busy16": {t: {"hit_pct": round(100 * sum(e["signal"] > t for e in above) / len(above), 1),
                                        "false_alarm_below12_pct": round(100 * sum(e["signal"] > t for e in below) / len(below), 1)}
                                    for t in THETAS}}))
json.dump(eps, open(out, "w"))

# What a daemon would read live: the median ratio of the last 60 s of records, host-wide (every daemon's, as marks
# could share them) or its own, evaluated at each record's end once it holds at least 5 ratios.
SPAN, LEAST = 60e3, 5
for scope in ("host", "own"):
    windows = collections.defaultdict(collections.deque)
    by = collections.defaultdict(list)
    for t, ratio, wt in timed:
        w = windows["*" if scope == "host" else wt]
        w.append((t, ratio))
        while w[0][0] < t - SPAN:
            w.popleft()
        if len(w) < LEAST:
            continue
        s = sar.at(t / 1000)
        if s is not None:
            by[band(s[2], BUSY)].append(med([x for _, x in w]))
    print(json.dumps({"window_60s": scope, "bands": {label(BUSY, b): {"points": len(v), "median": round(med(v), 2),
                      "p25": round(quant(v, .25), 2), "p75": round(quant(v, .75), 2),
                      "flagged_pct": {t: round(100 * sum(x > t for x in v) / len(v), 1) for t in (1.2, 1.25, 1.3, 1.4)}}
                      for b, v in sorted(by.items())}}))
