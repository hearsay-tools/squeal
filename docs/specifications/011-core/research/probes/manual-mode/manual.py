"""Q1-Q3: replay a machine-wide manual mode for Squeal's background work on recorded history. Throwaway, read only.

Usage: python3 -I manual.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART EPS.json SIG60.json SEED OUT-PERIODS.json [POLICY...]
POLICY is `today`, `aimd2:ON` (background-backoff's stepped budget) or `manual:ON:N:OFF:K:RAMP[:hold]`:
- enter manual after N windows of 60 s in a row with signal > ON (the chosen shape: N = 2);
- resume after K windows in a row with signal <= OFF;
- after a resume the background ceiling starts at MIN cores and grows RAMP cores per window (`inf`: no ramp);
  with `hold` it grows only in windows at or below OFF.
Without POLICY it runs a fixed grid. OUT-PERIODS.json gets each manual policy's periods [start_s, end_s].

The model is background-backoff/replay.py's (its docstring), on 60 s steps instead of 10-minute samples:
- each sar sample gives B busy, G background cores (backlog + restart baselines), E foreground cores (edit tiers and
  `run --all`), O = B - G - E. Background demand arrives evenly over the sample's 10 steps as isolated core-seconds,
  G * 60 / S(B), and waits in a first-in, first-out queue. O and E stay as recorded in every policy. In manual mode
  edit tiers run when the agent asks or at the stop check instead of at the edit; the replay keeps their cores where
  they were (a shift of minutes inside a turn; edit tiers are 3.5% of Squeal's work above 16 busy).
- served work at g cores does g * 60 / S(O + E + g) isolated core-seconds in a step.
- automatic: g drains the queue up to a ceiling: AUTO_CAP (the pool) or the recorded G if higher, the free CPUs
  (24 - O - E), the curve's throughput peak, and, after a resume, the ramp. `today` is the recorded runs.
- manual: g is at most MIN = 2 cores (one permit, the slot for the longest-waiting file) while work waits.
- the signal each step is S(O + E + g) * e. With NOISE=replay (default) e is the measured residual of that minute,
  signal60.py's 60 s signal over S(recorded busy), so the noise keeps its recorded persistence; a minute with no
  measured signal draws e as NOISE=draw does for every step: from the 10-minute residuals of the step's busy band
  widened to the measured 60 s spread (replay.py's `noise`). A step with fewer than 0.3 Squeal cores running has no records: no signal,
  and the counters hold.
"""
import bisect, collections, json, math, os, random, sys
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "background-backoff"), os.path.join(HERE, "..", "load-slowdown")]
from load import Sar, band, load_runs, med, quant
from curve import S

runs_path, sar_path, exclude, eps_path, sig60_path, seed, periods_out = sys.argv[1:8]
POLICIES = sys.argv[8:]
NOISE = os.environ.get("NOISE", "replay")
SIG60 = {int(k): v for k, v in json.load(open(sig60_path)).items()}
CPUS, SAMPLE, STEP = 24.0, 600.0, 60.0
MIN = float(os.environ.get("REPLAY_MIN", 2.0))
SLOT_EVERY = int(os.environ.get("SLOT_EVERY", 1))  # the one slot, in cores (replay.py's starvation bound)
# Automatic mode's ceiling for draining waiting work, in cores: the pool's permits times the cores one Vitest worker
# used (replay.py prints 0.7 at the median). Default 12 permits (this host's hostSlots) = 8.4 cores; never below the
# recorded background cores of the sample, so automatic mode alone reproduces the recorded runs.
AUTO_CAP = float(os.environ.get("AUTO_CAP", 8.4))
sar = Sar(sar_path)
runs = load_runs(runs_path, exclude)
eps = {int(float(k)): v for k, v in json.load(open(eps_path)).items()}

seen = set()
for r in runs:
    k = (r["project"], r["wt"], r["revision"])
    if r["kind"] == "tier":
        r["kind"] = "edit" if k not in seen and r["picked"] <= 4 else "backlog"
    seen.add(k)
FG = {"edit", "run-all"}
wbg = collections.defaultdict(float)
wfg = collections.defaultdict(float)
for r in runs:
    for s in sar.s[bisect.bisect_left(sar.ends, r["start"] / 1000):]:
        if s[0] * 1000 >= r["end"]:
            break
        a, b = max(r["start"], s[0] * 1000), min(r["end"], s[1] * 1000)
        if b > a:
            (wfg if r["kind"] in FG else wbg)[s[1]] += r["par"] * (b - a) / 1000

samples = []
# START (ISO, UTC): replay only samples that end after it. The stores hold almost no runs from 2026-10-30 10:47Z to
# 2026-10-31 14:11Z and few until 20:00Z, so switch counts use START=2026-10-31T20:00:00Z.
START = os.environ.get("START")
START = datetime.fromisoformat(START.replace("Z", "+00:00")).timestamp() if START else 0
for s in sar.s:
    if s[1] <= START:
        continue
    B, N = s[2], s[3]
    w = wbg[s[1]] + wfg[s[1]]
    G = N * wbg[s[1]] / w if w > 0 else 0.0
    E = N - G if w > 0 else 0.0
    samples.append({"start": s[0], "end": s[1], "dur": s[1] - s[0], "B": B, "O": B - G - E, "E": E, "G": G,
                    "eps": eps.get(s[1], {}).get("eps", 1.0), "sig": eps.get(s[1], {}).get("signal")})
DAYS = sum(x["dur"] for x in samples) / 86400

BANDS = [0, 6, 12, 16, 20, 24.01]
res = collections.defaultdict(list)
for x in samples:
    if x["sig"] is not None:
        res[band(x["B"], BANDS)].append(x["eps"])


def noise(b, rng, t=None, B=None):
    if NOISE == "replay" and t is not None:
        v = SIG60.get(int(t // 60) * 60)
        if v is not None and B is not None:
            return v[0] / S(B)
    pool = res.get(band(b, BANDS)) or [1.0]
    return rng.choice(pool) * rng.lognormvariate(0, 0.12)


def yield_(g, base):
    return g * STEP / S(base + g)


def peak(base):
    """The cores where g / S(base + g) is largest: more cores than this do less work (the curve's throughput peak)."""
    lo, hi = 0.0, CPUS
    for _ in range(40):
        a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (a, hi) if yield_(a, base) < yield_(b, base) else (lo, b)
    return lo


def cores_for(work, base, cap):
    """The fewest cores that do `work` isolated core-seconds in a step, at most cap and at most the peak."""
    if work <= 0 or cap <= 0:
        return 0.0
    cap = min(cap, peak(base))
    if yield_(cap, base) <= work:
        return cap
    lo, hi = 0.0, cap
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if yield_(mid, base) < work else (lo, mid)
    return hi


def wq(dl, p):
    tot = sum(w for _, w in dl)
    acc = 0.0
    for m, w in dl:
        acc += w
        if acc >= p * tot:
            return m
    return 0


def run(spec):
    rng = random.Random(int(seed))
    parts = spec.split(":")
    kind = parts[0]
    on = float(parts[1]) if len(parts) > 1 else math.inf
    n_on = int(parts[2]) if kind == "manual" else 2
    off = float(parts[3]) if kind == "manual" else on
    K = int(parts[4]) if kind == "manual" else 0
    ramp = float(parts[5]) if kind == "manual" else math.inf
    hold = kind == "manual" and len(parts) > 6 and parts[6] == "hold"
    queue = collections.deque()  # [arrival step, isolated core-seconds]
    acc = collections.defaultdict(float)
    delays = []
    mode, over, under = "auto", 0, 0
    ramp_cap, budget = math.inf, MIN
    periods, cur = [], None
    resumes = []  # [step of resume, step caught up or None]
    nsteps = 0
    for x in samples:
        base = x["O"] + x["E"]
        n = max(1, round(x["dur"] / STEP))
        arrive = x["G"] * STEP / S(x["B"])
        for j in range(n):
            t = x["start"] + j * STEP
            i = nsteps
            nsteps += 1
            acc["arrived"] += arrive
            if arrive > 0:
                queue.append([i, arrive])
            pending = sum(q[1] for q in queue)
            free = max(0.0, CPUS - base)
            if kind == "today":  # the recorded runs
                g = x["G"]
                done = min(pending, yield_(g, base))
                cap = None
            elif kind == "aimd2":
                cap = budget
            elif mode == "manual":
                cap = MIN
            else:
                cap = min(ramp_cap, max(AUTO_CAP, x["G"]))
            if cap is not None:
                g = cores_for(pending, base, max(min(cap, free), min(MIN, cap)))
                done = min(pending, yield_(g, base))
            acc["done"] += done
            left = done
            while left > 1e-9 and queue:
                a, w = queue[0]
                take = min(w, left)
                if a < i:
                    acc["deferred"] += take
                    delays.append((i - a, take))
                    if i - a >= 10:
                        acc["deferred10"] += take
                left -= take
                if take >= w - 1e-9:
                    queue.popleft()
                else:
                    queue[0][1] -= take
            Bn = base + g
            acc["t"] += STEP
            acc["bg"] += g * STEP
            acc["o"] += x["O"] * STEP
            acc["o_slow"] += x["O"] * STEP * S(Bn)
            for k in (16, 18, 20):
                acc[f"bg{k}"] += g * STEP * (Bn >= k)
                acc[f"t{k}"] += STEP * (Bn >= k)
            if mode == "manual":
                acc["t_manual"] += STEP
                acc["fg_manual"] += x["E"] * STEP
            # Catch-up after a resume: the first step whose queue is under one step's arrivals plus 60 core-seconds.
            qleft = sum(q[1] for q in queue)
            if resumes and resumes[-1][1] is None and mode == "auto" and qleft <= arrive + 60:
                resumes[-1][1] = i
            # The signal and the switch, read at the end of the step.
            if kind == "today":
                continue
            sig = S(Bn) * noise(Bn, rng, t, x["B"]) if g + x["E"] >= 0.3 else None
            # SLOT_EVERY=n: in manual mode with only the slot running (foreground under 0.3 cores), a reading needs n
            # steps: one worker gives a median 3.2 file records a minute, and a window needs 5.
            if mode == "manual" and x["E"] < 0.3 and i % SLOT_EVERY:
                sig = None
            if kind == "aimd2":
                if sig is None:
                    continue
                over = over + 1 if sig > on else 0
                if over >= 2:
                    budget = max(MIN, budget / 2)
                elif sig <= on:
                    budget = min(max(MIN, cores_for(qleft, base, CPUS)), budget + 1)
                continue
            if sig is None:
                continue
            if mode == "auto":
                over = over + 1 if sig > on else 0
                if ramp_cap < math.inf and (not hold or sig <= off):
                    ramp_cap = ramp_cap + ramp
                    if ramp_cap >= CPUS:
                        ramp_cap = math.inf
                if over >= n_on:
                    mode, over, under = "manual", 0, 0
                    cur = [t + STEP, None, qleft]
                    if resumes and resumes[-1][1] is None:
                        resumes[-1][1] = -1  # flipped back before catching up
            else:
                under = under + 1 if sig <= off else 0
                if under >= K:
                    mode, over, under = "auto", 0, 0
                    ramp_cap = MIN if ramp < math.inf else math.inf
                    cur[1] = t + STEP
                    cur.append(qleft)
                    periods.append(cur)
                    cur = None
                    resumes.append([i + 1, None])
    if cur:
        cur[1] = samples[-1]["end"]
        cur.append(sum(q[1] for q in queue))
        periods.append(cur)
    dl = sorted(delays)
    lens = sorted((p[1] - p[0]) / 60 for p in periods)
    caught = [r[1] - r[0] for r in resumes if r[1] is not None and r[1] >= 0]
    flipped = sum(1 for r in resumes if r[1] == -1)
    gaps = [(periods[k + 1][0] - periods[k][1]) / 60 for k in range(len(periods) - 1)]
    out = {"policy": spec,
           "bgShareAbove16_18_20": [round(100 * acc[f"bg{k}"] / acc["bg"], 1) for k in (16, 18, 20)],
           "hostTimeAbove16_18_20": [round(100 * acc[f"t{k}"] / acc["t"], 1) for k in (16, 18, 20)],
           "othersMeanSlowdown": round(acc["o_slow"] / acc["o"], 3),
           "bgCoreHours": round(acc["bg"] / 3600, 1),
           "deferredPct": round(100 * acc["deferred"] / acc["arrived"], 1),
           "deferred10minPct": round(100 * acc["deferred10"] / acc["arrived"], 1),
           "delayMin_p50_p95_max": [wq(dl, .5), wq(dl, .95), dl[-1][0] if dl else 0],
           "leftAtEndIsoHours": round(sum(q[1] for q in queue) / 3600, 2)}
    if kind == "manual":
        out.update({"periods": len(periods), "periodsPerDay": round(len(periods) / DAYS, 1),
                    "manualTimePct": round(100 * acc["t_manual"] / acc["t"], 1),
                    "periodMin_p50_p95_max": [round(quant(lens, .5)), round(quant(lens, .95)), round(lens[-1])] if lens else None,
                    "flipBackWithin10min": sum(1 for gp in gaps if gp <= 10),
                    "resumesFlippedBeforeCaughtUp": flipped,
                    "catchUpMin_p50_p95_max": [round(quant(caught, .5)), round(quant(caught, .95)), max(caught)] if caught else None,
                    "queueAtResumeIsoCoreMin_p50_p95": [round(quant([p[3] for p in periods], q) / 60) for q in (.5, .95)],
                    "foregroundCoreShareInManual": round(100 * acc["fg_manual"] / max(1, sum(x["E"] * x["dur"] for x in samples)), 1)})
    return out, periods


GRID = ["today", "aimd2:1.25"]
for n_on in (2, 5):
    for off in (1.25, 1.15, 1.10):
        for K in (2, 5):
            for ramp in ("inf", "2", "1"):
                GRID.append(f"manual:1.25:{n_on}:{off}:{K}:{ramp}")
            GRID.append(f"manual:1.25:{n_on}:{off}:{K}:1:hold")
allp = {}
print(json.dumps({"days": round(DAYS, 3), "steps": sum(max(1, round(x['dur'] / STEP)) for x in samples),
                  "bgCoreHoursRecorded": round(sum(x["G"] * x["dur"] for x in samples) / 3600, 1),
                  "fgCoreHoursRecorded": round(sum(x["E"] * x["dur"] for x in samples) / 3600, 1)}))
for spec in POLICIES or GRID:
    o, p = run(spec)
    allp[spec] = p
    print(json.dumps(o))
json.dump(allp, open(periods_out, "w"))
