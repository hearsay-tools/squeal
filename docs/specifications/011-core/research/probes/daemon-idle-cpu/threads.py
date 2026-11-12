"""Throwaway probe (row 011-313). Read only: /proc of the given pids.

Per thread of each pid, over SECONDS: CPU seconds (utime+stime), thread name,
and process-wide read/write bytes and syscalls; and the open .sqlite files.
Usage: python3 -I threads.py SECONDS PID [PID...]
"""
import os, sys, time, json
HZ = os.sysconf('SC_CLK_TCK')

def threads(pid):
    out = {}
    for tid in os.listdir(f'/proc/{pid}/task'):
        try:
            s = open(f'/proc/{pid}/task/{tid}/stat').read()
            name = s[s.index('(')+1:s.rindex(')')]
            f = s[s.rindex(')')+2:].split()
            out[tid] = (name, (int(f[11]) + int(f[12])) / HZ)
        except OSError:
            pass
    return out

def io(pid, tid=None):
    p = f'/proc/{pid}/io' if tid is None else f'/proc/{pid}/task/{tid}/io'
    d = {}
    for line in open(p):
        k, v = line.split(':'); d[k] = int(v)
    return d

def dbs(pid):
    r = []
    for fd in os.listdir(f'/proc/{pid}/fd'):
        try:
            t = os.readlink(f'/proc/{pid}/fd/{fd}')
        except OSError:
            continue
        if '.sqlite' in t:
            r.append(t)
    return sorted(set(r))

secs = float(sys.argv[1]); pids = sys.argv[2:]
a = {p: (threads(p), {t: io(p, t) for t in os.listdir(f'/proc/{p}/task')}, io(p)) for p in pids}
time.sleep(secs)
for p in pids:
    t0, tio0, io0 = a[p]
    t1 = threads(p); io1 = io(p)
    rows = []
    for tid, (name, c) in t1.items():
        c0 = t0.get(tid, (name, 0))[1]
        try:
            i1 = io(p, tid); i0 = tio0.get(tid, {k: 0 for k in i1})
            rd = i1['rchar'] - i0['rchar']; rc = i1['syscr'] - i0['syscr']
        except OSError:
            rd = rc = None
        rows.append({'tid': tid, 'name': name, 'cpu': round((c - c0) / secs, 3), 'rchar': rd, 'syscr': rc})
    rows.sort(key=lambda r: -r['cpu'])
    print(json.dumps({'pid': p, 'seconds': secs,
        'proc': {k: io1[k] - io0[k] for k in ('rchar', 'syscr', 'wchar', 'syscw', 'read_bytes')},
        'threads': [r for r in rows if r['cpu'] > 0 or (r['syscr'] or 0) > 0],
        'dbs': dbs(p)}))
