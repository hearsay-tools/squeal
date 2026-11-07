"""Note of 2026-11-07: cezar switched baseline.onStart to lookup-only on 2026-11-06 17:39Z (cezar fc5c2c5e0, PR
#2808). For cezar named waits before and after that time: the timed-out share, and the seconds spent behind a
restart baseline's run (timeline.mjs `baseline`). A worktree takes the change only once its checkout has the
commit, so "after" mixes old and new worktrees. Throwaway. Usage: python3 -I cezar-baseline.py TL_ALL.jsonl"""
import json, sys
from datetime import datetime, timezone
CUT = datetime(2026, 11, 6, 17, 39, tzinfo=timezone.utc)
x = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
x = [r for r in x if r["project"] == "cezar" and r["storeHasWorktree"] and r["nTests"] > 0]
for name, f in (("before", lambda r: datetime.fromisoformat(r["start"]) < CUT), ("after", lambda r: datetime.fromisoformat(r["start"]) >= CUT)):
    for bname, g in (("all bands", lambda r: True), ("12+ busy", lambda r: r["band"] >= 2)):
        xs = [r for r in x if f(r) and g(r)]
        if not xs:
            continue
        n = len(xs); to = [r for r in xs if r["timedOut"]]
        bl = sum(r["baseline"] for r in xs); tot = sum(r["covered"] + r["other"] + r["idle"] for r in xs)
        print(f"cezar {name:6} {bname:9} | waits {n:4} | timed out {len(to) / n:4.0%} | mean wait {tot / n:4.1f} s | behind a baseline run {bl / n:4.1f} s/wait ({bl / max(1, tot):.0%} of wait time)"
              f" | waits with any baseline-ahead time {sum(1 for r in xs if r['baseline'] > 0) / n:4.0%} | timed out with baseline ahead {sum(1 for r in to if r['baseline'] > 0) / max(1, len(to)):4.0%} (n {len(to)})")
