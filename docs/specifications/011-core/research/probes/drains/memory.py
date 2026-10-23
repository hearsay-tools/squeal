#!/usr/bin/env python3
"""011-161 probe: what draining daemons and their test processes held, from
`sample.py`'s output.

Throwaway. Usage: python3 -I memory.py <scratch-dir> [idle-minutes]

Each sample is joined to the newest store extraction taken at or before it.
A daemon is "draining" when its worktree's newest note after the daemon's
start is a drain's start note ("the last session ended with ... pending"),
no "daemon stopped:" note follows it, no consumer of the worktree registered
after it, no revision followed it, and the bound has not passed. It is "live"
with a consumer registered, "other" otherwise (a quiet daemon, a daemon with
no store row). Its slow lane state is the published `slow-tier:` row.
CPU is CPU-seconds per minute of each process seen in two samples.
Prints one line per sample, then per-daemon drain spans and the totals.
"""
import glob
import json
import os
import sys
import time

START = "the last session ended with "


def load_stores(scratch):
    out = []
    for path in sorted(glob.glob(os.path.join(scratch, "stores", "*.json"))):
        with open(path) as f:
            d = json.load(f)
        out.append(d)
    out.sort(key=lambda d: d["copied"][1])
    return out


def worktree_of(stores_at, root):
    for d in stores_at:
        for w in d["worktrees"]:
            if w["root"] == root:
                return d, w
    return None, None


def state(store, w, at_ms, idle_ms):
    notes = sorted(json.loads(store["meta"].get(f"notes.{w['id']}", "[]")), key=lambda n: n.get("at", 0))
    started = w["started"] or 0
    cons = [c for c in store["consumers"] if c["wt"] == w["id"]]
    slow = store["meta"].get(f"slow-tier:{w['id']}")
    drain_start = None
    for n in notes:
        if n.get("at", 0) < started:
            continue
        t = n.get("text", "")
        if t.startswith(START):
            drain_start = n["at"]
        elif t.startswith("daemon stopped:"):
            drain_start = None
    if drain_start is not None:
        back = [c for c in cons if c["registered"] > drain_start]
        if not back and not cons and at_ms - drain_start < idle_ms:
            return "draining", drain_start, slow
        return "live" if cons else "other", None, slow
    return ("live" if cons else "other"), None, slow


def main(scratch, idle_min="60"):
    idle_ms = int(idle_min) * 60_000
    stores = load_stores(scratch)
    samples = [json.loads(l) for l in open(os.path.join(scratch, "samples.jsonl"))]
    prev = {}
    spans = {}
    tot = {"samples": 0, "minutes": 0.0}
    print("at load1 | draining: n daemon_pss_mib tests_pss_mib cpu_s_per_min | live: n pss tests | other: n pss tests | host avail_mib")
    for s in samples:
        at_ms = s["at"] * 1000
        latest = {}
        for d in stores:
            if d["copied"][1] * 1000 <= at_ms + 1:
                latest[d["repo"]] = d
        groups = {"draining": [0, 0, 0, 0.0], "live": [0, 0, 0, 0.0], "other": [0, 0, 0, 0.0]}
        for dm in s["daemons"]:
            store, w = worktree_of(latest.values(), dm["root"])
            if w is None:
                st, ds, slow = "other", None, None
            else:
                st, ds, slow = state(store, w, at_ms, idle_ms)
            key = (dm["pid"], dm["start_ticks"])
            # Per process, matched by pid: a test process that started and ended between two
            # samples is missed, so CPU of test processes is a lower bound.
            dcpu = 0.0
            for pid, ticks in [(dm["pid"], dm["cpu_ticks"])] + [(c["pid"], c["cpu_ticks"]) for c in dm["children"]]:
                was = prev.get(pid)
                if was is not None and s["at"] > was[0]:
                    dcpu += max(0, ticks - was[1]) / os.sysconf("SC_CLK_TCK") / ((s["at"] - was[0]) / 60)
                prev[pid] = (s["at"], ticks)
            g = groups[st]
            g[0] += 1
            g[1] += (dm["pss"] or dm["rss"]) / 2**20
            g[2] += sum((c["pss"] or c["rss"]) for c in dm["children"]) / 2**20
            g[3] += dcpu or 0
            if st == "draining":
                sp = spans.setdefault(key, {"root": dm["root"], "drain_start": ds, "first": s["at"], "samples": 0,
                                            "pss": [], "tests": [], "cpu_s": 0.0, "slow": {}, "children_max": 0})
                sp["last"] = s["at"]
                sp["samples"] += 1
                sp["pss"].append(round((dm["pss"] or dm["rss"]) / 2**20))
                sp["tests"].append(round(sum((c["pss"] or c["rss"]) for c in dm["children"]) / 2**20))
                sp["cpu_s"] += (dcpu or 0)
                sp["children_max"] = max(sp["children_max"], len(dm["children"]))
                sp["slow"][str(slow)] = sp["slow"].get(str(slow), 0) + 1
        tot["samples"] += 1
        avail = s["mem"].get("MemAvailable", 0) / 2**20
        print(time.strftime("%H:%M:%SZ", time.gmtime(s["at"])), s["load"][0], "|",
              " | ".join(f"{k}: {g[0]} {g[1]:.0f} {g[2]:.0f} {g[3]:.1f}" for k, g in groups.items()), f"| {avail:.0f}")
        for k, g in groups.items():
            tot.setdefault(k, [0, 0.0, 0.0, 0.0])
            tot[k][0] += g[0]
            tot[k][1] += g[1]
            tot[k][2] += g[2]
            tot[k][3] += g[3]
    print("\nper draining daemon (one sample a minute, so samples = daemon-minutes):")
    for key, sp in sorted(spans.items(), key=lambda kv: kv[1]["first"]):
        print(json.dumps({"pid": key[0], "root": sp["root"][-45:],
                          "drain_start": time.strftime("%H:%M:%SZ", time.gmtime(sp["drain_start"] / 1000)) if sp["drain_start"] else None,
                          "seen": f"{time.strftime('%H:%M', time.gmtime(sp['first']))}-{time.strftime('%H:%M', time.gmtime(sp['last']))}",
                          "samples": sp["samples"], "pss_mib_min_med_max": [min(sp["pss"]), sorted(sp["pss"])[len(sp["pss"]) // 2], max(sp["pss"])],
                          "tests_mib_max": max(sp["tests"]), "children_max": sp["children_max"],
                          "cpu_s": round(sp["cpu_s"], 1), "slow_lane": sp["slow"]}))
    n = tot["samples"]
    print("\nmeans per sample:", {k: [round(v / n, 1) for v in tot[k]] for k in ("draining", "live", "other")}, "samples", n)
    print("daemon-minutes draining:", tot["draining"][0], "MiB-minutes (daemon + tests):", round(tot["draining"][1] + tot["draining"][2]),
          "CPU-s:", round(tot["draining"][3], 1))


if __name__ == "__main__":
    main(*sys.argv[1:])
