#!/usr/bin/env python3
# Throwaway probe for research 021-27. Reads /proc/<pid>/status and smaps only: it signals
# nothing and connects to nothing, so it may read a live daemon of another worktree.
# Usage: python3 -I split.py <pid>...            one line per pid
#        python3 -I split.py --watch <step> <out.tsv> <pid>   the pid and its descendants until it exits
# Columns (MiB): private (RssAnon+RssShmem), swap, the smaps split of resident memory:
#   v8_256k   anonymous 256 KiB mappings (V8's regular heap pages, 014-02 method)
#   anon_big  other anonymous mappings >= 1 MiB (V8 large objects and code range, glibc
#             thread arenas, ArrayBuffer backing stores; not separable from outside)
#   anon_small other anonymous mappings < 1 MiB
#   glibc     [heap]
#   mimalloc  [anon:mimalloc] (Rolldown)
#   file      file-backed
import os, re, sys, time

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

def split(p):
    t = read(f"/proc/{p}/smaps")
    if t is None: return None
    d = dict(v8_256k=0, anon_big=0, anon_small=0, glibc=0, mimalloc=0, file=0)
    cur = None
    for line in t.splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)", line)
        if m:
            size = int(m[2], 16) - int(m[1], 16); name = m[4].strip(); ino = int(m[3])
            if ino != 0 and name.startswith("/"): cur = "file"
            elif name == "[anon:mimalloc]": cur = "mimalloc"
            elif name == "[heap]": cur = "glibc"
            elif name == "" and size == 256 * 1024: cur = "v8_256k"
            elif name in ("", ) and size >= 1 << 20: cur = "anon_big"
            elif name.startswith("/") or name == "": cur = "anon_small"
            else: cur = "anon_small"
            continue
        if line.startswith("Rss:"): d[cur] += int(line.split()[1])
    return {k: round(v / 1024) for k, v in d.items()}

def row(p):
    s = status(p); sm = split(p)
    if not s or sm is None: return None
    cmd = (read(f"/proc/{p}/cmdline") or "").replace("\0", " ")
    kind = "daemon" if " daemon " in cmd else ("host-" + cmd.split("--runner ")[1].split()[0]) if "runner-host" in cmd else "other"
    return [p, kind, round((s.get("RssAnon", 0) + s.get("RssShmem", 0)) / 1024), round(s.get("VmSwap", 0) / 1024),
            s.get("Threads", 0)] + [sm[k] for k in ("v8_256k", "anon_big", "anon_small", "glibc", "mimalloc", "file")]

COLS = ["pid", "kind", "priv", "swap", "threads", "v8_256k", "anon_big", "anon_small", "glibc", "mimalloc", "file"]

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

if sys.argv[1] == "--watch":
    step, out, pid = float(sys.argv[2]), sys.argv[3], int(sys.argv[4])
    new = not os.path.exists(out)
    with open(out, "a") as f:
        if new: f.write("\t".join(["utc", "load1"] + COLS) + "\n")
        while os.path.exists(f"/proc/{pid}"):
            utc = time.strftime("%H:%M:%SZ", time.gmtime()); load = read("/proc/loadavg").split()[0]
            for p in [pid] + descendants(pid):
                r = row(p)
                if r: f.write("\t".join(map(str, [utc, load] + r)) + "\n")
            f.flush(); time.sleep(step)
else:
    print("\t".join(COLS))
    for a in sys.argv[1:]:
        r = row(int(a))
        if r: print("\t".join(map(str, r)))
