"""Squeal's share of the host's busy CPU in one sample.py window.

Usage: python3 -I analyze.py OUT.json

Busy cores come from /proc/stat (all CPU time but idle and iowait). Squeal's cores
are the CPU of every Squeal daemon's process tree over the window: the daemon, its
test processes, what they start, and the children they reaped. A tree is a
daemon's when its root's command line is `.../squeal/<version>/dist/cli/squeal.mjs
daemon <root>`. Prints one line per daemon tree, then a JSON summary line.
"""
import collections, json, re, sys

d = json.load(open(sys.argv[1]))
s0 = {int(k): v for k, v in d["s0"].items()}
s1 = {int(k): v for k, v in d["s1"].items()}
cmds = {int(k): v for k, v in d["cmds"].items()}
hz, el = d["hz"], d["elapsed"]

DAEMON = re.compile(r"squeal/(\d+\.\d+\.\d+)/dist/cli/squeal\.mjs daemon (\S+)")


def label(pid):
    m = DAEMON.search(cmds.get(pid, ""))
    if not m:
        return None
    root = m.group(2)
    project = root.split("/.ai/")[0].rstrip("/").split("/")[-1] if "/.ai/" in root else root.rstrip("/").split("/")[-1]
    if root.startswith("/tmp/"):
        project = "tmp (test fixture)"
    return f"{project} v{m.group(1)} {root}"


children = collections.defaultdict(list)
for p, st in s1.items():
    children[st["ppid"]].append(p)


def incl(st):
    return st["ut"] + st["st"] + st["cut"] + st["cst"]


def tree(p):
    st1, st0 = s1[p], s0.get(p)
    dlt = incl(st1) - incl(st0) if st0 and st0["start"] == st1["start"] else incl(st1)
    return dlt + sum(tree(c) for c in children.get(p, []))


per = collections.Counter()
for p in s1:
    lbl = label(p)
    if lbl and not any(label(a) for a in [s1[p]["ppid"]]):
        per[lbl] += tree(p)

c0, c1 = d["cpu0"], d["cpu1"]
total = sum(c1) - sum(c0)
idle = (c1[3] + c1[4]) - (c0[3] + c0[4])
busy = (total - idle) / hz / el
squeal = sum(per.values()) / hz / el
for lbl, dt in per.most_common():
    print(f"{dt / hz / el:6.2f} cores  {lbl}")
print(json.dumps({"windowSeconds": round(el, 1), "busyCores": round(busy, 1), "squealCores": round(squeal, 1),
                  "squealShareOfBusy": round(100 * squeal / busy) if busy > 0 else None, "daemonTrees": len(per)}))
