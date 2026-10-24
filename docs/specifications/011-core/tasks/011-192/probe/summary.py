"""Per run: whether the first beat written after the free was stamped before it, and what the old filter measured."""
import json, sys
rows = []
for i, line in enumerate(open(sys.argv[1]), 1):
    r = json.loads(line); f = r["freed"]
    beats = [(b["stamp"] - f, b["written"] - f) for b in r["beats"]]
    after = [(s, w) for s, w in beats if w >= -50]  # nothing is written in the hold; -50 keeps a write that beat `freed`'s own stamp
    first = after[0] if after else None
    old = next((s for s, _ in beats if s >= 0), None)  # the old test's pick: the first stamp at or after `freed`
    early = first is not None and first[0] < 0
    rows.append((i, r["load"][0], r["load"][1], r["stored"] - f, first, early, old))
    print(f"{i:2} load {r['load'][0]:5.1f} {r['load'][1]:5.1f} rev {r['stored'] - f:4} first(stamp,write) {first} stamped-before-free {early} old-pick {old}")
early = [r for r in rows if r[5]]
print(f"runs {len(rows)}; first beat stamped before the free in {len(early)}; old pick over 1000 ms in {sum(1 for r in rows if r[6] is None or r[6] > 1000)}")
print("first write after the free, ms:", sorted(r[4][1] for r in rows if r[4]))
