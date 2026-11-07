"""Per-class details for classify.py's background records: what a skip or defer rule would move, and the failures
that first appeared in that work. Throwaway, read only. Usage: python3 -I details.py REC.jsonl [KNEE=16]

- Class 1: records outside every session's [first, last event] (`nos_any`: the session left, the daemon drained or
  served on) and outside every gap-split span (`nos`: also sessions idle for GAP_MIN of classify.py).
  For each: who read it later and how long after the run ended (first session event in the root, `nev`).
- Class 2: records in worktrees removed within N hours of the run's end.
- Class 3: records whose file ran again in the same worktree within N minutes (`sup`), and before any session event.
- Failures: records whose stored result holds a fail, and whether it is the file's first fail in that worktree.
"""
import collections, json, sys

recs = [json.loads(l) for l in open(sys.argv[1])]
KNEE = float(sys.argv[2]) if len(sys.argv) > 2 else 16
BG = ("baseline", "backlog")
bg = [r for r in recs if r["kind"] in BG]
T = sum(r["sec"] for r in bg)
A = sum(r["sec"] for r in bg if (r["busy"] or 0) > KNEE)
days = (max(r["s"] for r in recs) - min(r["s"] for r in recs)) / 86_400_000
print(json.dumps({"bg_h": round(T / 3600, 1), "above_h": round(A / 3600, 1), "days": round(days, 2)}))


def wq(xs, q):  # seconds-weighted quantile of (value, weight)
    xs = sorted(xs)
    tot = sum(w for _, w in xs)
    acc = 0
    for v, w in xs:
        acc += w
        if acc >= q * tot:
            return v
    return None


def share(sel, label):
    rows = [r for r in bg if sel(r)]
    x = sum(r["sec"] for r in rows)
    y = sum(r["sec"] for r in rows if (r["busy"] or 0) > KNEE)
    return {"label": label, "h": round(x / 3600, 1), "pctBg": round(100 * x / T, 1), "pctAboveKnee": round(100 * y / A, 1),
            "h_per_day": round(x / 3600 / days, 1), "files": len(rows)}


prev = {}
for r in sorted(recs, key=lambda r: r["s"]):
    k = (r["p"], r["wt"], r["f"])
    r["first_fail"] = bool(r["fails"]) and not prev.get(k, False)
    prev[k] = bool(r["fails"])

for flag in ("nos_any", "nos"):
    rows = [r for r in bg if r[flag]]
    out = share(lambda r: r[flag], f"class1 {flag}")
    by = collections.Counter()
    for r in rows:
        by["read later in its worktree" if r["why"] == "read" else "other worktree only" if r["other"] else "nobody"] += r["sec"]
    out["who"] = {k: round(100 * v / sum(by.values()), 1) for k, v in by.items()}
    d = [((r["nev"] - r["e"]) / 60_000, r["sec"]) for r in rows if r["why"] == "read"]
    out["delay_to_next_session_event_min_p25_p50_p75_p95"] = [round(wq(d, q), 1) for q in (0.25, 0.5, 0.75, 0.95)]
    per_p = collections.Counter(r["p"] for r in rows for _ in [0])
    out["pctBg_by_project"] = {p: round(100 * sum(r["sec"] for r in rows if r["p"] == p) / sum(r["sec"] for r in bg if r["p"] == p), 1)
                                for p in ("cezar", "squeal")}
    out["by_kind_pctOfKind"] = {k: round(100 * sum(r["sec"] for r in rows if r["kind"] == k) / sum(r["sec"] for r in bg if r["kind"] == k), 1) for k in BG}
    ff = [r for r in rows if r["first_fail"]]
    fd = sorted((r["nev"] - r["e"]) / 60_000 for r in ff if r["why"] == "read")
    out["first_fails"] = {"n": len(ff), "read_later": len(fd), "other_only": sum(1 for r in ff if r["why"] != "read" and r["other"]),
                          "nobody": sum(1 for r in ff if r["why"] != "read" and not r["other"]),
                          "delay_min_p50_p75_max": [round(fd[len(fd) // 2], 1), round(fd[3 * len(fd) // 4], 1), round(fd[-1], 1)] if fd else None,
                          "distinct_files": len({(r["p"], r["wt"], r["f"]) for r in ff}), "worktrees": len({r["wt"] for r in ff}),
                          "runs": len({r["run"] for r in ff})}
    print(json.dumps(out))

for n in (1, 6, 24):
    lim = n * 3_600_000
    rows = [r for r in bg if r["rm"] and r["rm"] - r["e"] <= lim]
    out = share(lambda r: r["rm"] and r["rm"] - r["e"] <= lim, f"class2 removed within {n} h")
    x = sum(r["sec"] for r in rows)
    out["of_it_pct"] = {"read in its worktree": round(100 * sum(r["sec"] for r in rows if r["why"] == "read") / x, 1),
                        "other worktree only": round(100 * sum(r["sec"] for r in rows if r["why"] != "read" and r["other"]) / x, 1),
                        "nobody": round(100 * sum(r["sec"] for r in rows if r["why"] != "read" and not r["other"]) / x, 1)}
    out["first_fails"] = sum(1 for r in rows if r["first_fail"])
    out["worktrees"] = len({r["wt"] for r in rows})
    print(json.dumps(out))
rm_any = {r["wt"] for r in bg if r["rm"]}
print(json.dumps({"worktrees_with_bg": len({r["wt"] for r in bg}), "of_them_removed": len(rm_any)}))

for m in (5, 30):
    lim = m * 60_000
    print(json.dumps(share(lambda r: r["sup"] and r["sup"] - r["e"] <= lim, f"class3 same file ran again within {m} min")))
print(json.dumps(share(lambda r: r["why"] == "superseded", "class3 ran again before any session event")))
print(json.dumps(share(lambda r: r["why"] == "superseded" and not r["other"], "class3 ... and no other worktree")))

ff = [r for r in bg if r["first_fail"]]
print(json.dumps({"bg_first_fails": len(ff), "bg_records_with_row": sum(1 for r in bg if r["row"]), "bg_fail_records": sum(1 for r in bg if r["fails"]),
                  "first_fail_nobody": sum(1 for r in ff if r["why"] != "read" and not r["other"]),
                  "first_fail_nobody_by_why": dict(collections.Counter(r["why"] for r in ff if r["why"] != "read" and not r["other"]))}))
nob = [r for r in bg if r["why"] != "read" and not r["other"]]
print(json.dumps({"class4 nobody by why (pct of class4)": {k: round(100 * v / sum(r["sec"] for r in nob), 1) for k, v in
                  collections.Counter({w: sum(r["sec"] for r in nob if r["why"] == w) for w in ("removed", "superseded", "no-later-event")}).items()},
                  "class4 nos_any share": round(100 * sum(r["sec"] for r in nob if r["nos_any"]) / sum(r["sec"] for r in nob), 1)}))
