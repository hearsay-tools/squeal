"""A rule "background work runs only while a session in its worktree is inside a turn; once every session's last
event is its Stop (the turn ended: the agent waits for a human, a parent or a timer), or no session has started,
background work waits for the next event" replayed on classify.py's records. Throwaway, read only.
Usage: python3 -I turn.py REC.jsonl SESSIONS [KNEE=16]
A session is inside a turn at t when its last event at or before t is not `stop`. Pi records no Stop, so a Pi session
counts as inside a turn for IDLE_MIN (env, default 30) minutes after its last event. AFTER_MIN (env, default 0):
a session also counts as inside a turn for that long after its Stop. Same outputs as curve.py."""
import bisect, collections, json, os, sys
KNEE = float(sys.argv[3]) if len(sys.argv) > 3 else 16
IDLE = float(os.environ.get("IDLE_MIN", "30")) * 60000
AFTER = float(os.environ.get("AFTER_MIN", "0")) * 60000  # held only once every turn ended AFTER_MIN ago
sess = collections.defaultdict(list)
for line in open(sys.argv[2]):
    s = json.loads(line)
    e = sorted((x[0] * 1000, x[1]) for x in s["events"])
    if e:
        sess[s["root"]].append((s["src"], [x[0] for x in e], [x[1] for x in e]))
def in_turn(root, t):
    for src, ts, ks in sess.get(root, []):
        i = bisect.bisect_right(ts, t)
        if i == 0:
            continue
        if src == "pi":
            if t - ts[i - 1] <= IDLE: return True
        elif ks[i - 1] != "stop" or t - ts[i - 1] <= AFTER:
            return True
    return False
recs = [json.loads(l) for l in open(sys.argv[1])]
recs = [r for r in recs if r["kind"] in ("baseline", "backlog")]
recs.sort(key=lambda r: r["s"])
prev = {}
for r in recs:
    k = (r["p"], r["wt"], r["f"])
    r["ff"] = bool(r["fails"]) and not prev.get(k, False)
    prev[k] = bool(r["fails"])
cache = {}
for r in recs:
    key = (r["root"], r["s"])
    if key not in cache:
        cache[key] = in_turn(r["root"], r["s"])
    r["held"] = not cache[key]
T = sum(r["sec"] for r in recs); A = sum(r["sec"] for r in recs if (r["busy"] or 0) > KNEE)
S = lambda rs: sum(r["sec"] for r in rs)
SA = lambda rs: sum(r["sec"] for r in rs if (r["busy"] or 0) > KNEE)
def q(xs, p): return round(sorted(xs)[min(len(xs) - 1, int(p * len(xs)))], 1) if xs else None
def wq(pairs, p):
    pairs = sorted(pairs); tot = sum(w for _, w in pairs); acc = 0
    for v, w in pairs:
        acc += w
        if acc >= p * tot: return round(v, 1)
for proj in ("all", "cezar", "squeal"):
    rs = [r for r in recs if proj == "all" or r["p"] == proj]
    Tp = S(rs); Ap = SA(rs)
    held = [r for r in rs if r["held"]]
    saved = [r for r in held if r["why"] != "read" and not r["other"]]
    moved = [r for r in held if r["why"] == "read"]
    d = [((r["nev"] - r["s"]) / 60000, r["sec"]) for r in moved]
    ffr = [(r["nev"] - r["s"]) / 60000 for r in held if r["ff"] and r["why"] == "read"]
    print(json.dumps({"project": proj, "held_pct": round(100 * S(held) / Tp, 1), "held_aboveKnee_pct": round(100 * SA(held) / Ap, 1),
        "held_h": round(S(held) / 3600, 1), "saved_pct": round(100 * S(saved) / Tp, 1), "saved_aboveKnee_pct": round(100 * SA(saved) / Ap, 1),
        "saved_h": round(S(saved) / 3600, 1), "moved_pct": round(100 * S(moved) / Tp, 1),
        "other_wt_only_pct": round(100 * S([r for r in held if r["why"] != "read" and r["other"]]) / Tp, 1),
        "moved_delay_min_p50_p75_p95_by_seconds": [wq(d, .5), wq(d, .75), wq(d, .95)],
        "nobody_total_pct": round(100 * S([r for r in rs if r["why"] != "read" and not r["other"]]) / Tp, 1),
        "first_fails_held": sum(1 for r in held if r["ff"]), "ff_read_later": len(ffr), "ff_delay_min_p50_p95_max": [q(ffr, .5), q(ffr, .95), q(ffr, 1.0)],
        "ff_never_read": sum(1 for r in held if r["ff"] and r["why"] != "read" and not r["other"]),
        "ff_worktrees": len({r["wt"] for r in held if r["ff"]})}))
