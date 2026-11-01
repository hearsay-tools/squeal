# Throwaway probe for 017-13. Not product code.
#   python3 -I threads.py <samples.jsonl> [from_ms to_ms]
# Summarises sampler.mjs output: per thread, its name, start and CPU (s) over the window
# (epoch ms; default the whole file), the process RSS at the start and end of the window and
# its peak RSS (VmHWM), and the load range. CPU is in ticks of 1/100 s.
import json
import sys

path = sys.argv[1]
lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
hi = int(sys.argv[3]) if len(sys.argv) > 3 else 1 << 62
cpu = {}
name = {}
start = {}
at_lo = {}
rss = []
loads = []
pid = None
for line in open(path):
    r = json.loads(line)
    if "moved" not in r:
        continue
    if r["pid"] != pid:
        pid = r["pid"]
        cpu, at_lo = {}, {}
    for tid, m in r["moved"].items():
        key = (pid, tid)
        if "comm" in m:
            name[key] = m["comm"]
            start[key] = m["start"]
        if r["t"] <= lo:
            at_lo[key] = m["cpu"]
        cpu[key] = m["cpu"] if r["t"] <= hi else cpu.get(key, m["cpu"])
        if r["t"] <= hi:
            cpu[key] = m["cpu"]
    if lo <= r["t"] <= hi:
        rss.append((r["t"], r["rssKb"], r["hwmKb"]))
        loads.append(r["load1"])
    last = r
rows = []
for key, c in cpu.items():
    d = (c - at_lo.get(key, 0)) / 100
    if d > 0:
        rows.append((name[key], key[1], start[key], d))
rows.sort(key=lambda x: -x[3])
for n, tid, st, d in rows:
    print(f"{n:16} tid {tid:>8} start {st:>10} cpu {d:8.2f} s")
by = {}
for n, _, _, d in rows:
    by[n] = by.get(n, 0) + d
print("by name:", {k: round(v, 2) for k, v in by.items()})
if rss:
    print(f"rss first {rss[0][1]/1024:.0f} MB last {rss[-1][1]/1024:.0f} MB peak(hwm) {max(h for _, _, h in rss)/1024:.0f} MB")
    print(f"load {min(loads)} to {max(loads)}; window {(rss[-1][0]-rss[0][0])/1000:.1f} s")
