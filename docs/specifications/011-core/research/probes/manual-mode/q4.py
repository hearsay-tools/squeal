"""Q1 (messages per session) and Q4 (edits and failures in manual periods) from sessions.py and manual.py. Throwaway.

Usage: python3 -I q4.py SESSIONS.jsonl PERIODS.json POLICY...

- Working session: at least 10 tool calls in the window. Its active days: UTC days with an event.
- Message pair: a manual period during which the session has an event (its next hook carries "manual"; the resume
  message follows). Pairs per session-day = periods with an event of the session that started that day. Long
  session-days: the session's first and last event that UTC day are at least 4 h apart.
- Edited file in a manual period: (session, turn, path) for code edits made while manual. Classes, by what comes first
  after the edit: `asked` (an ask that covers it: a wait or run with no path or --all, or naming the path or a folder
  above it), `stop` (the turn's Stop hook: the stop check would run it), `resumed` (the period ends first: automatic
  mode picks it up), `none` (no ask, Stop or period end in the window). `askedLoose` counts any ask after the edit.
- A failure: a SQUEAL hook message with FAIL lines at t_d whose last code edit before it (within 30 min, same
  session) t_e fell in a manual period. Today it was found at t_d. In manual mode it is found at
  min(covering ask, Stop, period end) after t_e, plus the same run lag t_d - t_e. A covering ask has no path, --all,
  or names the failing file or a file the session edited in that turn. Delay = max(0, manual - t_d).
  Most failure messages follow no edit the transcripts show (Codex edits through the shell): for those t_e is
  t_d - LAG, LAG = 80 s, the median lag of the failures that follow a visible edit; they are counted apart (`est`).
"""
import bisect, collections, json, sys
from datetime import datetime, timezone


def quant(a, p):
    a = sorted(a)
    if not a:
        return None
    k = p * (len(a) - 1)
    lo = int(k)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (k - lo)


sess = [json.loads(l) for l in open(sys.argv[1])]
allp = json.load(open(sys.argv[2]))
work = [s for s in sess if sum(e[1] in ("act", "ask", "edit") for e in s["events"]) >= 10]


def rel(path, root):
    p = path[len(root) + 1:] if path.startswith(root + "/") else path
    return p[2:] if p.startswith("./") else p


def covers(ask, paths, root):
    if ask["all"]:
        return True
    for a in ask["paths"]:
        a = rel(a, root).rstrip("/")
        for p in paths:
            if p == a or p.startswith(a + "/"):
                return True
    return False


for pol in sys.argv[3:]:
    periods = [(p[0], p[1]) for p in allp[pol]]
    starts = [p[0] for p in periods]

    def period_of(t):
        i = bisect.bisect_right(starts, t) - 1
        return periods[i] if i >= 0 and periods[i][0] <= t < periods[i][1] else None

    # Messages
    per_day, long_day = [], []
    for s in work:
        ts = [e[0] for e in s["events"]]
        days = collections.Counter()
        active_days = {datetime.fromtimestamp(t, timezone.utc).date() for t in ts}
        for a, b in periods:
            i = bisect.bisect_left(ts, a)
            if i < len(ts) and ts[i] < b:
                days[datetime.fromtimestamp(a, timezone.utc).date()] += 1
        span = collections.defaultdict(list)
        for t in ts:
            span[datetime.fromtimestamp(t, timezone.utc).date()].append(t)
        for d in active_days:
            per_day.append(days.get(d, 0))
            if max(span[d]) - min(span[d]) >= 4 * 3600:
                long_day.append(days.get(d, 0))
    # Edits and failures
    cls = collections.Counter()
    loose = 0
    wait_to = collections.defaultdict(list)
    fails, fail_cls = [], collections.Counter()
    fails_est, est_cls = [], collections.Counter()
    seen = set()
    for s in work:
        ev, root = s["events"], s["root"]
        turn, turn_start = 0, 0
        turn_of = []
        for e in ev:
            if e[1] == "prompt":
                turn += 1
            turn_of.append(turn)
        for k, e in enumerate(ev):
            if e[1] != "edit":
                continue
            P = period_of(e[0])
            if not P:
                continue
            path = rel(e[2], root)
            key = (s["session"], turn_of[k], path)
            if key in seen:
                continue
            seen.add(key)
            t_ask = t_any = t_stop = None
            for f in ev[k + 1:]:
                if f[1] == "ask":
                    t_any = t_any or f[0]
                    if t_ask is None and covers(f[2], [path], root):
                        t_ask = f[0]
                if f[1] == "stop":
                    t_stop = f[0]
                    break
                if t_ask is not None:
                    break
            cands = [(t_ask, "asked"), (t_stop, "stop"), (P[1] if P[1] < ev[-1][0] + 3600 else None, "resumed")]
            cands = [c for c in cands if c[0] is not None]
            c = min(cands)[1] if cands else "none"
            cls[c] += 1
            if c == "asked" or (t_any is not None and t_any < min([x[0] for x in cands] or [9e18])):
                loose += 1
            if cands:
                wait_to[c].append((min(cands)[0] - e[0]) / 60)
        edits = [(e[0], rel(e[2], root), turn_of[k]) for k, e in enumerate(ev) if e[1] == "edit"]
        et = [x[0] for x in edits]
        for k, e in enumerate(ev):
            if e[1] != "fail":
                continue
            i = bisect.bisect_left(et, e[0]) - 1
            est = i < 0 or e[0] - et[i] > 1800
            te = e[0] - 80 if est else et[i]
            P = period_of(te)
            if not P:
                continue
            lag = e[0] - te
            turn_paths = [rel(x, root) for x in e[2]] + ([] if est else [p for t, p, tn in edits if tn == edits[i][2] and t <= e[0]])
            t_ask = t_stop = None
            j = bisect.bisect_right([x[0] for x in ev], te)
            for f in ev[j:]:
                if f[1] == "ask" and covers(f[2], turn_paths, root):
                    t_ask = f[0]
                    break
                if f[1] == "stop":
                    t_stop = f[0]
                    break
            cands = [c for c in [(t_ask, "asked"), (t_stop, "stop"), (P[1], "resumed")] if c[0] is not None]
            tm, how = min(cands)
            (est_cls if est else fail_cls)[how] += 1
            (fails_est if est else fails).append(max(0.0, tm + lag - e[0]) / 60)
    n = sum(cls.values())
    print(json.dumps({"policy": pol, "workingSessions": len(work), "sessionDays": len(per_day),
                      "pairsPerSessionDay_mean_p50_p95_max": [round(sum(per_day) / len(per_day), 1), quant(per_day, .5), quant(per_day, .95), max(per_day)],
                      "longSessionDays": len(long_day),
                      "pairsPerLongSessionDay_mean_p50_p95_max": [round(sum(long_day) / len(long_day), 1), quant(long_day, .5), quant(long_day, .95), max(long_day)] if long_day else None,
                      "editedFilesInManual": n, "classes": dict(cls), "classPct": {k: round(100 * v / n, 1) for k, v in cls.items()},
                      "askedLoose": loose,
                      "minutesToFirst_p50_p95": {k: [round(quant(v, .5), 1), round(quant(v, .95), 1)] for k, v in wait_to.items()},
                      "failuresTriggeredInManual": len(fails), "failureFoundBy": dict(fail_cls),
                      "failuresLater": sum(1 for x in fails if x > 0.5),
                      "failureDelayMin_p50_p95_max": [round(quant(fails, .5), 1), round(quant(fails, .95), 1), round(max(fails), 1)] if fails else None,
                      "est_failures": len(fails_est), "est_foundBy": dict(est_cls), "est_later": sum(1 for x in fails_est if x > 0.5),
                      "est_delayMin_p50_p95_max": [round(quant(fails_est, .5), 1), round(quant(fails_est, .95), 1), round(max(fails_est), 1)] if fails_est else None}))
# Rates for reference, whole window
alle = sum(1 for s in work for e in s["events"] if e[1] == "edit")
allf = sum(1 for s in work for e in s["events"] if e[1] == "fail")
print(json.dumps({"codeEditsAll": alle, "failMessagesAll": allf,
                  "sessionsWithEdits": sum(1 for s in work if any(e[1] == "edit" for e in s["events"]))}))
