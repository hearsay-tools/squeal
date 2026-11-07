"""Q2/Q3: for timed-out waits that name a tier ahead or in flight, the tier's size, how long it had run when the wait
began, and the reason Squeal gave when it does not yield. Throwaway. Usage: python3 -I ahead.py WAITS.jsonl CLS.jsonl"""
import json, re, sys, os, collections
from datetime import datetime, timezone, timedelta
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "load-slowdown"))
from load import med, quant  # noqa: E402

W = {(w["session"], w["start"]): w for w in map(json.loads, open(sys.argv[1]))}
DL = re.compile(r"the deadline passed after [\d.]+ s: (.*?)(?:\. Worktree:|\n|$)", re.S)
TIER = re.compile(r"(behind|in|waits for the run in flight \() the (\S+) tier of (\d+) test files? running since (\d\d:\d\d:\d\d)")
NOY = re.compile(r"the tier does not yield: ([^;,.]+)")
out = collections.defaultdict(list)
reasons = collections.Counter()
yields = collections.Counter()
for line in open(sys.argv[2]):
    c = json.loads(line)
    if not c["timedOut"] or c["primary"] not in ("behind", "unlisted", "running", "ended"):
        continue
    w = W[(c["session"], c["start"])]
    m = DL.search(w["out"])
    s = m.group(1)
    st = datetime.fromisoformat(c["start"])
    # Wall clock in the output is the daemon host's local time (Europe/Warsaw, UTC+1 in this window).
    loc = st + timedelta(hours=1)
    for kind, lane, n, since in TIER.findall(s):
        if (kind == "behind") != (c["primary"] == "behind") and c["primary"] in ("behind",):
            continue
        h, mi, se = map(int, since.split(":"))
        t0 = loc.replace(hour=h, minute=mi, second=se, microsecond=0)
        if t0 > loc + timedelta(minutes=5):
            t0 -= timedelta(days=1)
        out[c["primary"]].append((int(n), (loc - t0).total_seconds()))
        break
    r = NOY.search(s)
    reasons[(c["primary"], r.group(1).strip()[:70] if r else ("yields" if "the tier yields" in s else "none stated"))] += 1
for k, v in out.items():
    ns = [a for a, _ in v]; ages = [b for _, b in v]
    print(f"{k}: n {len(v)} | tier size median {med(ns)} p75 {quant(ns, .75)} share>=20 {sum(a >= 20 for a in ns) / len(ns):.0%} | started after the wait began: median {-med(ages):.0f} s p25 {-quant(ages, .75):.0f} p75 {-quant(ages, .25):.0f}")
print("\nyield statement in the deadline sentence (class, statement): count")
for (k, r), n in sorted(reasons.items(), key=lambda x: -x[1])[:16]:
    print(n, k, "|", r)
