"""Record every process for a window, for analyze.py. Usage: python3 -I sample.py SECONDS OUT.json

Reads /proc only: each process's CPU times (its own and its reaped children's), parent
and start time at the window's start and end, the processes born inside it, and the
host's /proc/stat CPU line at both ends."""
import json, os, sys, time

HZ = os.sysconf("SC_CLK_TCK")


def read_stat(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            s = f.read()
    except OSError:
        return None
    rp = s.rfind(")")
    comm = s[s.find("(") + 1 : rp]
    rest = s[rp + 2 :].split()
    # rest[0]=state, rest[1]=ppid; utime=rest[11], stime=rest[12], cutime=rest[13], cstime=rest[14], nice=rest[16], starttime=rest[19]
    return {
        "comm": comm,
        "state": rest[0],
        "ppid": int(rest[1]),
        "ut": int(rest[11]),
        "st": int(rest[12]),
        "cut": int(rest[13]),
        "cst": int(rest[14]),
        "nice": int(rest[16]),
        "start": int(rest[19]),
    }


def read_cmd(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode(errors="replace").strip()
    except OSError:
        return ""


def snapshot():
    snap = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            st = read_stat(int(d))
            if st:
                snap[int(d)] = st
    return snap


def cpu_line():
    with open("/proc/stat") as f:
        return [int(x) for x in f.readline().split()[1:]]


def main():
    secs = float(sys.argv[1])
    out = sys.argv[2]
    t0 = time.time()
    c0 = cpu_line()
    s0 = snapshot()
    cmds = {p: read_cmd(p) for p in s0}
    known = set(s0)
    new = {}
    ancestry = {}
    while time.time() - t0 < secs:
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            p = int(d)
            if p in known:
                continue
            known.add(p)
            st = read_stat(p)
            if not st:
                continue
            c = read_cmd(p)
            cmds[p] = c
            chain = []
            q = st["ppid"]
            for _ in range(12):
                if q <= 1:
                    break
                qs = read_stat(q)
                if not qs:
                    break
                if q not in cmds:
                    cmds[q] = read_cmd(q)
                chain.append(q)
                q = qs["ppid"]
            new[p] = {"ppid": st["ppid"], "comm": st["comm"], "cmd": c[:400], "chain": chain, "nice": st["nice"]}
        time.sleep(0.02)
    s1 = snapshot()
    c1 = cpu_line()
    for p in s1:
        if p not in cmds:
            cmds[p] = read_cmd(p)
    elapsed = time.time() - t0
    json.dump(
        {
            "elapsed": elapsed,
            "hz": HZ,
            "cpu0": c0,
            "cpu1": c1,
            "s0": {str(k): v for k, v in s0.items()},
            "s1": {str(k): v for k, v in s1.items()},
            "cmds": {str(k): v[:400] for k, v in cmds.items()},
            "new": {str(k): v for k, v in new.items()},
        },
        open(out, "w"),
    )
    print(f"elapsed={elapsed:.1f}s new_seen={len(new)} live0={len(s0)} live1={len(s1)}")


main()
