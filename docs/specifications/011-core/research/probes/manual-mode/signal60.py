"""The measured 60 s signal, minute by minute, and the switch rules run on it as recorded. Throwaway, read only.

Usage: python3 -I signal60.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART OUT.json [DAYS=7 Q=0.25 MIN_REFS=5]

Records and references as background-backoff/signal.py: a file's module duration in a run that ended without a
failure line, over the Q-quantile of the same project and file's records in the DAYS before (at least MIN_REFS).
Each minute (UTC, aligned) gets the median ratio of the records that ended in it, all daemons pooled, when it holds at
least 5 records; else no signal. OUT.json: {minute_start_s: [signal, records, busy of the sar sample]}.
Then it runs the manual-mode switch on these minutes as recorded (no feedback from the switch to the load):
enter after N_ON minutes in a row above ON, resume after K minutes in a row at or below OFF; minutes with no signal
hold the counters. It prints periods per day and their length, and the lag-1 agreement of "above 1.25".
"""
import collections, json, os, sys
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "background-backoff"), os.path.join(HERE, "..", "load-slowdown")]
from load import Sar, load_runs, med, quant

runs_path, sar_path, exclude, out = sys.argv[1:5]
WINDOW = float(sys.argv[5]) * 86400e3 if len(sys.argv) > 5 else 7 * 86400e3
Q = float(sys.argv[6]) if len(sys.argv) > 6 else 0.25
MIN_REFS = int(sys.argv[7]) if len(sys.argv) > 7 else 5
sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
t0, t1 = sar.s[0][0] * 1000, sar.s[-1][1] * 1000
recs = []
for r in runs:
    if r["failure"] or r["state"] != "completed":
        continue
    for f, d in r["files"]:
        if d >= 100:
            recs.append((r["end"], (r["project"], f), d))
recs.sort()
hist = collections.defaultdict(collections.deque)
mins = collections.defaultdict(list)
for t, key, d in recs:
    h = hist[key]
    while h and h[0][0] < t - WINDOW:
        h.popleft()
    if t0 <= t <= t1 and len(h) >= MIN_REFS:
        mins[int(t // 60000) * 60].append(d / quant([x for _, x in h], Q))
    h.append((t, d))
sig = {}
for m, rs in mins.items():
    if len(rs) >= 5:
        s = sar.at(m + 30)
        sig[m] = [round(med(rs), 3), len(rs), round(s[2], 2) if s else None]
json.dump(sig, open(out, "w"))
START = os.environ.get("START")  # ISO UTC: count switches only from here (see manual.py)
START = datetime.fromisoformat(START.replace("Z", "+00:00")).timestamp() if START else 0
allmin = [m for m in range(int(t0 // 60000) * 60, int(t1 // 60000) * 60, 60) if sar.at(m + 30) and m >= START]
sig = {m: v for m, v in sig.items() if m >= START}
days = len(allmin) / 1440
print(json.dumps({"minutes": len(allmin), "days": round(days, 2), "minutesWithSignal": len(sig),
                  "coveragePct": round(100 * len(sig) / len(allmin), 1),
                  "recordsPerSignalMinute_p25_p50": [quant([v[1] for v in sig.values()], q) for q in (.25, .5)]}))
# Persistence: P(above at m+1 | above at m) against P(above).
for th in (1.25,):
    a = [m for m in sig if sig[m][0] > th]
    nxt = [m for m in a if m + 60 in sig]
    print(json.dumps({"theta": th, "pAbove": round(len(a) / len(sig), 3),
                      "pAboveNextGivenAbove": round(sum(sig[m + 60][0] > th for m in nxt) / len(nxt), 3)}))


def switch(on, n_on, off, k):
    mode, over, under, start, periods = "auto", 0, 0, None, []
    for m in allmin:
        v = sig.get(m)
        if v is None:
            continue
        if mode == "auto":
            over = over + 1 if v[0] > on else 0
            if over >= n_on:
                mode, start, under = "manual", m + 60, 0
        else:
            under = under + 1 if v[0] <= off else 0
            if under >= k:
                periods.append((start, m + 60))
                mode, over = "auto", 0
    if mode == "manual":
        periods.append((start, allmin[-1] + 60))
    lens = sorted((e - s) / 60 for s, e in periods)
    return {"on": on, "nOn": n_on, "off": off, "k": k, "periodsPerDay": round(len(periods) / days, 1),
            "manualTimePct": round(100 * sum(lens) / len(allmin), 1),
            "lenMin_p50_p95_max": [quant(lens, .5), quant(lens, .95), lens[-1]] if lens else None}


for on, n_on in ((1.25, 2), (1.25, 3), (1.25, 5)):
    for off, k in ((1.25, 2), (1.15, 2), (1.15, 5), (1.10, 2), (1.10, 5)):
        print(json.dumps(switch(on, n_on, off, k)))
