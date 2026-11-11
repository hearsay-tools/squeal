"""Throwaway (daemon-model Q1). Read only: for each daemon pid, CPU over WINDOW s of its main thread, of its other
threads, and of its child processes (test workers), from /proc. Usage: python3 -I threads.py WINDOW PID..."""
import os, sys, time
HZ = os.sysconf("SC_CLK_TCK")
def t(path):
    try:
        f = open(path).read().rsplit(")", 1)[1].split()
        return int(f[11]) + int(f[12])
    except OSError:
        return None
def tree(pid):
    out, todo = [], [pid]
    while todo:
        p = todo.pop()
        try:
            for tid in os.listdir(f"/proc/{p}/task"):
                for c in open(f"/proc/{p}/task/{tid}/children").read().split():
                    out.append(int(c)); todo.append(int(c))
        except OSError:
            pass
    return out
def snap(pid):
    main = t(f"/proc/{pid}/task/{pid}/stat")
    allt = t(f"/proc/{pid}/stat")
    kids = sum((t(f"/proc/{c}/stat") or 0) for c in tree(pid))
    return main, allt, kids, set(tree(pid))
w = float(sys.argv[1]); pids = [int(p) for p in sys.argv[2:]]
a = {p: snap(p) for p in pids}
time.sleep(w)
for p in pids:
    b = snap(p)
    if a[p][0] is None or b[0] is None:
        continue
    main = (b[0] - a[p][0]) / HZ / w
    other = ((b[1] - a[p][1]) - (b[0] - a[p][0])) / HZ / w
    kids = max(0.0, (b[2] - a[p][2]) / HZ / w)  # children that ended in the window are missed
    print(f"{p} main={main:.2f} other-threads={other:.2f} children={kids:.2f} cores")
