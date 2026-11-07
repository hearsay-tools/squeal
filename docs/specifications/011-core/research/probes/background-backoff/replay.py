"""Q2: replay back-off policies for Squeal's background work on recorded history. Throwaway, read only.

Usage: python3 -I replay.py RUNS.jsonl SAR-U.csv EXCLUDE_ROOT_PART EPS.json [KNEE=16] [SEED=1] [SAR-Q.csv]

A fluid model over the 10-minute sar samples. Per sample, from history:
- B busy cores and N nice cores (Squeal's test processes run at nice 10, so N stands for their CPU).
- Squeal's worker seconds by kind (load-slowdown/exposure.py's rule): background = backlog + restart baseline;
  foreground = edit tiers + `squeal run --all`. N is split between them by worker seconds: G background cores,
  E foreground cores. O = B - N is everything else (agents, their own tests, builds, daemons).
- Background demand arrives as isolated work: G * 600 / S(B), with S the load-slowdown curve (curve.py).
A policy sets the background cores g allowed in each sample. Queued work is served first in, first out; served
work at g cores yields g * 600 / S(O + E + g) isolated core-seconds. O and E stay as recorded: the model asks what
background work alone would have done differently. Not modelled: background work that a later revision makes
obsolete while it waits (deferral would drop it: a saving), and changes in O caused by faster or slower answers.

Policies:
- today        g = G: the recorded runs.
- gate C       shapes 3+5: count cores, no floor: g = max(MIN, C - O - E). C in cores.
- ideal θ      shape 1 as an ideal tracker: the largest g with S(O + E + g) * eps <= θ, at least MIN; eps is the
               sample's residual from signal.py (pooled signal / S(busy)), 1 without a signal.
- aimd θ       shape 1 as a controller: 10 steps of 60 s per sample. Each step reads a noisy signal
               S(O + E + g) * e, e drawn from the 60 s host-wide residuals of signal.py's busy band; above θ it
               halves g (at least MIN), else adds 1 core, up to the work queued. `aimd2` backs off only after two
               steps in a row above θ.
- load θ       shape 2 with the signal Node has on Linux and macOS: the 1-minute load average per logical CPU, as an
               ideal tracker: the largest g with L(O + E + g) * rho <= θ, L the median load per CPU at a busy count
               (sar -q, 2-vCPU bands, interpolated) and rho the sample's own load over L(B). Needs SAR-Q.csv.
MIN, the starvation bound, is 2 cores: one permit of a Vitest worker and its children (1.3 to 2.3 cores).
"""
import bisect, collections, json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "load-slowdown")]
from load import Sar, band, label, load_runs, med, quant
from curve import S

runs_path, sar_path, exclude, eps_path = sys.argv[1:5]
KNEE = float(sys.argv[5]) if len(sys.argv) > 5 else 16.0
random.seed(int(sys.argv[6]) if len(sys.argv) > 6 else 1)
CPUS, STEP, MIN = 24.0, 600.0, 2.0
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
idx = {s[1]: i for i, s in enumerate(sar.s)}
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
cores_per_worker = []
for s in sar.s:
    B, N = s[2], s[3]
    w = wbg[s[1]] + wfg[s[1]]
    G = N * wbg[s[1]] / w if w > 0 else 0.0
    E = N - G if w > 0 else 0.0
    O = B - G - E
    if w > 60:
        cores_per_worker.append(N / (w / STEP))
    samples.append({"end": s[1], "dur": s[1] - s[0], "B": B, "O": O, "E": E, "G": G,
                    "eps": eps.get(s[1], {}).get("eps", 1.0), "sig": eps.get(s[1], {}).get("signal")})

LOADC = []
rho = {}
if len(sys.argv) > 7:
    q = {}
    for line in open(sys.argv[7]):
        f = line.strip().split(";")
        if len(f) >= 9 and "RESTART" not in line:
            q[int(f[2])] = float(f[5]) / CPUS
    pts = collections.defaultdict(list)
    for x in samples:
        if x["end"] in q:
            pts[min(int(x["B"] // 2) * 2, 22)].append(q[x["end"]])
    LOADC = [(k + 1, med(v)) for k, v in sorted(pts.items())]

    def L(b):
        if b <= LOADC[0][0]:
            return LOADC[0][1]
        for (x0, y0), (x1, y1) in zip(LOADC, LOADC[1:]):
            if b <= x1:
                return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
        return LOADC[-1][1]
    for x in samples:
        if x["end"] in q and L(x["B"]) > 0:
            rho[x["end"]] = q[x["end"]] / L(x["B"])

# The 60 s noise: residuals of signal.py's host-wide window are not saved; approximate them per busy band by the
# 10-minute residuals' spread widened to the 60 s spread signal.py printed (p25..p75 of 60 s / 10 min, by band).
BANDS = [0, 6, 12, 16, 20, 24.01]
res = collections.defaultdict(list)
for x in samples:
    if x["sig"] is not None:
        res[band(x["B"], BANDS)].append(x["eps"])


def noise(b):
    pool = res.get(band(b, BANDS)) or [1.0]
    return random.choice(pool) * random.lognormvariate(0, 0.12)


def yield_(g, base):
    """Isolated core-seconds g background cores do in one sample beside `base` other cores."""
    return g * STEP / S(base + g)


def cores_for(work, base, cap):
    """The cores that do `work` isolated core-seconds in one sample, at most cap."""
    if work <= 0 or cap <= 0:
        return 0.0
    if yield_(cap, base) <= work:
        return cap
    lo, hi = 0.0, cap
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if yield_(mid, base) < work else (lo, mid)
    return hi


def run(policy, param=None):
    queue = collections.deque()  # [arrival index, isolated core-seconds]
    out = {"bg_above": 0.0, "bg": 0.0, "fg_above": 0.0, "fg": 0.0, "t_above": 0.0, "t": 0.0,
           "deferred": 0.0, "arrived": 0.0, "delays": [], "o_slow": 0.0, "o": 0.0, "bg_iso": 0.0}
    g_state = MIN
    for i, x in enumerate(samples):
        base = x["O"] + x["E"]
        arrive = x["G"] * STEP / S(x["B"])
        out["arrived"] += arrive
        queue.append([i, arrive])
        pending = sum(q[1] for q in queue)
        if policy == "today":
            g = x["G"]
            work = arrive
        else:
            if policy == "gate":
                cap = max(MIN, param - base)
            elif policy == "load":
                cap = MIN
                r = rho.get(x["end"], 1.0)
                for k in range(1, 241):
                    c = k * 0.1
                    if L(base + c) * r > param:
                        break
                    cap = max(MIN, c)
            elif policy == "ideal":
                cap = MIN
                for k in range(1, 241):
                    c = k * 0.1
                    if S(base + c) * x["eps"] > param:
                        break
                    cap = max(MIN, c)
            else:  # aimd, aimd2: steps of 60 s inside the sample; the mean g of the steps is the sample's cap
                gs, over = [], 0
                for _ in range(10):
                    need = cores_for(pending, base, CPUS)
                    sig = S(base + min(g_state, need)) * noise(base + min(g_state, need))
                    over = over + 1 if sig > param else 0
                    if over >= (2 if policy == "aimd2" else 1):
                        g_state = max(MIN, g_state / 2)
                    elif sig <= param:
                        g_state = min(max(MIN, need), g_state + 1)
                    gs.append(g_state)
                cap = sum(gs) / len(gs)
            g = cores_for(pending, base, min(cap, CPUS))
            work = yield_(g, base) if g < cap else min(pending, yield_(g, base))
        done = min(work, pending) if policy != "today" else arrive
        out["bg_iso"] += done
        left = done
        while left > 1e-9 and queue:
            a, w = queue[0]
            take = min(w, left)
            if a < i and take > 1.0:  # float leftovers under a core-second are not deferred work
                out["deferred"] += take
                out["delays"].append(((i - a) * STEP / 60, take))
            left -= take
            if take >= w - 1e-6 or w - take < 1.0:
                queue.popleft()
            else:
                queue[0][1] -= take
        Bn = base + g
        d = x["dur"]
        above = Bn >= KNEE
        for k in (18, 20):
            out[f"bg_above{k}"] = out.get(f"bg_above{k}", 0.0) + g * d * (Bn >= k)
            out[f"t_above{k}"] = out.get(f"t_above{k}", 0.0) + d * (Bn >= k)
        out["bg"] += g * d
        out["fg"] += x["E"] * d
        out["bg_above"] += g * d * above
        out["fg_above"] += x["E"] * d * above
        out["t"] += d
        out["t_above"] += d * above
        out["o_slow"] += x["O"] * d * S(Bn)
        out["o"] += x["O"] * d
    left = sum(q[1] for q in queue)
    dl = sorted(out["delays"])
    tot = sum(w for _, w in dl)

    def wq(p):
        acc = 0.0
        for m, w in dl:
            acc += w
            if acc >= p * tot:
                return round(m)
        return 0

    sq = out["bg"] + out["fg"]
    return {"policy": policy if param is None else f"{policy} {param:g}",
            "squealCoreShareAboveKnee": round(100 * (out["bg_above"] + out["fg_above"]) / sq, 1),
            "bgCoreShareAboveKnee": round(100 * out["bg_above"] / out["bg"], 1),
            "hostTimeAboveKnee": round(100 * out["t_above"] / out["t"], 1),
            "bgCoreShareAbove18_20": [round(100 * out["bg_above18"] / out["bg"], 1), round(100 * out["bg_above20"] / out["bg"], 1)],
            "hostTimeAbove18_20": [round(100 * out["t_above18"] / out["t"], 1), round(100 * out["t_above20"] / out["t"], 1)],
            "bgMeanSlowdown": round(out["bg"] / out["bg_iso"], 3),
            "bgCoreHours": round(out["bg"] / 3600, 1), "bgIsolatedHoursDone": round(out["bg_iso"] / 3600, 1),
            "deferredPct": round(100 * out["deferred"] / out["arrived"], 1),
            "delayMinOfDeferred_p50_p95_max": [wq(.5), wq(.95), round(dl[-1][0]) if dl else 0],
            "queuedAtEndIsoHours": round(left / 3600, 2),
            "othersMeanSlowdown": round(out["o_slow"] / out["o"], 3)}


print(json.dumps({"baseAlone_timeAbove16_18_20": [round(100 * sum(x["dur"] for x in samples if x["O"] + x["E"] >= k) / sum(x["dur"] for x in samples), 1) for k in (16, 18, 20)],
                  "baseAloneAbove14": round(100 * sum(x["dur"] for x in samples if x["O"] + x["E"] >= 14) / sum(x["dur"] for x in samples), 1)}))
print(json.dumps({"loadPerCpuByBusy": [(b, round(v, 2)) for b, v in LOADC]}))
print(json.dumps({"samples": len(samples), "coresPerWorker_p25_p50_p75": [round(quant(cores_per_worker, p), 2) for p in (.25, .5, .75)],
                  "bgCoreHoursRecorded": round(sum(x["G"] * x["dur"] for x in samples) / 3600, 1),
                  "fgCoreHoursRecorded": round(sum(x["E"] * x["dur"] for x in samples) / 3600, 1),
                  "othersMeanCores": round(sum(x["O"] for x in samples) / len(samples), 1)}))
MIN = float(os.environ.get("REPLAY_MIN", MIN))
for pol, p in [("today", None), ("gate", 23), ("gate", 12), ("gate", 16), ("ideal", 1.15), ("ideal", 1.25), ("ideal", 1.4),
               ("aimd", 1.25), ("aimd2", 1.2), ("aimd2", 1.25), ("aimd2", 1.3), ("aimd2", 1.4)] + \
              ([("load", 0.75), ("load", 1.0), ("load", 1.25)] if LOADC else []):
    print(json.dumps(run(pol, p)))
