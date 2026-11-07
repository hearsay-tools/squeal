"""Q4: is load the cause of timed-out waits, or more edits? Throwaway, read only.
Usage: python3 -I edit-rate.py WAITS.jsonl CLS.jsonl EDITS.jsonl
Edit-rate measures per named 60 s wait (CLS from classify.py):
  before:  revisions per minute since the previous `squeal status --wait` output in the same worktree (any session,
           any limit), when that output is 1 to 30 min older and its revision is not higher (same daemon).
  edits5:  agents' edit tool calls in the worktree in the 5 min before the wait (edit-events.py; a lower bound).
Prints the timed-out share per load band inside each edit-rate stratum, and a logistic-free decomposition: the
band effect at a fixed stratum (direct standardisation to the pooled stratum mix).
"""
import json, re, sys, os, bisect, collections
from datetime import datetime
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "load-slowdown"))
from load import med  # noqa: E402

waits, clsp, editsp = sys.argv[1:4]
ROOT = re.compile(r"^(/home/agent/projects/[^/]+(?:/\.ai/cezar/worktrees/[^/]+)?)")
HDR = re.compile(r"^Revision: (\d+)", re.M)
EDG = ["0-6", "6-12", "12-16", "16-20", "20-24"]


def root(c):
    m = ROOT.match(c or "")
    return m.group(1) if m else None


# Reference points: every status --wait output with a header revision.
pts = collections.defaultdict(list)
for line in open(waits):
    w = json.loads(line)
    m = HDR.search(w["out"])
    r = root(w["cwd"])
    if m and r:
        pts[r].append((datetime.fromisoformat(w["start"]).timestamp(), int(m.group(1)), w["session"], w["start"]))
for r in pts:
    pts[r].sort()
ed = collections.defaultdict(list)
for line in open(editsp):
    e = json.loads(line)
    ed[e["root"]].append(e["t"])
for r in ed:
    ed[r].sort()
W = {(w["session"], w["start"]): w for w in map(json.loads, open(waits))}
rows = []
for line in open(clsp):
    c = json.loads(line)
    w = W.get((c["session"], c["start"]))
    r = root(c["cwd"])
    if not w or not r:
        continue
    t = datetime.fromisoformat(c["start"]).timestamp()
    h = HDR.search(w["out"])
    rs = int(h.group(1)) if h else None
    before = None
    if rs is not None:
        p = [x for x in pts[r] if 60 <= t - x[0] <= 1800 and x[1] <= rs]
        if p:
            x = p[-1]
            before = (rs - x[1]) / ((t - x[0]) / 60)
    lo = bisect.bisect_left(ed[r], t - 300)
    hi = bisect.bisect_left(ed[r], t)
    rows.append({**c, "before": before, "edits5": hi - lo})

print("named 60 s waits", len(rows), "| with 'before'", sum(r["before"] is not None for r in rows))


def table(key, strata, title):
    print(f"\n{title}: timed-out share (n) per band")
    print("stratum | " + " | ".join(EDG) + " | all")
    for name, f in strata:
        x = [r for r in rows if r[key] is not None and f(r[key])]
        cells = []
        for b in range(5):
            xb = [r for r in x if r["band"] == b]
            cells.append(f"{sum(r['timedOut'] for r in xb) / len(xb):.0%} ({len(xb)})" if xb else "-")
        print(name, "|", " | ".join(cells), "|", f"{sum(r['timedOut'] for r in x) / max(1, len(x)):.0%} ({len(x)})")


table("before", [("0/min", lambda v: v == 0), ("0-0.5/min", lambda v: 0 < v <= 0.5), ("0.5-2/min", lambda v: 0.5 < v <= 2), (">2/min", lambda v: v > 2)], "revisions per minute before the wait")
table("edits5", [("0", lambda v: v == 0), ("1-2", lambda v: 1 <= v <= 2), ("3+", lambda v: v >= 3)], "agent edit calls in the 5 min before")

print("\nedit rate by band (is busy also busier in edits?)")
for b in range(5):
    x = [r for r in rows if r["band"] == b]
    bf = [r["before"] for r in x if r["before"] is not None]
    print(EDG[b], "n", len(x), "| before: median", round(med(bf) or 0, 2), "mean", round(sum(bf) / max(1, len(bf)), 2), "(n", len(bf), ")",
          "| edits5 mean", round(sum(r["edits5"] for r in x) / max(1, len(x)), 2))

# Direct standardisation: the timed-out share per band if every band had the pooled mix of edit-rate strata.
# The gap between raw and standardised is the part of the band effect that the edit mix explains.
def standardise(key, S):
    x = [r for r in rows if r[key] is not None]
    mix = {n: sum(f(r[key]) for r in x) / len(x) for n, f in S}
    print(f"\nstandardised to the pooled '{key}' mix", {k: round(v, 2) for k, v in mix.items()}, "n", len(x))
    for b in range(5):
        raw = [r for r in x if r["band"] == b]
        tot = 0
        for n, f in S:
            xs = [r for r in raw if f(r[key])]
            tot += mix[n] * (sum(r["timedOut"] for r in xs) / len(xs) if xs else sum(r["timedOut"] for r in raw) / max(1, len(raw)))
        print(EDG[b], "raw", f"{sum(r['timedOut'] for r in raw) / max(1, len(raw)):.1%}", "standardised", f"{tot:.1%}", "n", len(raw))


standardise("edits5", [("0", lambda v: v == 0), ("1-2", lambda v: 1 <= v <= 2), ("3+", lambda v: v >= 3)])
standardise("before", [("0", lambda v: v == 0), ("0-0.5", lambda v: 0 < v <= 0.5), ("0.5-2", lambda v: 0.5 < v <= 2), (">2", lambda v: v > 2)])
json.dump(rows, open(os.environ.get("EDIT_RATE_OUT", "/dev/null"), "w"))
