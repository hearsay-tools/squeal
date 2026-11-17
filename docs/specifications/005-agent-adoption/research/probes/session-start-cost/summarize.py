# Throwaway. Median and p90 per group and step of step-budget.ts's JSON lines; the first run
# of each group is reported apart (cold page cache) and left out. Also the SQL groups of the
# registration. Usage: python3 -I summarize.py <series.jsonl>
import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
def q(xs, p):
    xs = sorted(xs); return round(xs[min(len(xs) - 1, int(p * len(xs)))]) if xs else None
groups = collections.OrderedDict()
# Rows of series.sh written before the probe recorded its source: by position (groups of
# 12, 12, 12, 10, 10, 6, 6, 6; the candidate's are lines 47-56 and 63-68 of a series).
for i, r in enumerate(rows):
    src = r.get("src") or ("cand" if 46 <= i < 56 or 62 <= i < 68 else "main")
    groups.setdefault((src, r["mode"], r["ensure"], r["lock"], "traced" if r.get("trace", True) else "untraced"), []).append(r)
for k, rs in groups.items():
    warm = [r for r in rs if r["run"] > 0] or rs  # series-fresh.sh: one run per process, all kept
    steps = collections.OrderedDict()
    for r in warm:
        for s, v in r["marks"].items(): steps.setdefault(s, []).append(v)
    over = sum(r["total"] > 2000 for r in warm)
    errs = collections.Counter((r["error"] or "")[:60] for r in warm if r["error"])
    print(f"{k}: n={len(warm)} total median {q([r['total'] for r in warm], .5)} p90 {q([r['total'] for r in warm], .9)} ms; "
          f"over 2000: {over}; first run {round(rs[0]['total'])} ms; load1 {min(r['load1'] for r in rs)}-{max(r['load1'] for r in rs)}; "
          f"starting {sum(bool(r['starting']) for r in warm)}; errors {dict(errs)}")
    hook = [r["total"] + 90 for r in warm]  # + Node start and bundle load, median 90 ms (node-start.sh)
    print(f"    as a hook (+90 ms Node start and bundle load): median {q(hook, .5)} p90 {q(hook, .9)}; over 2000: {sum(h > 2000 for h in hook)} of {len(hook)}")
    print("    steps: " + "; ".join(f"{s} {q(v, .5)}/{q(v, .9)}" for s, v in steps.items()))
    sq = collections.defaultdict(list)
    for r in warm:
        for t in r["top"]: sq[(t["db"], t["sql"][:70])].append((t["ms"], t["n"], t["rows"]))
    for (db, s), v in sorted(sq.items(), key=lambda kv: -sorted(x[0] for x in kv[1])[len(kv[1]) // 2])[:8]:
        ms = [x[0] for x in v]
        print(f"      {q(ms, .5):>5}/{q(ms, .9):>5} ms n={v[0][1]:>6} rows={v[0][2]:>6} {db} {s}")
