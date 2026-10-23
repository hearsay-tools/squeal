# niced CPU over N seconds, split by whether the process environment names SQUEAL_OBSERVE (names only)
import os, time, sys, collections
def snap():
    d = {}
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        try:
            st = open(f"/proc/{p}/stat").read(); f = st[st.rfind(")")+2:].split()
            if int(f[16]) <= 0: continue
            names = [e.split(b"=",1)[0] for e in open(f"/proc/{p}/environ","rb").read().split(b"\0") if e]
            mine = os.readlink(f"/proc/{p}/cwd").startswith("/tmp/el143")
            d[p] = (int(f[11]) + int(f[12]) + int(f[13]) + int(f[14]), b"SQUEAL_OBSERVE" in names, mine)
        except Exception: pass
    return d
n = float(sys.argv[1]); a = snap(); time.sleep(n); b = snap()
g = collections.Counter()
for p, (t, sq, mine) in b.items():
    g[("probe" if mine else "squeal-marked" if sq else "other-niced")] += (t - a.get(p, (0,))[0]) / 100 / n
print({k: round(v, 2) for k, v in g.items()}, "load", open("/proc/loadavg").read().split()[0])
