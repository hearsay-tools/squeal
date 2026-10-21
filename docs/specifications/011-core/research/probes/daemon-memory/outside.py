#!/usr/bin/env python3
# Throwaway probe for research 011-53. Reads /proc of ONE process this research started (its own
# daemon), never a live one. Signals nothing, connects to nothing.
# Usage: python3 -I outside.py <pid> <step-seconds> <out.tsv>
# Every step: the one-minute load, the daemon's private memory (RssAnon + RssShmem), swap,
# threads, the smaps split (JS heap as 256 KiB anonymous mappings, [anon:mimalloc], [heap] =
# glibc, other anonymous, file), and the private memory of its descendants (test processes).
# Stops when the pid is gone.
import os, re, sys, time

pid, step, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]

def read(p):
    try:
        with open(p, "rb") as f: return f.read().decode("latin1")
    except OSError: return None

def status(p):
    d = {}
    for line in (read(f"/proc/{p}/status") or "").splitlines():
        m = re.match(r"(\w+):\s+(\d+)", line)
        if m: d[m[1]] = int(m[2])
    return d

def smaps_split(p):
    t = read(f"/proc/{p}/smaps")
    if t is None: return None
    d = dict(heap256=0, mimalloc=0, glibc=0, anon_other=0, file=0)
    cur = None
    for line in t.splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)", line)
        if m:
            size = int(m[2], 16) - int(m[1], 16); name = m[4].strip(); ino = int(m[3])
            if ino != 0 and name.startswith("/"): cur = "file"
            elif name == "[anon:mimalloc]": cur = "mimalloc"
            elif name == "[heap]": cur = "glibc"
            elif name == "" and size == 256 * 1024: cur = "heap256"
            else: cur = "anon_other"
            continue
        if line.startswith("Rss:"): d[cur] += int(line.split()[1])
    return {k: round(v / 1024) for k, v in d.items()}

def descendants(root):
    kids = {}
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        t = read(f"/proc/{p}/stat")
        if not t: continue
        ppid = int(t[t.rindex(")") + 2:].split(" ")[1])
        kids.setdefault(ppid, []).append(int(p))
    out, stack = [], list(kids.get(root, []))
    while stack:
        c = stack.pop(); out.append(c); stack.extend(kids.get(c, []))
    return out

cols = ["utc", "load1", "privMiB", "swapMiB", "threads", "heap256", "mimalloc", "glibc", "anon_other", "file", "kids", "kidsPrivMiB"]
new = not os.path.exists(out)
with open(out, "a") as f:
    if new: f.write("\t".join(cols) + "\n")
    while os.path.exists(f"/proc/{pid}"):
        s = status(pid); sm = smaps_split(pid)
        if not s or sm is None: break
        ks = descendants(pid)
        kp = sum((status(k).get("RssAnon", 0) + status(k).get("RssShmem", 0)) for k in ks)
        row = [time.strftime("%H:%M:%SZ", time.gmtime()), read("/proc/loadavg").split()[0],
               round((s.get("RssAnon", 0) + s.get("RssShmem", 0)) / 1024), round(s.get("VmSwap", 0) / 1024),
               s.get("Threads", 0), sm["heap256"], sm["mimalloc"], sm["glibc"], sm["anon_other"], sm["file"],
               len(ks), round(kp / 1024)]
        f.write("\t".join(map(str, row)) + "\n"); f.flush()
        time.sleep(step)
