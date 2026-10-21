#!/usr/bin/env python3
# Throwaway probe for research 011-53, question 4. Arithmetic only, over 011-52's snapshot of the
# 2026-10-21 09:28Z population (../daemon-scope/snapshot-1.json): 19 production daemons.
# Usage: python3 -I estimate.py <snapshot-1.json>
# Per daemon with a runner (heap256 above the 61 MiB of a runnerless daemon), what each policy
# leaves of its JS-heap mappings (heap256); mimalloc, glibc and other memory are kept.
#   reducer  V8's own memory reducer after ~2 min quiet: heap256 -> min(heap256, 190)   (run 3)
#   lastres  a last-resort GC: heap256 -> min(heap256, L) for L = 126, 250, 400 MiB of live heap
#            (126 = one fast instance measured, last-resort.jsonl; 250 and 400 allow for a slow
#            instance and instances leaked by recreates, not measured)
#   exit     the daemon exits: all of its private memory and swap
# "quiet" = no revision for 30 min or more at the snapshot (last_rev_min_ago >= 30).
import json, sys
d = json.load(open(sys.argv[1]))
rows = [r for r in d["daemons"] if "/tmp/squeal-e2e" not in r["root"]]
G = lambda m: round(m / 1024, 2)
tot_priv = sum(r["priv_mib"] for r in rows); tot_swap = sum(r["swap_mib"] for r in rows)
print(f"daemons {len(rows)}  private {tot_priv} MiB ({G(tot_priv)} GiB)  swap {tot_swap} MiB  heap256 {sum((r['smaps_mib'] or {}).get('heap256',0) for r in rows)} MiB")
def save(rows, cap):
    return sum(max(0, (r["smaps_mib"] or {}).get("heap256", 0) - cap) for r in rows if (r["smaps_mib"] or {}).get("heap256", 0) > 61)
for name, sel in [("all", rows), ("quiet>=30min", [r for r in rows if (r["last_rev_min_ago"] or 0) >= 30])]:
    print(f"\n{name}: {len(sel)} daemons, private {sum(r['priv_mib'] for r in sel)} MiB, swap {sum(r['swap_mib'] for r in sel)} MiB")
    print(f"  reducer (heap256 -> 190): saves {save(sel, 190)} MiB = {G(save(sel, 190))} GiB")
    for L in (126, 250, 400):
        print(f"  last-resort GC (heap256 -> {L}): saves {save(sel, L)} MiB = {G(save(sel, L))} GiB")
    ex = sum(r["priv_mib"] + r["swap_mib"] for r in sel)
    print(f"  exit: saves {ex} MiB = {G(ex)} GiB (daemon only; its test processes come on top)")
