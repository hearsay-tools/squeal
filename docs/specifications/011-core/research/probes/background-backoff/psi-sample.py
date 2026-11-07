"""Passive sampler (throwaway): every STEP seconds, for N samples, one JSON line with the host's busy and nice cores
from /proc/stat over the step, the run queue (procs_running), the 1-minute load average, and Linux CPU pressure
(`some` avg10 and the `total` stall microseconds over the step) for the host and for this user's cgroup slice.
Reads /proc and /sys only. Starts no process and makes no load.

Usage: python3 -I psi-sample.py OUT.jsonl STEP N
"""
import json, os, sys, time

out, step, n = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
UID = os.getuid()
SLICE = f"/sys/fs/cgroup/user.slice/user-{UID}.slice/cpu.pressure"


def stat():
    with open("/proc/stat") as f:
        cpu = f.readline().split()[1:]
        rest = f.read()
    v = list(map(int, cpu))
    user, nice, system, idle, iowait, irq, softirq, steal = v[:8]
    running = int(next(l for l in rest.splitlines() if l.startswith("procs_running")).split()[1])
    return {"busy": user + nice + system + irq + softirq + steal, "nice": nice, "steal": steal,
            "all": sum(v[:8]), "running": running}


def psi(path):
    try:
        with open(path) as f:
            some = f.readline().split()
    except OSError:
        return None
    d = dict(x.split("=") for x in some[1:])
    return {"avg10": float(d["avg10"]), "total": int(d["total"])}


ncpu = os.cpu_count()
prev = (time.time(), stat(), psi("/proc/pressure/cpu"), psi(SLICE))
with open(out, "a") as f:
    for _ in range(n):
        time.sleep(step)
        now = (time.time(), stat(), psi("/proc/pressure/cpu"), psi(SLICE))
        dt = now[0] - prev[0]
        all_ = now[1]["all"] - prev[1]["all"]
        frac = lambda k: (now[1][k] - prev[1][k]) / all_ if all_ else 0.0
        stall = lambda i: None if now[i] is None or prev[i] is None else (now[i]["total"] - prev[i]["total"]) / 1e6 / dt
        with open("/proc/loadavg") as la:
            load1 = float(la.read().split()[0])
        f.write(json.dumps({"t": round(now[0], 1), "busy": round(ncpu * frac("busy"), 2), "nice": round(ncpu * frac("nice"), 2),
                            "steal": round(100 * frac("steal"), 2), "running": now[1]["running"], "load1": load1,
                            "psiSome10": now[2]["avg10"] if now[2] else None, "psiSomeStep": None if stall(2) is None else round(100 * stall(2), 2),
                            "slicePsi10": now[3]["avg10"] if now[3] else None, "slicePsiStep": None if stall(3) is None else round(100 * stall(3), 2)}) + "\n")
        f.flush()
        prev = now
