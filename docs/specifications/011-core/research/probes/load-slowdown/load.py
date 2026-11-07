"""Shared loaders for the load-slowdown probe (throwaway). Read only: sar exports and runs.jsonl copies.

runs.jsonl comes from extract-runs.mjs. sar-u.csv is `sadf -d -U saDD -- -u` for each day (UTC epoch seconds).
"""
import bisect, json

CPUS = 24


def load_sar(path):
    """Samples sorted by end time: (start_s, end_s, busy_cores, nice_cores, steal_pct, iowait_pct)."""
    out = []
    for line in open(path):
        x = line.strip().split(";")
        if len(x) < 10 or "RESTART" in line:
            continue
        interval, ts = int(x[1]), int(x[2])
        user, nice, system, iowait, steal, idle = map(float, x[4:10])
        out.append((ts - interval, ts, CPUS * (100 - idle) / 100, CPUS * nice / 100, steal, iowait))
    out.sort(key=lambda s: s[1])
    return out


class Sar:
    def __init__(self, path):
        self.s = load_sar(path)
        self.ends = [s[1] for s in self.s]

    def at(self, t_s):
        """The sample whose interval holds t_s, or None."""
        i = bisect.bisect_left(self.ends, t_s)
        if i < len(self.s) and self.s[i][0] <= t_s <= self.s[i][1]:
            return self.s[i]
        return None


def load_runs(path, exclude_root_part=None):
    runs = []
    for line in open(path):
        r = json.loads(line)
        if exclude_root_part and r["root"] and exclude_root_part in r["root"]:
            continue
        if r["end"] <= r["start"]:
            continue
        wall = (r["end"] - r["start"]) / 1000
        fsum = sum(d for _, d in r["files"]) / 1000
        # Mean files running at once in the run: its module seconds over its wall, at least 1, at most picked.
        r["wall"] = wall
        r["fsum"] = fsum
        r["par"] = max(1.0, min(float(r["picked"]), fsum / wall)) if wall > 0 else 1.0
        r["kind"] = r["cp"] or "tier"
        runs.append(r)
    runs.sort(key=lambda r: r["start"])
    return runs


class Step:
    """A piecewise-constant sum of intervals, with its integral, for the mean over any window."""

    def __init__(self, intervals):  # (start_ms, end_ms, weight)
        ev = {}
        for s, e, w in intervals:
            ev[s] = ev.get(s, 0) + w
            ev[e] = ev.get(e, 0) - w
        self.t = sorted(ev)
        self.v, self.I = [], [0.0]
        cur = 0.0
        for i, t in enumerate(self.t):
            cur += ev[t]
            self.v.append(cur)
            if i + 1 < len(self.t):
                self.I.append(self.I[-1] + cur * (self.t[i + 1] - t))

    def integral(self, t):
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0:
            return 0.0
        if i >= len(self.v) - 1:
            return self.I[-1]
        return self.I[i] + self.v[i] * (t - self.t[i])

    def mean(self, s, e):
        return (self.integral(e) - self.integral(s)) / (e - s) if e > s else 0.0


def band(x, edges):
    for i in range(len(edges) - 1):
        if edges[i] <= x < edges[i + 1]:
            return i
    return len(edges) - 2


def label(edges, i):
    hi = edges[i + 1]
    return f"{edges[i]:g}-{hi:g}" if hi != float("inf") else f"{edges[i]:g}+"


def quant(a, p):
    a = sorted(a)
    if not a:
        return None
    k = p * (len(a) - 1)
    lo = int(k)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (k - lo)


def med(a):
    return quant(a, 0.5)
