"""Q4 of daemon-model (throwaway): what a host-wide CPU budget would have deferred in one week, and what it would
have done to edit-tier wall time. Read only: runs.jsonl (011 probes/load-slowdown/extract-runs.mjs over store copies)
and sar-u.csv (`sadf -d -U saDD -- -u`). Starts nothing.

Usage: python3 -I budget.py RUNS SAR SINCE_ISO UNTIL_ISO CEILING [EXCLUDE_ROOT_PART]

Model (inferred, stated in the findings):
- Kinds as 011 load-slowdown: checkpoint runs are `baseline` or `run-all`; a run with no checkpoint is `edit` when it
  is the first run of its worktree and revision and picks at most 4 files, else `backlog`.
- A run's demand is its mean files at once (module seconds over wall), as load.py.
- Per 10-minute sar sample: busy B (all but idle), Squeal's CPU N (%nice: Squeal's test processes run nice 10).
  Background CPU = N x bg / (bg + edit), with bg and edit the summed demand of each kind over the sample.
- Budget: background work may use the host only up to CEILING busy vCPUs. Deferred CPU in a sample is
  min(background CPU, max(0, B - CEILING)). Deferred core-seconds join a FIFO and run in later samples with headroom
  CEILING - B (after the sample's own background work). Work still queued at the end is reported.
- Edit tiers: wall x slowdown(B') / slowdown(B), B' = B - deferred + absorbed, with 011's 2-vCPU fixed-effects curve.
"""
import bisect, collections, datetime as dt, json, sys

CPUS = 24
CURVE = [(1, 1.0), (3, 1.005), (5, 1.066), (7, 1.092), (9, 1.092), (11, 1.13), (13, 1.139), (15, 1.196), (17, 1.276),
         (19, 1.422), (21, 1.692), (23, 2.488)]


def S(b):
    if b <= CURVE[0][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if b <= x1:
            return y0 + (y1 - y0) * (b - x0) / (x1 - x0)
    return CURVE[-1][1]


def iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


runs_path, sar_path, since, until, ceiling = sys.argv[1], sys.argv[2], iso(sys.argv[3]), iso(sys.argv[4]), float(sys.argv[5])
exclude = sys.argv[6] if len(sys.argv) > 6 else None

samples = []
for line in open(sar_path):
    x = line.strip().split(";")
    if len(x) < 10 or "RESTART" in line:
        continue
    iv, ts = int(x[1]), int(x[2])
    if not (since <= ts - iv and ts <= until):
        continue
    nice, idle = float(x[5]), float(x[9])
    samples.append([ts - iv, ts, CPUS * (100 - idle) / 100, CPUS * nice / 100])
samples.sort()
starts = [s[0] for s in samples]

seen = set()
runs = []
for line in open(runs_path):
    r = json.loads(line)
    if exclude and r["root"] and exclude in r["root"]:
        continue
    if r["end"] <= r["start"]:
        continue
    k = (r["wt"], r["revision"])
    kind = r["cp"] or ("edit" if k not in seen and r["picked"] <= 4 else "backlog")
    if not r["cp"]:
        seen.add(k)
    wall = (r["end"] - r["start"]) / 1000
    fsum = sum(d for _, d in r["files"]) / 1000
    par = max(1.0, min(float(r["picked"]), fsum / wall)) if wall > 0 else 1.0
    runs.append((r["start"] / 1000, r["end"] / 1000, par, "edit" if kind == "edit" else "bg", wall, r["project"]))

# Demand per sample by kind (core-seconds / sample length = mean workers).
dem = [collections.Counter() for _ in samples]
for s, e, par, kind, wall, proj in runs:
    i = max(0, bisect.bisect_right(starts, s) - 1)
    while i < len(samples) and samples[i][0] < e:
        a, b = max(s, samples[i][0]), min(e, samples[i][1])
        if b > a:
            dem[i][kind] += par * (b - a) / (samples[i][1] - samples[i][0])
        i += 1

queue = collections.deque()  # [core-seconds, enqueued_at]
tot = collections.Counter()
delays = []  # (core-seconds, delay s)
newB = []
for i, (a, b, B, N) in enumerate(samples):
    L = b - a
    bg, ed = dem[i]["bg"], dem[i]["edit"]
    bgcpu = N * bg / (bg + ed) if bg + ed > 0 else 0.0
    defer = min(bgcpu, max(0.0, B - ceiling))
    tot["bg"] += bgcpu * L
    tot["defer"] += defer * L
    tot["samples"] += 1
    tot["above"] += B > ceiling
    tot["above_bg"] += defer > 0
    room = max(0.0, ceiling - (B - defer)) * L
    absorbed = 0.0
    while queue and room > 0:
        cs, t = queue[0]
        take = min(cs, room)
        delays.append((take, a + L / 2 - t))
        absorbed += take
        room -= take
        if take == cs:
            queue.popleft()
        else:
            queue[0][0] -= take
    if defer > 0:
        queue.append([defer * L, a + L / 2])
    tot["absorbed"] += absorbed
    newB.append(B - defer + absorbed / L)
left = sum(q[0] for q in queue)

# Edit tiers' wall before and after.
ed_before = ed_after = 0.0
per = []
for s, e, par, kind, wall, proj in runs:
    if kind != "edit" or s < since or e > until:
        continue
    m = s + wall / 2
    i = bisect.bisect_right(starts, m) - 1
    if i < 0 or not (samples[i][0] <= m <= samples[i][1]):
        continue
    f = S(newB[i]) / S(samples[i][2])
    ed_before += wall
    ed_after += wall * f
    per.append((samples[i][2] > ceiling, wall, wall * f))


def q(a, p):
    a = sorted(a)
    return a[int(p * (len(a) - 1))] if a else None


tot_d = sum(c for c, _ in delays)
wdelay = sorted(delays, key=lambda x: x[1])
acc, med_delay, p90_delay = 0.0, None, None
for c, dl in wdelay:
    acc += c
    if med_delay is None and acc >= tot_d / 2:
        med_delay = dl
    if p90_delay is None and acc >= tot_d * 0.9:
        p90_delay = dl
days = (until - since) / 86400
above = [x for x in per if x[0]]
print(json.dumps({
    "days": round(days, 2), "samples": tot["samples"], "ceiling": ceiling,
    "samplesAboveCeiling": tot["above"], "samplesDeferring": tot["above_bg"],
    "bgCoreHours": round(tot["bg"] / 3600, 1), "deferredCoreHours": round(tot["defer"] / 3600, 1),
    "deferredShareOfBg": round(tot["defer"] / tot["bg"], 3) if tot["bg"] else None,
    "absorbedCoreHours": round(tot["absorbed"] / 3600, 1), "stillQueuedAtEndCoreHours": round(left / 3600, 1),
    "delayMedianMin": round(med_delay / 60, 1) if med_delay is not None else None,
    "delayP90Min": round(p90_delay / 60, 1) if p90_delay is not None else None,
    "editTiers": len(per), "editWallH": round(ed_before / 3600, 2), "editWallAfterH": round(ed_after / 3600, 2),
    "editTiersAboveCeiling": len(above),
    "editAboveMedianWallS": round(q([w for _, w, _ in above], .5) or 0, 2),
    "editAboveMedianAfterS": round(q([w2 for _, _, w2 in above], .5) or 0, 2),
}, indent=1))
