#!/usr/bin/env python3
"""011-84 probe: which live daemons each "unused" option would stop, and what that frees.

Read-only: `squeal ps --json` (no socket of a daemon is opened by this script)
and each store opened `mode=ro` in one read transaction. No signal.
Usage: python3 -I quiet.py <samples> <interval-s> > quiet-<time>.txt

Per daemon and sample: its consumers, the minutes since its worktree's last
revision (an edit), the minutes since its last run started or ended, its
slow lane's published state (`slow-tier:<wt>`), the tiers it runs, its
pending files, its pool permits, its private memory and its test processes'.
"Quiet" is the minutes since the latest of the last revision and a
consumer's `last_seen_at`/`last_delivered_at`; a socket request is not in
the store, so quiet can read long for a daemon that answered a status call.

Options for "use" under `daemon.unusedExitMinutes` (30 by default):
  A  today: an edit, a request or wait, or any work queued or running.
  B  an edit, a request or wait, or a tier running; work that waits for a
     permit, the slow slot, the load or the fast backlog is no use.
  C  an edit, a request or wait, or work they caused; the backlog (baseline,
     catch-up, an environment's re-key, slow files) is no use, running or not.
A daemon is a candidate when it has a consumer and quiet >= the bound.
Under B it stops when no run started or ended for the bound either.
Under C it stops when no `run-all` checkpoint is open (requested work).
"""
import json
import os
import sqlite3
import subprocess
import sys
import time

BOUND_MIN = 30


def store(common):
    path = os.path.join(common, "squeal", "store.sqlite")
    if not os.path.exists(path):
        return None
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    try:
        db.execute("begin")
        out = {
            "revision": dict(db.execute("select worktree_id, max(created_at) from revisions group by worktree_id")),
            "seen": dict(db.execute(
                "select worktree_id, max(max(last_seen_at, coalesce(last_delivered_at, 0))) from consumers"
                " group by worktree_id")),
            "run": dict(db.execute(
                "select worktree_id, max(max(started_at, coalesce(ended_at, 0))) from runs group by worktree_id")),
            "slow": {k[len("slow-tier:"):]: v for k, v in db.execute(
                "select key, value from meta where key like 'slow-tier:%'")},
            "runall": {r[0] for r in db.execute(
                "select worktree_id from checkpoints where kind = 'run-all' and completed_at is null")},
        }
        db.execute("rollback")
        return out
    finally:
        db.close()


def sample():
    t = time.time()
    raw = subprocess.run(["squeal", "ps", "--json"], capture_output=True, text=True, timeout=90).stdout
    ps = json.loads(raw)
    load = open("/proc/loadavg").read().split()[:3]
    rows = []
    for repo in ps["repositories"]:
        st = store(repo["commonDir"])
        if st is None:
            print(f"no store at {repo['commonDir']}: {len(repo['daemons'])} daemons skipped")
            continue
        now = ps["at"]
        for d in repo["daemons"]:
            wt = d["worktreeId"]
            work = d.get("work") or {}
            edit = max(st["revision"].get(wt) or 0, st["seen"].get(wt) or 0)
            tests = sum((p.get("privateBytes") or 0) + ((p.get("descendants") or {}).get("privateBytes") or 0)
                        for p in d.get("processes", []))
            rows.append({
                "pid": d["pid"], "wt": wt, "harness": d.get("harness"), "state": d.get("state"),
                "consumers": len(d.get("consumers", [])),
                "quiet": round((now - edit) / 60_000, 1) if edit else None,
                "sinceRun": round((now - st["run"][wt]) / 60_000, 1) if st["run"].get(wt) else None,
                "slow": st["slow"].get(wt), "runAll": wt in st["runall"],
                "tiers": [(x["lane"], x["files"], x.get("checkpointId") is not None) for x in work.get("tiers", [])],
                "pending": work.get("pending"), "permits": d.get("permits"),
                "mib": round((d.get("privateBytes") or 0) / 2**20), "testMib": round(tests / 2**20),
                "root": d["root"],
            })
    return {"at": time.strftime("%H:%M:%SZ", time.gmtime(t)), "load": load, "pool": ps["squeal"]["pool"],
            "daemons": rows}


def verdicts(r):
    if r["consumers"] == 0 or r["quiet"] is None or r["quiet"] < BOUND_MIN:
        return None
    idle = not r["tiers"] and not r["pending"]
    a = idle
    b = idle or (r["sinceRun"] is None or r["sinceRun"] >= BOUND_MIN)
    c = idle or not r["runAll"]
    return a, b, c


def main(n, interval):
    for i in range(n):
        s = sample()
        print(f"\n### {s['at']} load {' '.join(s['load'])} pool {s['pool']}")
        freed = {"A": [0, 0, 0, 0], "B": [0, 0, 0, 0], "C": [0, 0, 0, 0]}
        for r in sorted(s["daemons"], key=lambda r: -(r["quiet"] or 0)):
            v = verdicts(r)
            mark = "-" if v is None else "".join(k if x else "." for k, x in zip("ABC", v))
            print(f"{r['pid']:>8} {r['harness'] or '?':6} {r['state'][:20]:20} c{r['consumers']} quiet {r['quiet']}m"
                  f" run {r['sinceRun']}m pend {r['pending']} tiers {r['tiers']} slow {r['slow']}"
                  f" runAll {r['runAll']} permits {r['permits']} {r['mib']}+{r['testMib']} MiB stop[{mark}]"
                  f" {os.path.basename(r['root'])[:8]}")
            if v is None:
                continue
            for k, x in zip("ABC", v):
                if x:
                    f = freed[k]
                    f[0] += 1
                    f[1] += r["mib"]
                    f[2] += r["testMib"]
                    f[3] += r["permits"] or 0
        for k, (count, mib, test, permits) in freed.items():
            print(f"option {k}: {count} daemons, {mib} MiB daemon + {test} MiB tests, {permits} pool permits")
        sys.stdout.flush()
        if i < n - 1:
            time.sleep(interval)


if __name__ == "__main__":
    main(int(sys.argv[1]), float(sys.argv[2]))
