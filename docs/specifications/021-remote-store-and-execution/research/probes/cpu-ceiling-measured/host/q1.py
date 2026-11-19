"""Q1 of cpu-ceiling-measured (row 021-19): this host's week under D18, from recorded runs, sar and daemon logs.
Throwaway, read only. Usage: python3 -I q1.py RUNS.jsonl SAR-U.csv LOGS_GLOB_FILE FROM_ISO TO_ISO [EXCLUDE_ROOT_PART]

Tier kinds as ../../cpu-budget/replay.py: a checkpoint's kind, else "edit" for the first run of a (project, worktree,
revision) with at most 4 picked files, else "backlog". Background = backlog + baseline; foreground = edit + run-all.
A background tier's arrival is the later of its revision's creation and the end of the worktree's previous background
tier, never after its start: wait = start - arrival, finish = end - arrival. A revision's backlog finish is from the
revision's creation to the end of its last background tier, weighted by the summed file seconds of its tiers.
CPU per test file against its fast reference: as ../../../../011-core/research/probes/background-backoff/signal.py,
duration / the 25th percentile of the same project and file's durations in the 7 days before (5 or more), files of
100 ms or more in completed runs without a failure. "Per work" is ../../cpu-budget/replay.py's background CPU per
isolated core-second, from the 011 curve S(busy): sum(w) / sum(w / S(B)) over background worker-seconds w.
"""
import bisect, calendar, collections, glob, json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
P011 = os.path.join(HERE, "..", "..", "..", "..", "..", "011-core", "research", "probes")
sys.path[:0] = [os.path.join(P011, "load-slowdown"), os.path.join(P011, "background-backoff")]
from load import load_sar, quant, med  # noqa: E402
from curve import S  # noqa: E402

runs_path, sar_path, logs_list, a_iso, b_iso = sys.argv[1:6]
exclude = sys.argv[6] if len(sys.argv) > 6 else None
iso = lambda s: calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))
A, B = iso(a_iso), iso(b_iso)
H = 3600.0
days = (B - A) / 86400

runs = []
for line in open(runs_path):
    r = json.loads(line)
    if exclude and r["root"] and exclude in r["root"]:
        continue
    if r["end"] <= r["start"]:
        continue
    r["s"], r["e"] = r["start"] / 1000, r["end"] / 1000
    r["wall"] = r["e"] - r["s"]
    r["fsum"] = sum(d for _, d in r["files"]) / 1000
    r["par"] = max(1.0, min(float(len(r["picked"]) or 1), r["fsum"] / r["wall"])) if r["wall"] > 0 else 1.0
    runs.append(r)
runs.sort(key=lambda r: r["s"])
seen = set()
for r in runs:
    k = (r["project"], r["wt"], r["revision"])
    r["kind"] = r["cp"] or ("edit" if k not in seen and len(r["picked"]) <= 4 else "backlog")
    seen.add(k)
    r["bg"] = r["kind"] in ("backlog", "baseline")

sar = [s for s in load_sar(sar_path)]
ends = [s[1] for s in sar]
def sample(t):
    i = bisect.bisect_left(ends, t)
    return sar[i] if i < len(sar) and sar[i][0] <= t <= sar[i][1] else None

out = {"window": [a_iso, b_iso], "days": round(days, 2)}
# --- host load from sar (10-minute samples ending in the window)
W = [s for s in sar if A <= s[1] <= B]
tot = sum(s[1] - s[0] for s in W)
share = lambda f: round(100 * sum(s[1] - s[0] for s in W if f(s)) / tot, 1)
out["sar"] = {"samples": len(W), "meanBusy": round(sum(s[2] * (s[1] - s[0]) for s in W) / tot, 2),
              "meanNice": round(sum(s[3] * (s[1] - s[0]) for s in W) / tot, 2),
              "pctAbove": {str(x): share(lambda s, x=x: s[2] > x) for x in (6, 12, 16, 18, 20)},
              "niceCoreHperDay": round(sum(s[3] * (s[1] - s[0]) for s in W) / H / days, 1),
              "otherAbove12pctOfAbove20": None}
hi = [s for s in W if s[2] > 20]
out["sar"]["above20"] = {"n": len(hi), "otherAtLeast12": sum(1 for s in hi if s[2] - s[3] >= 12),
                         "meanOther": round(sum(s[2] - s[3] for s in hi) / len(hi), 1) if hi else None,
                         "meanNice": round(sum(s[3] for s in hi) / len(hi), 1) if hi else None}
del out["sar"]["otherAbove12pctOfAbove20"]

# --- tiers in the window
inw = [r for r in runs if A <= r["s"] < B]
kinds = collections.Counter(r["kind"] for r in inw)
out["tiers"] = dict(kinds)
out["fileRuns"] = {k: sum(len(r["picked"]) for r in inw if r["kind"] == k) for k in kinds}
bg = [r for r in inw if r["bg"]]
ed = [r for r in inw if r["kind"] == "edit"]
out["bgTierWallS"] = [round(quant([r["wall"] for r in bg], p), 1) for p in (.5, .9)]
out["edit"] = {"wallH": round(sum(r["wall"] for r in ed) / H, 2), "wallHperDay": round(sum(r["wall"] for r in ed) / H / days, 2),
               "wallS_p50_p90": [round(quant([r["wall"] for r in ed], p), 2) for p in (.5, .9)],
               "startDelayS_p50_p90": [round(quant(d, p), 1) for d in [[r["s"] - r["revAt"] / 1000 for r in ed if r["revAt"]]] for p in (.5, .9)]}
# daemons: worktrees with a tier running (busy), mean over the window
ev = []
for r in inw:
    ev += [(r["s"], 1, (r["project"], r["wt"])), (min(r["e"], B), -1, (r["project"], r["wt"]))]
ev.sort()
open_by = collections.Counter(); area = 0.0; last = A
for t, d, w in ev:
    area += sum(1 for v in open_by.values() if v > 0) * (t - last); last = t
    open_by[w] += d
out["daemons"] = {"meanBusyDaemons": round(area / (B - A), 2),
                  "worktreesWithRunsPerDay": round(len({(r["project"], r["wt"], int(r["s"] // 86400)) for r in inw}) / days, 1),
                  "worktrees": len({(r["project"], r["wt"]) for r in inw})}
out["niceCoreHperBusyDaemonH"] = round(out["sar"]["niceCoreHperDay"] / 24 / out["daemons"]["meanBusyDaemons"], 2)

# --- background waits: consecutive background tiers of one worktree (cpu-budget.md Method, "Chains")
prev = {}
gaps, gaps_same_rev, within2, alone, n = [], [], 0, 0, 0
running = collections.defaultdict(list)  # worktree -> ends of its background tiers so far
for r in sorted([r for r in runs if r["bg"]], key=lambda r: r["s"]):
    w = (r["project"], r["wt"])
    p = prev.get(w)
    if A <= r["s"] < B:
        n += 1
        if p is not None and p["e"] <= r["s"]:
            g = r["s"] - p["e"]
            gaps.append(g)
            within2 += g <= 2
            if p["revision"] == r["revision"]:
                gaps_same_rev.append(g)
        alone += not any(e > r["s"] for e in running[w])
    running[w] = [e for e in running[w] if e > r["s"]] + [r["e"]]
    if p is None or r["e"] >= p["e"]:
        prev[w] = r
out["bgChains"] = {"tiers": n, "startWithin2sOfPrevEndPct": round(100 * within2 / n, 1), "noOtherBgRunningPct": round(100 * alone / n, 1),
                   "gapS_p50_p90_p99": [round(quant(gaps, p), 1) for p in (.5, .9, .99)],
                   "gapSameRevisionS_p50_p90_p99": [round(quant(gaps_same_rev, p), 1) for p in (.5, .9, .99)],
                   "bgTiersWithRevisionRowPct": round(100 * sum(1 for r in bg if r["revAt"]) / len(bg), 1)}
# --- backlog finish per revision, weighted by work
rev = collections.defaultdict(list)
for r in bg:
    if r["revAt"]:
        rev[(r["project"], r["wt"], r["revision"])].append(r)
items = []
for k, rs in rev.items():
    w = sum(r["fsum"] for r in rs)
    if w <= 0:
        continue
    items.append(((max(r["e"] for r in rs) - rs[0]["revAt"] / 1000) / 60, w))
items.sort()
def wq(items, p):
    tw = sum(w for _, w in items); c = 0
    for x, w in items:
        c += w
        if c >= p * tw:
            return round(x, 1)
out["backlogFinishMin_workweighted_p50_p90"] = [wq(items, .5), wq(items, .9)]
out["backlogFinishMin_unweighted_p50_p90"] = [round(quant([x for x, _ in items], p), 1) for p in (.5, .9)]
out["revisionsWithBackground"] = len(items)

# --- CPU per test file against its fast reference
recs = []
for i, r in enumerate(runs):
    if r["failure"] or r["state"] != "completed":
        continue
    for f, d in r["files"]:
        if d >= 100:
            recs.append((r["end"], (r["project"], f), d, i))
recs.sort()
hist = collections.defaultdict(list)
BANDS = [0, 6, 12, 16, 20, 99]
ratios = {"bg": [], "fg": []}
byband = collections.defaultdict(list)
for t, key, d, i in recs:
    h = hist[key]
    while h and h[0][0] < t - 7 * 86400e3:
        h.pop(0)
    if A * 1000 <= t < B * 1000 and len(h) >= 5:
        ref = quant([x for _, x in h], .25)
        x = d / ref
        r = runs[i]
        ratios["bg" if r["bg"] else "fg"].append((x, d))
        s = sample(t / 1000)
        if s is not None:
            byband[(next(k for k in range(5) if s[2] < BANDS[k + 1]), "bg" if r["bg"] else "fg")].append(x)
    h.append((t, d))
def summ(v):
    return {"n": len(v), "median": round(med([x for x, _ in v]), 3),
            "durationWeightedMean": round(sum(x * d for x, d in v) / sum(d for _, d in v), 3)} if v else None
out["fileVsRef"] = {k: summ(v) for k, v in ratios.items()}
out["fileVsRefByBusyBand_median_n"] = {f"{BANDS[b]}-{BANDS[b+1]} {c}": [round(med(v), 3), len(v)] for (b, c), v in sorted(byband.items())}
# per work, from the curve, over background worker-seconds
num = den = 0.0
for r in bg:
    t = r["s"]
    while t < r["e"]:
        s = sample(t)
        nxt = min(r["e"], s[1] if s else t + 600)
        if s is not None:
            w = r["par"] * (nxt - t); num += w; den += w / S(s[2])
        t = nxt if nxt > t else t + 600
out["perWorkCurve"] = round(num / den, 3) if den else None

# --- Squeal CPU (sar %nice) split into background and foreground by worker-seconds per sample, as replay.py
wbg = collections.defaultdict(float); wfg = collections.defaultdict(float)
for r in runs:
    t = max(r["s"], A - 600)
    while t < r["e"]:
        s_ = sample(t)
        nxt = min(r["e"], s_[1]) if s_ else t + 600
        if s_ is not None and nxt > t:
            (wbg if r["bg"] else wfg)[s_[1]] += r["par"] * (nxt - t)
        t = nxt if nxt > t else t + 600
G = Fg = iso_work = 0.0
gb = collections.defaultdict(float)
for s_ in W:
    L = s_[1] - s_[0]; w = wbg[s_[1]] + wfg[s_[1]]
    if w <= 0:
        continue
    g = s_[3] * wbg[s_[1]] / w
    G += g * L; Fg += (s_[3] - g) * L; iso_work += g * L / S(s_[2])
    gb[next(k for k in range(5) if s_[2] < BANDS[k + 1])] += g * L
hi16 = [s_ for s_ in W if s_[2] > 16]
def g_of(s_):
    w = wbg[s_[1]] + wfg[s_[1]]
    return s_[3] * wbg[s_[1]] / w if w > 0 else 0.0
out["squealCpu"] = {"bgCoreH": round(G / H, 1), "fgCoreH": round(Fg / H, 1), "bgCoreHperDay": round(G / H / days, 1),
                    "fgCoreHperDay": round(Fg / H / days, 1), "bgIsolatedWorkH": round(iso_work / H, 1),
                    "perWork": round(G / iso_work, 3) if iso_work else None,
                    "bgCoreSperTier": round(G / len(bg), 1), "bgCoreSperFileRun": round(G / sum(len(r["picked"]) for r in bg), 2),
                    "bgShareByBusyBandPct": {f"{BANDS[b]}-{BANDS[b+1]}": round(100 * v / G, 1) for b, v in sorted(gb.items())},
                    "above16": {"n": len(hi16), "meanOther": round(sum(s_[2] - s_[3] for s_ in hi16) / len(hi16), 1) if hi16 else None,
                                "meanBg": round(sum(g_of(s_) for s_ in hi16) / len(hi16), 2) if hi16 else None}}

# --- D18 refusals in the daemon logs
pat = re.compile(r"^(\S+) \[(\d+)\] squeal daemon: the background ceiling refused a backlog tier: ([\d.]+) busy CPUs, (.*)$")
lines, firsts, ceilings = [], [], collections.Counter()
for path in open(logs_list).read().split():
    first = None
    for l in open(path, errors="replace"):
        ts = l[:24]
        if first is None and ts[:2] == "20":
            first = ts
        m = pat.match(l.rstrip("\n"))
        if m:
            t = calendar.timegm(time.strptime(m.group(1)[:19], "%Y-%m-%dT%H:%M:%S")) + float("0" + m.group(1)[19:23])
            if A <= t < B:
                lines.append((path, int(m.group(2)), t, float(m.group(3))))
                ceilings[m.group(4)] += 1
    if first:
        firsts.append(first)
lines.sort(key=lambda x: (x[0], x[1], x[2]))
eps = []
for path, pid, t, busy in lines:
    if eps and eps[-1][0] == (path, pid) and t - eps[-1][2] < 5:
        eps[-1][2] = t; eps[-1][3] += 1; eps[-1][4] += busy
    else:
        eps.append([(path, pid), t, t, 1, busy])
held = [e[2] - e[1] + 2 for e in eps]
bz = [x[3] for x in lines]
out["refusals"] = {"lines": len(lines), "perDay": round(len(lines) / days), "ceilingText": dict(ceilings),
                   "busyRead_p10_p50_p90": [round(quant(bz, p), 1) for p in (.1, .5, .9)] if bz else None,
                   "busyReadBelow6": sum(1 for x in bz if x < 6), "busyReadAtLeast18": sum(1 for x in bz if x >= 18),
                   "episodes": len(eps), "episodeHeldS_p50_p90_max": [round(quant(held, p), 1) for p in (.5, .9, 1)] if held else None,
                   "heldHours": round(sum(held) / H, 1),
                   "heldHoursMeanBusyBelow18": round(sum(h for h, e in zip(held, eps) if e[4] / e[3] < 18) / H, 1),
                   "logFiles": len(firsts), "logFilesStartingAfterWindowStart": sum(1 for f in firsts if f > a_iso)}

# --- chains with the ceiling's holds: a background tier continues its worktree's chain when it starts within 5 s of
# the previous one's end (cpu-budget.md Method), or when that worktree's daemon logged a refusal episode in the gap
# that ended within 5 s of the start (the ceiling held it). Tier finish = end - arrival (the previous end when
# chained, else its start); chain finish = first start to last end, weighted by the chain's summed file seconds.
by_wt = collections.defaultdict(list)
for e in eps:
    by_wt[os.path.basename(e[0][0]).split("-")[1].split(".")[0]].append((e[1], e[2]))
for v in by_wt.values():
    v.sort()
def held(wt, a, b):
    for s0, e0 in by_wt.get(wt, ()):
        if s0 <= b and e0 >= a and e0 >= b - 5:
            return True
    return False
def chains(use_holds):
    prev, cur = {}, {}
    fin, waits, out_chains, chained = [], [], [], 0
    for r in sorted([r for r in runs if r["bg"] and A <= r["s"] < B], key=lambda r: r["s"]):
        w = (r["project"], r["wt"])
        p = prev.get(w)
        ok = p is not None and p["e"] <= r["s"] and (r["s"] - p["e"] <= 5 or (use_holds and held(r["wt"], p["e"], r["s"])))
        if ok:
            arr = p["e"]; chained += 1; cur[w][1] = r["e"]; cur[w][2] += r["fsum"]
        else:
            if w in cur:
                out_chains.append(cur[w])
            arr = r["s"]; cur[w] = [r["s"], r["e"], r["fsum"]]
        fin.append(r["e"] - arr); waits.append(r["s"] - arr)
        if p is None or r["e"] >= p["e"]:
            prev[w] = r
    out_chains += list(cur.values())
    items = sorted(((c[1] - c[0]) / 60, c[2]) for c in out_chains if c[2] > 0)
    return {"chainedPct": round(100 * chained / len(fin), 1), "tierFinishS_p50_p90": [round(quant(fin, p), 1) for p in (.5, .9)],
            "waitS_p90_p99": [round(quant(waits, p), 1) for p in (.9, .99)],
            "chains": len(items), "chainFinishMin_workweighted_p50_p90": [wq(items, .5), wq(items, .9)]}
out["chains5s"] = chains(False)
out["chainsWithHolds"] = chains(True)
print(json.dumps(out, indent=1))
