#!/usr/bin/env python3
# Throwaway probe for research 011-52. Reads a snapshot from daemons.py and prints the memory
# each design would remove from that population. Arithmetic only; reads no live state.
# Usage: python3 -I estimate.py snapshot-1.json [fixed_mib] [child_floor_mib]
import json, sys
snap = json.load(open(sys.argv[1]))
FIXED = float(sys.argv[2]) if len(sys.argv) > 2 else 90      # a daemon with no runner (measured)
FLOOR = float(sys.argv[3]) if len(sys.argv) > 3 else 45      # a runner child's own runtime (measured)
rows = [r for r in snap["daemons"] if r["common"] and not r["common"].startswith("/tmp/")]
tot = lambda rs, k: sum(r[k] for r in rs)
def all_of(r): return r["priv_mib"] + r["swap_mib"] + r["desc_priv_mib"] + r["desc_swap_mib"]
print(f"snapshot {snap['at']} load {snap['load']}; production daemons {len(rows)}")
print(f"  daemons private {tot(rows,'priv_mib')} MiB + swap {tot(rows,'swap_mib')}; test processes private {tot(rows,'desc_priv_mib')} + swap {tot(rows,'desc_swap_mib')}")
print(f"  JS heap (256 KiB mappings) {sum(r['smaps_mib']['heap256'] for r in rows)} MiB; mimalloc {sum(r['smaps_mib']['mimalloc'] for r in rows)}")
by = {}
for r in rows: by.setdefault(r["common"], []).append(r)
for c, rs in by.items(): print(f"  {c}: {len(rs)} daemons, {sum(all_of(r) for r in rs)} MiB with swap and test processes")
# (a) lifecycle: daemons with no consumer, or no revision for 30 min (quiet), would be gone.
quiet = [r for r in rows if r["consumers"] == 0 or (r["last_rev_min_ago"] or 0) > 30]
print(f"(a) no consumer, or no revision for 30+ min: {len(quiet)} daemons, {sum(all_of(r) for r in quiet)} MiB incl. swap and test processes")
for r in quiet: print(f"     {r['pid']} cons {r['consumers']} last rev {r['last_rev_min_ago']} min, slow {r['slow_tier']}, {all_of(r)} MiB")
noc = [r for r in rows if r["consumers"] == 0]
print(f"    of which no consumer at all: {len(noc)} daemons, {sum(all_of(r) for r in noc)} MiB")
# (b) heap cap: the most a cap at N MiB could take from the heap mappings (an upper bound).
for cap in (256, 512, 768, 1024):
    print(f"(b) heap cap {cap} MiB: at most {sum(max(0, r['smaps_mib']['heap256'] - cap) for r in rows)} MiB (heap above the cap; the live set is not known)")
# (c) one daemon per repository, a runner child per worktree: the duplicated fixed part goes,
#     a child's own runtime comes back for every worktree with a runner.
withrunner = [r for r in rows if r["threads"] > 12]
for c, rs in by.items():
    n, k = len(rs), len([r for r in rs if r in withrunner])
    print(f"(c) {c}: {n} daemons -> 1 daemon + {k} runner children: saves {round((n - 1) * FIXED - k * FLOOR)} MiB")
# (d) every runner its own process: (c) plus one more child for each slow instance (fast + slow).
slow = [r for r in rows if r["slow_tier"] and r["slow_tier"] != "null"]
print(f"(d) as (c), minus {len(slow)} slow-lane children x {FLOOR} = {round(len(slow) * FLOOR)} MiB more cost")
