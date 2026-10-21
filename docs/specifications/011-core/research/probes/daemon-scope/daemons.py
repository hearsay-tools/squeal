#!/usr/bin/env python3
# Throwaway probe for research 011-52. Read-only: reads /proc and opens stores with mode=ro.
# Signals nothing, connects to no socket. Usage: python3 -I daemons.py [--smaps] > out.txt
# One row per live Squeal daemon: version, project, worktree, age, CPU, private memory, swap,
# the JS-heap estimate from smaps (256 KiB anonymous mappings), and its descendants' memory.
import os, re, sys, sqlite3, time, json

SMAPS = "--smaps" in sys.argv
TICKS = os.sysconf("SC_CLK_TCK")
uptime = float(open("/proc/uptime").read().split()[0])
uid = os.getuid()

def read(p):
    try:
        with open(p, "rb") as f: return f.read().decode("latin1")
    except OSError: return None

def stat(pid):
    t = read(f"/proc/{pid}/stat")
    if t is None: return None
    f = t[t.rindex(")") + 2:].split(" ")
    return dict(ppid=int(f[1]), pgrp=int(f[2]), utime=int(f[11]), stime=int(f[12]),
                nice=int(f[16]), threads=int(f[17]), start=int(f[19]))

def status(pid):
    out = {}
    for line in (read(f"/proc/{pid}/status") or "").splitlines():
        m = re.match(r"(\w+):\s+(\d+) kB", line)
        if m: out[m[1]] = int(m[2])
    return out

def smaps_split(pid):
    t = read(f"/proc/{pid}/smaps")
    if t is None: return None
    out = dict(heap256=0, mimalloc=0, glibc=0, anon_other=0, file=0)
    cur = None
    for line in t.splitlines():
        m = re.match(r"([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)", line)
        if m:
            size = int(m[2], 16) - int(m[1], 16)
            name = m[4].strip(); ino = int(m[3])
            if ino != 0 and name.startswith("/"): cur = "file"
            elif name == "[anon:mimalloc]": cur = "mimalloc"
            elif name == "[heap]": cur = "glibc"
            elif name == "" and size == 256 * 1024: cur = "heap256"
            else: cur = "anon_other"
            continue
        if line.startswith("Rss:"):
            out[cur] += int(line.split()[1])
    return {k: round(v / 1024) for k, v in out.items()}

pids = [int(p) for p in os.listdir("/proc") if p.isdigit()]
procs = {}
for p in pids:
    s = stat(p)
    if s: procs[p] = s
children = {}
for p, s in procs.items(): children.setdefault(s["ppid"], []).append(p)

def descendants(p):
    out, stack = [], list(children.get(p, []))
    while stack:
        c = stack.pop(); out.append(c); stack.extend(children.get(c, []))
    return out

rows = []
for p in procs:
    cmd = read(f"/proc/{p}/cmdline")
    if not cmd: continue
    argv = cmd.split("\0")
    if "daemon" not in argv: continue
    i = argv.index("daemon")
    if i == 0 or not argv[i - 1].endswith("squeal.mjs"): continue
    try:
        if os.stat(f"/proc/{p}").st_uid != uid: continue
    except OSError: continue
    root = argv[i + 1] if len(argv) > i + 1 else "?"
    m = re.search(r"/(\d+\.\d+\.\d+)/", argv[i - 1])
    version = m[1] if m else argv[i - 1]
    st, ss = procs[p], status(p)
    lock = None
    try:
        for fd in os.listdir(f"/proc/{p}/fd"):
            try: tgt = os.readlink(f"/proc/{p}/fd/{fd}")
            except OSError: continue
            m2 = re.search(r"/squeal/locks/([0-9a-f]+)\.sqlite$", tgt)
            if m2: lock = (tgt.split("/squeal/locks/")[0], m2[1])
    except OSError: pass
    desc = descendants(p)
    dpriv = dswap = 0
    for c in desc:
        cs = status(c); dpriv += cs.get("RssAnon", 0) + cs.get("RssShmem", 0); dswap += cs.get("VmSwap", 0)
    age = uptime - st["start"] / TICKS
    row = dict(pid=p, version=version, root=root, common=lock[0] if lock else None,
               worktree=lock[1] if lock else None, age_h=round(age / 3600, 2),
               cpu_s=round((st["utime"] + st["stime"]) / TICKS),
               priv_mib=round((ss.get("RssAnon", 0) + ss.get("RssShmem", 0)) / 1024),
               swap_mib=round(ss.get("VmSwap", 0) / 1024), threads=st["threads"],
               desc=len(desc), desc_priv_mib=round(dpriv / 1024), desc_swap_mib=round(dswap / 1024))
    if SMAPS: row["smaps_mib"] = smaps_split(p)
    rows.append(row)

# Read-only store facts per worktree: test files keyed, revisions, last revision, consumers.
stores = {}
for r in rows:
    if not r["common"]: continue
    db = stores.get(r["common"])
    if db is None:
        db = stores[r["common"]] = sqlite3.connect(f"file:{r['common']}/squeal/store.sqlite?mode=ro", uri=True)
    w = r["worktree"]
    r["test_files"] = db.execute("select count(*) from test_file_keys where worktree_id=?", (w,)).fetchone()[0]
    rev = db.execute("select count(*), max(number), max(created_at) from revisions where worktree_id=?", (w,)).fetchone()
    r["revisions"], r["revision"] = rev[0], rev[1]
    r["last_rev_min_ago"] = round((time.time() * 1000 - rev[2]) / 60000) if rev[2] else None
    r["consumers"] = db.execute("select count(*) from consumers where worktree_id=?", (w,)).fetchone()[0]
    st = db.execute("select value from meta where key=?", (f"slow-tier:{w}",)).fetchone()
    r["slow_tier"] = st[0] if st else None
    dep = db.execute("select value from meta where key=?", (f"departed:{w}",)).fetchone()
    r["departed"] = dep[0] if dep else None
    r["open_runs"] = db.execute("select count(*) from runs where worktree_id=? and ended_at is null", (w,)).fetchone()[0]

load = open("/proc/loadavg").read().split()[:3]
mem = {k: v for k, v in (l.split(":") for l in open("/proc/meminfo").read().splitlines())}
print(json.dumps(dict(at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), load=load,
                      memtotal=mem["MemTotal"].strip(), memavail=mem["MemAvailable"].strip(),
                      swapfree=mem["SwapFree"].strip(), swaptotal=mem["SwapTotal"].strip(),
                      daemons=sorted(rows, key=lambda r: -r["priv_mib"])), indent=1))
