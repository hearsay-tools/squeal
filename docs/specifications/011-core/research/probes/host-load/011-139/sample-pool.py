"""Throwaway probe for row 011-139. Usage: python3 -I sample-pool.py INTERVAL_S COUNT OUT.jsonl

Reads /proc and the pool directory's mark files only. It never opens a permit
file (pool.<i>.lock) or a daemon socket. Each line is one interval between two
snapshots: the host's busy cores and %nice from /proc/stat, the load average, and
per Squeal daemon: its root, version, the CPU of its process tree over the
interval, its test processes (descendants whose command line names vitest) with
their nice, its direct children by kind (vitest, node-test, pytest, other), the permits it holds (POSIX locks in /proc/locks on pool.<i>.lock
inodes, by pid), its worktree id (sha256 of its root's real path) and the
mark of that id (want, grant, cores)."""
import hashlib, json, os, re, sys, time

HZ = os.sysconf("SC_CLK_TCK")
POOL = f"/run/user/{os.getuid()}/squeal"
DAEMON = re.compile(r"(?:/(\d+\.\d+\.\d+))?/dist/cli/squeal\.mjs daemon (\S+)")


def read_stat(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            s = f.read()
    except OSError:
        return None
    rp = s.rfind(")")
    rest = s[rp + 2 :].split()
    return (int(rest[1]), int(rest[11]) + int(rest[12]) + int(rest[13]) + int(rest[14]), int(rest[16]), int(rest[19]))


def read_cmd(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode(errors="replace")
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


def permit_inodes():
    out = {}
    for name in os.listdir(POOL):
        m = re.fullmatch(r"pool\.(\d+)\.lock", name)
        if m:
            try:
                out[os.stat(os.path.join(POOL, name)).st_ino] = int(m.group(1))
            except OSError:
                pass
    return out


def lock_holders(inodes):
    """pid -> sorted permit indices it holds a POSIX WRITE lock on."""
    held = {}
    with open("/proc/locks") as f:
        for line in f:
            parts = line.split()
            if "->" in parts:
                continue  # a blocked waiter, not a holder
            if len(parts) < 8 or parts[1] != "POSIX":
                continue
            ino = int(parts[5].split(":")[2])
            if ino in inodes:
                held.setdefault(int(parts[4]), set()).add(inodes[ino])
    return {p: sorted(s) for p, s in held.items()}


def marks():
    out = {}
    for name in os.listdir(POOL):
        if name.startswith("pool.mark.") and not name.endswith(".tmp"):
            try:
                p = os.path.join(POOL, name)
                age = time.time() - os.stat(p).st_mtime
                m = json.load(open(p))
                m["age"] = round(age, 1)
                out[m["id"]] = m
            except (OSError, ValueError):
                pass
    return out


def worktree_of(root):
    """Spec 001's worktree id: sha256 of the root's real path, 16 hex digits (src/core/fs/git-layout.ts)."""
    try:
        return hashlib.sha256(os.path.realpath(root).encode()).hexdigest()[:16]
    except OSError:
        return None


def main():
    interval, count, out = float(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    cmds, wids, members = {}, {}, {}
    prev, c_prev, t_prev = snapshot(), cpu_line(), time.time()
    with open(out, "a") as fo:
        for _ in range(count):
            time.sleep(interval)
            snap, c_now, t_now = snapshot(), cpu_line(), time.time()
            el = t_now - t_prev
            total = sum(c_now) - sum(c_prev)
            idle = (c_now[3] + c_now[4]) - (c_prev[3] + c_prev[4])
            nice = c_now[1] - c_prev[1]
            for p in snap:
                if p not in cmds or cmds[p][1] != snap[p][3]:
                    cmds[p] = (read_cmd(p), snap[p][3])
            children = {}
            for p, st in snap.items():
                children.setdefault(st[0], []).append(p)
            inodes = permit_inodes()
            holders = lock_holders(inodes)
            mk = marks()
            daemons = []
            for p, st in snap.items():
                m = DAEMON.search(cmds[p][0])
                if not m or DAEMON.search(cmds.get(st[0], ("", 0))[0]):
                    continue
                key = (p, st[3])
                if key not in wids:
                    wids[key] = worktree_of(m.group(2))
                cpu, tests, vitest, test_nice, permits, stack = 0, 0, 0, {}, list(holders.get(p, [])), [p]
                now_members = {}
                while stack:
                    q = stack.pop()
                    now_members[(q, snap[q][3])] = snap[q][1]
                    s1, s0 = snap[q], prev.get(q)
                    cpu += s1[1] - s0[1] if s0 and s0[3] == s1[3] else s1[1]
                    if q != p:
                        vitest += "vitest" in cmds[q][0]
                        if "vitest" in cmds[q][0] and snap.get(s1[0]) and "vitest" not in cmds[s1[0]][0]:
                            tests += 1
                            test_nice[s1[2]] = test_nice.get(s1[2], 0) + 1
                        permits += holders.get(q, [])
                    stack += children.get(q, [])
                # A process of the tree that ended was reaped inside it (its reaper's cutime took its
                # whole lifetime): take off what earlier intervals already counted of it.
                for (q, start), last in members.get(key, {}).items():
                    if (q, start) not in now_members:
                        cpu -= last
                members[key] = now_members
                kids = {}
                for c in children.get(p, []):
                    cmd = cmds[c][0]
                    kind = "vitest" if "vitest" in cmd else "node-test" if "--test" in cmd else "pytest" if "pytest" in cmd else "other"
                    kids[kind] = kids.get(kind, 0) + 1
                wid = wids[key]
                daemons.append({
                    "pid": p, "version": m.group(1) or "dev", "root": m.group(2), "wid": wid,
                    "cores": round(cpu / HZ / el, 2), "tests": tests, "vitestProcs": vitest,
                    "testNice": test_nice, "children": kids, "permits": sorted(set(permits)),
                    "mark": mk.get(wid) if wid else None,
                })
            fo.write(json.dumps({
                "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t_now)), "el": round(el, 2),
                "load": open("/proc/loadavg").read().split()[:3],
                "busy": round((total - idle) / HZ / el, 2), "nice": round(nice / HZ / el, 2),
                "permitFiles": len(inodes), "holders": {str(k): v for k, v in holders.items()},
                "marks": mk, "daemons": daemons,
            }) + "\n")
            fo.flush()
            members = {k: v for k, v in members.items() if k[0] in snap}
            prev, c_prev, t_prev = snap, c_now, t_now


main()
