"""Throwaway (row 021-06): replay one week of recorded load as a queue, under no budget, the adaptive budget of
011 background-backoff.md, and fixed busy-vCPU ceilings (reference points only). Read only; starts nothing.

Usage: python3 -I replay.py RUNS2.jsonl SAR-U.csv EPS.json REMOVALS.jsonl AGENT-CLS.jsonl SINCE UNTIL EXCLUDE \
           [POLICY ...]   POLICY: none | fixed:<busy> | aimd:<theta> | ideal:<theta>; env SEED, KNEE, CURVE=hw|wall

Model (inferred; the findings file states it):
- Time runs in 60 s steps inside the 10-minute sar samples. A sample gives busy B and Squeal's CPU N (%nice: Squeal's
  test processes run at nice 10). O = B - N is everything else (agents, their own tests, builds, daemons), held as
  recorded. N splits into background G and foreground E by the runs' worker-seconds in the sample (011 rule:
  background = backlog + baselines; foreground = edit tiers + `run --all`).
- Each background run is one tier. Its core-seconds are its share of G; its work is those core-seconds over S(B) at
  the time (isolated core-seconds, S = 011 load-slowdown's 2-vCPU fixed-effects curve). Its rate is its core-seconds
  over its recorded wall: the cores it holds while it runs.
- Chains: a background tier that started at most CHAIN_S after an earlier background tier of its worktree ended is
  that tier's successor. It arrives when its predecessor finishes in the replay, plus the recorded gap. Other tiers
  arrive at their recorded start. 75% of background tiers start within 2 s of the previous one in their worktree.
- A running tier does rate * 60 / S(B') work a step, B' = O + E' + running background cores (at most 24; above 24
  every tier gets its share of the 24). E' = E * S(B') / S(B): edit work is fixed, its cores follow its speed.
- Admission, first in first out, at a tier's arrival and at every step: `none` admits at arrival with its recorded
  rate. A budget admits while there is room: a fixed ceiling C gives room C - O - E' - running; the adaptive budget
  gives room cap - running, with cap stepped once a step from a noisy reading S(B') * e (e drawn from EPS by busy
  band, times lognormal(0, 0.12), as background-backoff/replay.py): halve after two readings in a row above theta,
  else +1 core, between MIN and 23. A tier admitted with less room than its rate runs at the room it got (fewer
  workers); its rate stays fixed until it ends (011 background-backoff finding 6). The floor: while running
  background cores are under MIN, the oldest waiter is admitted at MIN.
- Work that need not run, checked at admission: a picked file is stale when a later run of the same worktree and
  file at a higher revision started (in the record) before the admission; the tier's work shrinks by those files'
  share of its module seconds, and a tier with no file left is dropped. A tier whose worktree Cezar removed before
  its admission is dropped. In `none` almost nothing is stale at admission, as recorded.
- Foreground edit tiers keep their start; their wall is the recorded wall * S(B')/S(B). Agents' own foreground test
  runs (transcripts) likewise: load the budget cannot defer.
- CPU: cores held * time. With CURVE=hw the CPU cost per unit of work is S(min(B', 19)): the part of the slowdown that
  is shared hardware, not run-queue waiting (011 load-slowdown finding 3's low bound); walls still use S.
"""
import bisect, collections, hashlib, json, math, os, random, sys
from datetime import datetime

CPUS, STEP, CEIL_SLOTS = 24.0, 60.0, 23.0
MIN = float(os.environ.get("REPLAY_MIN", 2.0))
CHAIN_S = float(os.environ.get("CHAIN_S", 5.0))
KNEE = float(os.environ.get("KNEE", 16))
OWORK = os.environ.get("OWORK") == "1"
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


def Scpu(b):
    return S(min(b, 19.0)) if os.environ.get("CURVE") == "hw" else S(b)


def iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def q(a, p):
    a = sorted(a)
    return a[min(len(a) - 1, int(p * (len(a) - 1) + 0.5))] if a else None


runs_path, sar_path, eps_path, rem_path, agent_path, since, until, exclude = sys.argv[1:9]
POLICIES = sys.argv[9:] or ["none", "aimd:1.25", "fixed:20", "fixed:18", "fixed:16", "fixed:14"]
T0, T1 = iso(since), iso(until)

# --- sar samples
samples = []
for line in open(sar_path):
    x = line.strip().split(";")
    if len(x) < 10 or "RESTART" in line:
        continue
    iv, ts = int(x[1]), int(x[2])
    if ts - iv < T0 - 1 or ts > T1 + 1:
        continue
    samples.append({"a": ts - iv, "b": ts, "B": CPUS * (100 - float(x[9])) / 100, "N": CPUS * float(x[5]) / 100})
samples.sort(key=lambda s: s["a"])
starts = [s["a"] for s in samples]


def sample_at(t):
    i = bisect.bisect_right(starts, t) - 1
    return i if 0 <= i < len(samples) and t <= samples[i]["b"] else None


# --- runs
runs = []
for line in open(runs_path):
    r = json.loads(line)
    if exclude and r["root"] and exclude in r["root"]:
        continue
    if r["end"] <= r["start"] or not (T0 * 1000 <= r["start"] < T1 * 1000):
        continue
    r["s"], r["e"] = r["start"] / 1000, min(r["end"] / 1000, T1)
    r["wall"] = r["e"] - r["s"]
    fsum = sum(d for _, d in r["files"]) / 1000
    r["par"] = max(1.0, min(float(len(r["picked"]) or 1), fsum / r["wall"])) if r["wall"] > 0 else 1.0
    runs.append(r)
runs.sort(key=lambda r: r["s"])
seen = set()
for r in runs:
    k = (r["project"], r["wt"], r["revision"])
    kind = r["cp"] or ("edit" if k not in seen and len(r["picked"]) <= 4 else "backlog")
    seen.add(k)
    r["kind"] = kind
    r["bg"] = kind in ("backlog", "baseline")

# worker-seconds per sample by class, and each background run's core-seconds and isolated work
wbg = collections.defaultdict(float)
wfg = collections.defaultdict(float)
for r in runs:
    i = sample_at(r["s"]) or 0
    r["pieces"] = []
    while i < len(samples) and samples[i]["a"] < r["e"]:
        a, b = max(r["s"], samples[i]["a"]), min(r["e"], samples[i]["b"])
        if b > a:
            ws = r["par"] * (b - a)
            (wbg if r["bg"] else wfg)[i] += ws
            r["pieces"].append((i, ws))
        i += 1
for i, s in enumerate(samples):
    w = wbg[i] + wfg[i]
    s["G"] = s["N"] * wbg[i] / w if w > 0 else 0.0
    s["E"] = s["N"] - s["G"] if w > 0 else 0.0
    s["O"] = s["B"] - s["N"]
for r in runs:
    cs = work = 0.0
    for i, ws in r["pieces"]:
        tot = wbg[i] if r["bg"] else wfg[i]
        L = samples[i]["b"] - samples[i]["a"]
        c = (samples[i]["G"] if r["bg"] else samples[i]["E"]) * L * ws / tot if tot > 0 else 0.0
        cs += c
        work += c / S(samples[i]["B"])
    r["cs"], r["work"] = cs, work
    r["rate"] = cs / r["wall"] if r["wall"] > 0 else 0.0

bgruns = [r for r in runs if r["bg"] and r["work"] > 0]
fgruns = [r for r in runs if not r["bg"]]
# chains within a worktree
last_end = {}
for r in sorted(bgruns, key=lambda r: r["s"]):
    w = (r["project"], r["wt"])
    p = last_end.get(w)
    r["pred"] = p if p is not None and 0 <= r["s"] - p["e"] <= CHAIN_S and "succ" not in p else None
    if r["pred"] is not None:
        r["pred"]["succ"] = r
        r["gap"] = r["s"] - r["pred"]["e"]
    if p is None or r["e"] >= p["e"]:
        last_end[w] = r
# stale index: (project, wt, file) -> sorted [(start, revision)]
later = collections.defaultdict(list)
for r in runs:
    for f in r["picked"]:
        later[(r["project"], r["wt"], f)].append((r["s"], r["revision"]))
for v in later.values():
    v.sort()
removed = {}
for line in open(rem_path):
    x = json.loads(line)
    if x["removedAt"]:
        removed[x["wt"]] = min(removed.get(x["wt"], 1e18), x["removedAt"] / 1000)

eps = {int(float(k)): v for k, v in json.load(open(eps_path)).items()}
BANDS = [0, 6, 12, 16, 20, 24.01]
res = collections.defaultdict(list)
for s in samples:
    e = eps.get(s["b"])
    if e and e.get("signal") is not None:
        res[next(k for k in range(5) if s["B"] < BANDS[k + 1])].append(e["eps"])


def noise(b):
    k = next((k for k in range(5) if b < BANDS[k + 1]), 4)
    return random.choice(res.get(k) or [1.0]) * random.lognormvariate(0, 0.12)


agents = []
for line in open(agent_path):
    x = json.loads(line)
    if x.get("background") or not x.get("wallS") or x.get("task") == exclude:
        continue
    s = iso(x["start"])
    if T0 <= s and s + float(x["wallS"]) <= T1:
        agents.append((s, s + float(x["wallS"])))


def stale_share(r, t):
    """Share of r's module seconds whose file a later revision of its worktree re-picked by time t."""
    durs = dict(r["files"])
    tot = sum(durs.values()) or len(r["picked"])
    st = 0.0
    for f in r["picked"]:
        v = later[(r["project"], r["wt"], f)]
        j = bisect.bisect_right(v, (r["s"], float("inf")))
        if any(rv > r["revision"] and ts <= t for ts, rv in v[j:j + 50]):
            st += durs.get(f, 0) if durs else 1
    return min(1.0, st / tot) if tot else 0.0


def replay(policy):
    random.seed(int(os.environ.get("SEED", 1)))
    kind, _, par = policy.partition(":")
    par = float(par) if par else None
    nsteps = int(math.ceil((T1 - T0) / STEP))
    heads = sorted((r for r in bgruns if r["pred"] is None), key=lambda r: r["s"])
    arrivals = [(r["s"], r["id"], r) for r in heads]  # heap of (time, id, run)
    import heapq
    heapq.heapify(arrivals)
    waiting = collections.deque()
    running = []  # [run, rate, work left]
    out = collections.Counter()
    fin = {}
    adm = {}
    Bstep = []
    cap, over = CEIL_SLOTS, 0
    dropped = collections.Counter()

    def done(r, t):
        fin[r["id"]] = t
        n = r.get("succ")
        if n is not None:
            heapq.heappush(arrivals, (t + n["gap"], n["id"], n))

    def admit(tau, s, base, bgcores):
        """Admit waiting tiers at time tau; returns the new running background cores."""
        while waiting:
            r = waiting[0]
            if kind == "none":
                room = r["rate"]
            elif kind == "fixed":
                room = par - base - bgcores
            elif kind == "ideal":
                room = 0.0
                while S(base + bgcores + room + 0.1) * (eps.get(s["b"], {}).get("eps") or 1.0) <= par and room < CPUS:
                    room += 0.1
            else:
                room = cap - bgcores
            if room < min(r["rate"], 0.5) and bgcores >= MIN:
                break
            waiting.popleft()
            if r["wt"] in removed and r["s"] <= removed[r["wt"]] < tau:
                dropped["removed"] += r["work"]
                done(r, tau)
                continue
            st = stale_share(r, tau) if kind != "none" else 0.0
            if st >= 0.999:
                dropped["stale"] += r["work"]
                done(r, tau)
                continue
            dropped["stale"] += r["work"] * st
            rate = r["rate"] if kind == "none" else max(min(r["rate"], room), min(r["rate"], MIN) if bgcores < MIN else 0.05)
            adm[r["id"]] = tau
            running.append([r, rate, r["work"] * (1 - st)])
            bgcores += rate
        return bgcores

    for k in range(nsteps):
        t = T0 + k * STEP
        i = sample_at(t + STEP / 2)
        if i is None:
            Bstep.append(None)
            continue
        s = samples[i]
        base = s["O"] + s["E"]
        if kind == "aimd":
            bgc = sum(x[1] for x in running)
            sig = S(min(CPUS, base + bgc)) * noise(base + bgc)
            over = over + 1 if sig > par else 0
            if over >= 2:
                cap, over = max(MIN, cap / 2), 0
            elif sig <= par:
                cap = min(CEIL_SLOTS, cap + 1)
        tau, Bsum = t, 0.0
        fprev = 1.0
        while tau < t + STEP - 1e-9:
            Oc = s["O"] * (fprev if OWORK else 1.0)
            base = Oc + s["E"] * fprev
            while arrivals and arrivals[0][0] <= tau + 1e-9:
                ta0, _id, r = heapq.heappop(arrivals)
                r["arr"] = max(ta0, T0)
                waiting.append(r)
            bgcores = admit(tau, s, base, sum(x[1] for x in running))
            Bp = base + bgcores
            for _ in range(4):
                f = S(min(CPUS, Bp)) / S(s["B"])
                Ep, Oc = s["E"] * f, s["O"] * (f if OWORK else 1.0)
                Bp = Oc + Ep + bgcores
            fprev = f
            share = min(1.0, max(0.0, CPUS - Oc - Ep) / bgcores) if bgcores > 0 and Bp > CPUS else 1.0
            Bc = min(CPUS, Bp)
            sp = S(Bc)
            nxt_t = t + STEP
            if arrivals:
                nxt_t = min(nxt_t, max(arrivals[0][0], tau + 1e-3))
            for r, rate, left in running:
                got = rate * share
                if got > 0:
                    nxt_t = min(nxt_t, tau + left * sp / got)
            nxt_t = max(nxt_t, tau + 1e-3)
            dt = nxt_t - tau
            keep = []
            for x in running:
                r, rate, left = x
                can = rate * share * dt / sp
                if can >= left - 1e-9:
                    out["bgcpu"] += left * Scpu(Bc)
                    out["bgwork"] += left
                    done(r, nxt_t)
                else:
                    x[2] -= can
                    out["bgcpu"] += can * Scpu(Bc)
                    out["bgwork"] += can
                    keep.append(x)
            running[:] = keep
            out["fgcpu"] += s["E"] * dt / S(s["B"]) * Scpu(Bc)
            out["ocpu_slow"] += s["O"] * dt * S(Bc) / (S(s["B"]) if OWORK else 1.0)
            out["ocpu"] += s["O"] * dt / (S(s["B"]) if OWORK else 1.0)
            out["ocores"] += Oc * dt
            out["t"] += dt
            for c in (16, 18, 20):
                out[f"t{c}"] += dt * (Bc > c)
            out["bgcore_above_knee"] += dt * bgcores * (Bc > KNEE)
            out["bgcore"] += dt * bgcores
            Bsum += Bc * dt
            tau = nxt_t
        Bstep.append(Bsum / STEP)
    left = sum(x[2] for x in running) + sum(r["work"] for r in waiting) + sum(r["work"] for _, _, r in arrivals)

    def B_at(t):
        k = int((t - T0) // STEP)
        return Bstep[k] if 0 <= k < len(Bstep) and Bstep[k] is not None else None

    def scale(s0, e0):
        """New wall of an interval recorded at [s0, e0): sum over its steps of dt * S(B')/S(B)."""
        w, t = 0.0, s0
        while t < e0:
            t2 = min(e0, (math.floor((t - T0) / STEP) + 1) * STEP + T0)
            i = sample_at(t)
            bp = B_at(t)
            w += (t2 - t) * (S(bp) / S(samples[i]["B"]) if i is not None and bp is not None else 1.0)
            t = t2
        return w

    # background: per tier (finish - arrival) and per chain (last finish - head arrival)
    tier_t, chain_t, chain_w = [], [], []
    for r in bgruns:
        if r["id"] in fin and "arr" in r:
            tier_t.append(fin[r["id"]] - r["arr"])
        if r["pred"] is None:
            x, last, ok = r, None, True
            while x is not None:
                if x["id"] not in fin:
                    ok = False
                    break
                last, x = fin[x["id"]], x.get("succ")
            if ok:
                chain_t.append(last - r["s"])
                w, x = 0.0, r
                while x is not None:
                    w, x = w + x["work"], x.get("succ")
                chain_w.append((last - r["s"], w))
    def band_of(t):
        i = sample_at(t)
        b = samples[i]["B"] if i is not None else 0
        return "<=16" if b <= 16 else ("16-20" if b <= 20 else ">20")
    tier_band = collections.defaultdict(list)
    chain_band = collections.defaultdict(list)
    for r in bgruns:
        if r["id"] in fin and "arr" in r:
            tier_band[band_of(r["s"])].append(fin[r["id"]] - r["arr"])
    for r in bgruns:
        if r["pred"] is None:
            x, last = r, None
            while x is not None and x["id"] in fin:
                last, x = fin[x["id"]], x.get("succ")
            if x is None and last is not None:
                chain_band[band_of(r["s"])].append(last - r["s"])
    wait = [adm[r["id"]] - r["arr"] for r in bgruns if r["id"] in adm]
    edit = [(r["wall"], scale(r["s"], r["e"])) for r in fgruns if r["kind"] == "edit"]
    ag = [(e - s, scale(s, e)) for s, e in agents]
    chain_w.sort()
    tw = sum(w for _, w in chain_w)
    acc, cw50, cw90 = 0.0, None, None
    for d, w in chain_w:
        acc += w
        if cw50 is None and acc >= tw / 2:
            cw50 = d
        if cw90 is None and acc >= 0.9 * tw:
            cw90 = d
    H = 3600
    return {
        "policy": policy + (" hw" if os.environ.get("CURVE") == "hw" else "") + (" owork" if OWORK else "") + (f" min{MIN:g}" if MIN != 2 else "") + (f" chain{CHAIN_S:g}" if CHAIN_S != 5 else ""),
        "deferredWorkH": round(sum(r["work"] for r in bgruns if r["id"] in adm and adm[r["id"]] - r["arr"] > 1) / H, 1),
        "othersCoreH": round(out["ocores"] / H, 1),
        "bgArrivedWorkH": round(sum(r["work"] for r in bgruns) / H, 1),
        "bgCpuH": round(out["bgcpu"] / H, 1), "bgWorkDoneH": round(out["bgwork"] / H, 1),
        "droppedStaleH": round(dropped["stale"] / H, 1), "droppedRemovedH": round(dropped["removed"] / H, 1),
        "leftAtEndH": round(left / H, 2), "fgCpuH": round(out["fgcpu"] / H, 1),
        "squealCpuH": round((out["bgcpu"] + out["fgcpu"]) / H, 1),
        "othersSlowdown": round(out["ocpu_slow"] / out["ocpu"], 3),
        "hostTimeAbove16_18_20": [round(100 * out[f"t{c}"] / out["t"], 1) for c in (16, 18, 20)],
        "bgCoreShareAboveKnee": round(100 * out["bgcore_above_knee"] / out["bgcore"], 1) if out["bgcore"] else None,
        "tierWaitS_p50_p90": [round(q(wait, .5), 1), round(q(wait, .9), 1)],
        "tierFinishS_p50_p90_p99": [round(q(tier_t, p), 1) for p in (.5, .9, .99)],
        "chains": len(chain_t), "chainFinishMin_p50_p90": [round(q(chain_t, p) / 60, 1) for p in (.5, .9)],
        "chainFinishMinWorkWeighted_p50_p90": [round((cw50 or 0) / 60, 1), round((cw90 or 0) / 60, 1)],
        "tierFinishS_byArrivalBand_p50_p90": {k: [round(q(v, .5), 1), round(q(v, .9), 1), len(v)] for k, v in sorted(tier_band.items())},
        "chainFinishMin_byHeadBand_p50_p90": {k: [round(q(v, .5) / 60, 2), round(q(v, .9) / 60, 1), len(v)] for k, v in sorted(chain_band.items())},
        "editTiers": len(edit), "editWallH": [round(sum(a for a, _ in edit) / H, 2), round(sum(b for _, b in edit) / H, 2)],
        "editWallS_p50_p90": [round(q([b for _, b in edit], p), 2) for p in (.5, .9)],
        "agentRuns": len(ag), "agentWallH": [round(sum(a for a, _ in ag) / H, 2), round(sum(b for _, b in ag) / H, 2)],
    }


if __name__ == "__main__":
    print(json.dumps({"window_days": round((T1 - T0) / 86400, 2), "samples": len(samples),
                      "bgRuns": len(bgruns), "chained": sum(1 for r in bgruns if r["pred"] is not None),
                      "fgRuns": len(fgruns), "edit": sum(1 for r in fgruns if r["kind"] == "edit"),
                      "recorded_bgCoreH": round(sum(s["G"] * (s["b"] - s["a"]) for s in samples) / 3600, 1),
                      "recorded_fgCoreH": round(sum(s["E"] * (s["b"] - s["a"]) for s in samples) / 3600, 1),
                      "recorded_hostAbove16_18_20": [round(100 * sum(1 for s in samples if s["B"] > c) / len(samples), 1) for c in (16, 18, 20)],
                      "agentRuns": len(agents)}))
    for p in POLICIES:
        print(json.dumps(replay(p)), flush=True)
