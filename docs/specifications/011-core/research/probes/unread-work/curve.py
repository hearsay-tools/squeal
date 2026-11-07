"""A rule "no background work in a worktree whose sessions made no tool call, prompt or Stop for X minutes; the work
waits until the next session event" replayed on classify.py's records. Throwaway, read only.
Usage: python3 -I curve.py REC.jsonl SESSIONS [KNEE=16]
Per X: background seconds the rule would hold (run start more than X min after the root's last session event, or
before its first); of them, saved = nobody read them (classify.py: no later event before replacement or removal, no
other worktree); moved = read later, with the hold (next event minus run start) as the delay of their results;
first failures in held work: read later (delay p50/p95/max) or never.
Assumes the work would run on the next event as before, and other worktrees then run what they used (no saving)."""
import bisect, collections, json, sys
KNEE = float(sys.argv[3]) if len(sys.argv) > 3 else 16
ev = collections.defaultdict(list)
for line in open(sys.argv[2]):
    s = json.loads(line)
    ev[s["root"]].extend(e[0] * 1000 for e in s["events"])
for k in ev:
    ev[k].sort()
recs = [json.loads(l) for l in open(sys.argv[1])]
recs = [r for r in recs if r["kind"] in ("baseline", "backlog")]
recs.sort(key=lambda r: r["s"])
prev = {}
for r in recs:
    k = (r["p"], r["wt"], r["f"])
    r["ff"] = bool(r["fails"]) and not prev.get(k, False)
    prev[k] = bool(r["fails"])
    lst = ev.get(r["root"], [])
    i = bisect.bisect_left(lst, r["s"])
    r["idle"] = (r["s"] - lst[i - 1]) / 60000 if i > 0 else 1e9
T = sum(r["sec"] for r in recs); A = sum(r["sec"] for r in recs if (r["busy"] or 0) > KNEE)
def q(xs, p): return round(sorted(xs)[min(len(xs) - 1, int(p * len(xs)))], 1) if xs else None
for X in (1, 3, 5, 10, 30, 60):
    held = [r for r in recs if r["idle"] > X]
    saved = [r for r in held if r["why"] != "read" and not r["other"]]
    moved = [r for r in held if r["why"] == "read"]
    delays = [(r["nev"] - r["s"]) / 60000 for r in moved]
    ffr = [(r["nev"] - r["s"]) / 60000 for r in held if r["ff"] and r["why"] == "read"]
    S = lambda rs: sum(r["sec"] for r in rs)
    SA = lambda rs: sum(r["sec"] for r in rs if (r["busy"] or 0) > KNEE)
    print(json.dumps({"X_min": X, "held_pct": round(100 * S(held) / T, 1), "held_aboveKnee_pct": round(100 * SA(held) / A, 1),
        "saved_pct": round(100 * S(saved) / T, 1), "saved_aboveKnee_pct": round(100 * SA(saved) / A, 1), "saved_h": round(S(saved) / 3600, 1),
        "moved_pct": round(100 * S(moved) / T, 1), "other_wt_only_pct": round(100 * S([r for r in held if r["why"] != "read" and r["other"]]) / T, 1),
        "result_delay_min_p50_p95_weighted_by_file": [q(delays, .5), q(delays, .95)],
        "first_fails_held": sum(1 for r in held if r["ff"]), "ff_read_later": len(ffr), "ff_delay_min_p50_p95_max": [q(ffr, .5), q(ffr, .95), q(ffr, 1.0)],
        "ff_never_read": sum(1 for r in held if r["ff"] and r["why"] != "read" and not r["other"])}))
