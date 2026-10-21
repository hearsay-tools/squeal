#!/usr/bin/env python3
# Throwaway probe for research 011-52. Read-only: /proc only. Samples every Squeal daemon's
# private memory (RssAnon + RssShmem), swap and CPU ticks every N seconds for M samples,
# with the one-minute load. Usage: python3 -I sample.py 20 45 > samples.tsv
import os, sys, time, re
step, count = float(sys.argv[1]), int(sys.argv[2])
def read(p):
    try:
        with open(p, "rb") as f: return f.read().decode("latin1")
    except OSError: return None
print("t\tload1\tpid\troot\tpriv_kb\tswap_kb\tticks")
for n in range(count):
    t = time.strftime("%H:%M:%S", time.gmtime()); load = open("/proc/loadavg").read().split()[0]
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        c = read(f"/proc/{p}/cmdline")
        if not c: continue
        a = c.split("\0")
        if "daemon" not in a: continue
        i = a.index("daemon")
        if i == 0 or not a[i - 1].endswith("squeal.mjs"): continue
        s = read(f"/proc/{p}/status") or ""
        kv = {m[0]: int(m[1]) for m in re.findall(r"^(\w+):\s+(\d+) kB", s, re.M)}
        st = read(f"/proc/{p}/stat") or ""
        f = st[st.rindex(")") + 2:].split(" ") if st else ["0"] * 20
        print(f"{t}\t{load}\t{p}\t{a[i+1] if len(a) > i + 1 else '?'}\t{kv.get('RssAnon',0)+kv.get('RssShmem',0)}\t{kv.get('VmSwap',0)}\t{int(f[11])+int(f[12])}")
    sys.stdout.flush()
    if n + 1 < count: time.sleep(step)
