"""Throwaway probe for row 011-181. Usage: python3 -I sample-trees.py OUT.jsonl [SNAP_S] [LINE_S]

Reads /proc only. It never opens a store, a socket or a permit file, and it never
reads an environment. Every SNAP_S seconds (default 5) it reads each process's
CPU (its own and its reaped children's), parent, nice and start; every LINE_S
seconds (default 60) it writes one line of CPU per process tree:

- squeal: a tree under a Squeal daemon (`dist/cli/squeal.mjs daemon <root>`), by root.
- test: a tree under a test runner outside Squeal (Vitest, `npm test`, pytest,
  `node --test`, jest, mocha), by its topmost runner process. Its first line is a
  `test-start` event with the runner's command (NAME=value tokens dropped), cwd,
  nice and its nearest agent session; its last is a `test-end` event with its CPU
  seconds and wall.
- agent: the rest of a tree under an agent CLI (claude, codex, opencode, pi), by
  the agent process. An `agent` event names its kind and cwd once.
- other: the rest, by the command name of the tree's top process.

A tree's CPU in an interval is the sum over its processes of the growth of
own + children's time, minus, for each process that ended, what earlier intervals
counted of it: its reaper's children's time takes its whole life. The reaper is
taken as its nearest ancestor that is still alive. A subreaper (pid 1, systemd)
counts its own time only. Each line also carries the host's /proc/stat split, so
`accounted` can be checked against `busy`."""
import json, os, re, sys, time

HZ = os.sysconf("SC_CLK_TCK")
SELF = os.getpid()
DAEMON = re.compile(r"/dist/cli/squeal\.mjs daemon (\S+)")
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
AGENTS = {"claude", "codex", "opencode", "pi"}
with open("/proc/stat") as f:
    BTIME = next(int(l.split()[1]) for l in f if l.startswith("btime"))


def read_stat(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            s = f.read()
    except OSError:
        return None
    rp = s.rfind(")")
    comm = s[s.find("(") + 1 : rp]
    r = s[rp + 2 :].split()
    # ppid, own ticks, children's ticks, nice, start ticks, comm
    return (int(r[1]), int(r[11]) + int(r[12]), int(r[13]) + int(r[14]), int(r[16]), int(r[19]), comm)


def read_argv(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
    except OSError:
        return []


def read_cwd(pid):
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return None


def clean(argv):
    return " ".join(a for a in argv if not ASSIGN.match(a))[:300]


def base(a):
    return a.rsplit("/", 1)[-1]


def runner(argv):
    """The test runner kind an argv starts, or None."""
    if not argv:
        return None
    b0 = base(argv[0])
    rest = [a for a in argv[1:] if not a.startswith("-")]
    if b0 in ("npm", "pnpm", "yarn", "bun"):
        if rest[:1] in (["test"], ["t"]) or (rest[:1] == ["run"] and rest[1:2] and rest[1].startswith("test")):
            return "npm-test"
        if rest[:2] == ["exec", "vitest"] or (b0 == "bun" and rest[:1] == ["test"]):
            return "vitest" if "vitest" in rest[:2] else "bun-test"
        return None
    if b0 == "npx":
        return "vitest" if "vitest" in [base(a) for a in rest[:1]] else None
    if b0 in ("vitest", "vitest.mjs"):
        return "vitest"
    if b0 == "node" or b0.startswith("node"):
        first = rest[:1]
        if first and base(first[0]) in ("vitest", "vitest.mjs"):
            return "vitest"
        if first and base(first[0]) in ("jest", "jest.js", "mocha", "_mocha"):
            return "jest-mocha"
        if "--test" in argv[1:]:
            return "node-test"
        return None
    if b0.startswith("pytest") or b0 == "py.test":
        return "pytest"
    if b0.startswith("python") and "-m" in argv and argv.index("-m") + 1 < len(argv) and argv[argv.index("-m") + 1] == "pytest":
        return "pytest"
    return None


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
    out = sys.argv[1]
    snap_s = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
    line_s = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0
    argvs = {}  # (pid, start) -> argv
    keys_seen = {}  # tree key -> meta written
    tests = {}  # test key -> {cpu, first, last}
    prev = snapshot()
    prev_keys = {}
    c_line0, t_line0 = cpu_line(), time.time()
    acc = {}
    fo = open(out, "a")

    def write(obj):
        fo.write(json.dumps(obj, separators=(",", ":")) + "\n")
        fo.flush()

    write({"event": "start", "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "hz": HZ, "cpus": os.cpu_count(), "snapS": snap_s, "lineS": line_s})
    while True:
        time.sleep(snap_s)
        snap = snapshot()
        now = time.time()
        for p, st in snap.items():
            if (p, st[4]) not in argvs:
                argvs[(p, st[4])] = read_argv(p)
        info = {}

        def tree(p):
            if p in info:
                return info[p]
            st = snap.get(p)
            if not st:
                return (None, None, None, None)
            argv = argvs.get((p, st[4]), [])
            parent = st[0]
            sub = p == 1 or st[5] == "systemd"
            up = (None, None, None, None) if parent <= 1 or sub or parent not in snap else tree(parent)
            if snap.get(parent) and snap[parent][5] == "systemd":
                up = (None, None, None, None)
            daemon, test, agent, top = up
            m = DAEMON.search(" ".join(argv))
            if daemon is None and m:
                daemon = m.group(1)
            if test is None and daemon is None and runner(argv):
                test = (p, st[4])
            if argv and base(argv[0]) in AGENTS:
                agent = (p, st[4])
            if top is None:
                top = (p, st[4], st[5])
            info[p] = (daemon, test, agent, top)
            return info[p]

        keys = {}
        for p, st in snap.items():
            daemon, test, agent, top = tree(p)
            if p == SELF:
                k = ("sampler",)
            elif daemon:
                k = ("squeal", daemon)
            elif test:
                k = ("test",) + test
            elif agent:
                k = ("agent",) + agent
            else:
                k = ("other", top[2])
            keys[p] = k
            if k[0] == "test" and k not in tests:
                tp, ts = test
                targv = argvs.get((tp, ts), [])
                ag = agent
                if ag and ("agent",) + ag not in keys_seen:
                    keys_seen[("agent",) + ag] = 1
                    aargv = argvs.get(ag, [])
                    write({"event": "agent", "id": f"{ag[0]}.{ag[1]}", "kind": base(aargv[0]) if aargv else None, "cwd": read_cwd(ag[0]), "started": round(BTIME + ag[1] / HZ)})
                chain, q = [], snap[tp][0]
                while q in snap and len(chain) < 6 and (not ag or q != ag[0]):
                    chain.append(snap[q][5])
                    q = snap[q][0]
                tests[k] = {"cpu": 0, "first": now, "last": now, "procs": 0, "nice": set()}
                write({"event": "test-start", "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "id": f"{tp}.{ts}", "kind": runner(targv), "cmd": clean(targv), "cwd": read_cwd(tp), "nice": snap[tp][3], "started": round(BTIME + ts / HZ, 1), "agent": f"{ag[0]}.{ag[1]}" if ag else None, "via": chain})
            if k[0] == "agent" and k not in keys_seen:
                keys_seen[k] = 1
                aargv = argvs.get((k[1], k[2]), [])
                write({"event": "agent", "id": f"{k[1]}.{k[2]}", "kind": base(aargv[0]) if aargv else None, "cwd": read_cwd(k[1]), "started": round(BTIME + k[2] / HZ)})
        for p, st in snap.items():
            k = keys[p]
            s0 = prev.get(p)
            sub = p == 1 or st[5] == "systemd"
            if s0 and s0[4] == st[4]:
                d = (st[1] - s0[1]) + (0 if sub else st[2] - s0[2])
            else:
                d = st[1] + (0 if sub else st[2])
            acc[k] = acc.get(k, 0) + d
            if k[0] == "test":
                t = tests[k]
                t["cpu"] += d
                t["last"] = now
                t["nice"].add(st[3])
        for p, s0 in prev.items():
            st = snap.get(p)
            if st and st[4] == s0[4]:
                continue
            q = s0[0]
            while q > 1 and q in prev and not (q in snap and snap[q][4] == prev[q][4]):
                q = prev[q][0]
            if q <= 1 or q not in snap or snap[q][5] == "systemd":
                continue
            k = keys[q]
            v = s0[1] + s0[2]
            acc[k] = acc.get(k, 0) - v
            if k[0] == "test":
                tests[k]["cpu"] -= v
        for k in [k for k, t in tests.items() if t["last"] < now]:
            t = tests.pop(k)
            write({"event": "test-end", "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t["last"])), "id": f"{k[1]}.{k[2]}", "cpuS": round(t["cpu"] / HZ, 1), "wallS": round(t["last"] - BTIME - k[2] / HZ, 1), "nice": sorted(t["nice"])})
        for k in tests:
            tests[k]["procs"] = 0
        for p, k in keys.items():
            if k[0] == "test":
                tests[k]["procs"] += 1
        prev = snap
        if now - t_line0 >= line_s:
            c = cpu_line()
            el = now - t_line0
            d = [b - a for a, b in zip(c_line0, c)]
            total = sum(d[:8])
            busy = total - d[3] - d[4]
            cores = lambda v: round(v / HZ / el, 2)
            line = {"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "el": round(el, 1), "load": open("/proc/loadavg").read().split()[0],
                    "busy": cores(busy), "user": cores(d[0]), "nice": cores(d[1]), "system": cores(d[2]), "iowait": cores(d[4]), "irq": cores(d[5] + d[6]),
                    "accounted": cores(sum(acc.values())), "squeal": {}, "tests": {}, "agents": {}, "other": {}}
            for k, v in acc.items():
                if k[0] == "squeal":
                    line["squeal"][k[1]] = cores(v)
                elif k[0] == "test":
                    line["tests"][f"{k[1]}.{k[2]}"] = [cores(v), tests[k]["procs"] if k in tests else 0]
                elif k[0] == "agent":
                    if abs(v) >= 0.05 * HZ * el:
                        line["agents"][f"{k[1]}.{k[2]}"] = cores(v)
                    else:
                        line["agents"]["rest"] = round(line["agents"].get("rest", 0) + cores(v), 2)
                else:
                    name = k[-1] if k[0] == "other" else "sampler"
                    line["other"][name] = round(line["other"].get(name, 0) + cores(v), 2)
            line["other"] = {n: v for n, v in line["other"].items() if abs(v) >= 0.05 or n == "sampler"}
            write(line)
            acc, c_line0, t_line0 = {}, c, now
            if len(argvs) > 200000:
                argvs = {k: v for k, v in argvs.items() if k[0] in snap and snap[k[0]][4] == k[1]}


main()
