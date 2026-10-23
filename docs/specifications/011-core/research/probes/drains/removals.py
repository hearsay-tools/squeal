#!/usr/bin/env python3
"""011-161 probe: minutes from a task's last finish to its worktree's removal,
from a COPY of cezarion's `runs.db`, and what a store copy kept of each.

Throwaway. Usage: python3 -I removals.py <runs.db-copy> <store-copy> <since-iso>

A task's departure is its `finishedAt` (its session's end, inferred); its
removal is `worktreeReclaimedAt`, else `delegation.destroy.requestedAt`.
The worktree id is Squeal's: sha256 of the root path, 16 hex digits
(`src/core/fs/git-layout.ts` `worktreeIdFor`). For each removed worktree it
counts the runs the store still holds that started after the departure (a
drain's or a later session's), and their results.
"""
import calendar
import hashlib
import json
import sqlite3
import statistics
import sys
import time


def ms(text):
    return calendar.timegm(time.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")) * 1000 if text else None


def main(runsdb, store, since_iso):
    since = ms(since_iso)
    cz = sqlite3.connect(runsdb)
    db = sqlite3.connect(store)
    live = {w for (w,) in db.execute("select id from worktrees")}
    gaps, rows = [], []
    for path, data in cz.execute("select worktree_path, data from runs where worktree_path is not null"):
        d = json.loads(data)
        fin = ms(d.get("finishedAt"))
        rem = ms(d.get("worktreeReclaimedAt") or ((d.get("delegation") or {}).get("destroy") or {}).get("requestedAt"))
        if fin is None or fin < since:
            continue
        wid = hashlib.sha256(path.encode()).hexdigest()[:16]
        after = db.execute("select count(*), min(started_at), max(started_at) from runs"
                           " where worktree_id = ? and started_at > ?", (wid, fin + 3_000)).fetchone()
        res = db.execute("select count(*), sum(last_used_at > recorded_at + 60000) from results r"
                         " join runs u on u.id = r.run_id where u.worktree_id = ? and u.started_at > ?",
                         (wid, fin + 3_000)).fetchone()
        role = (d.get("delegation") or {}).get("role") or "root"
        row = {"wt": wid, "role": role, "status": d.get("status"), "finished": d.get("finishedAt"),
               "removed": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(rem / 1000)) if rem else None,
               "min_to_removal": round((rem - fin) / 60_000, 1) if rem else None,
               "in_store": wid in live, "runs_after_finish": after[0], "results_after_finish": res[0],
               "read_later": res[1] or 0}
        rows.append(row)
        if rem:
            gaps.append(row["min_to_removal"])
    for r in rows:
        print(json.dumps(r))
    removed = [r for r in rows if r["removed"]]
    def q(xs, p):
        xs = sorted(xs)
        return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
    print(json.dumps({"tasks_finished_since": len(rows), "removed": len(removed),
                      "removed_by_role": {k: sum(1 for r in removed if r["role"] == k) for k in {r["role"] for r in removed}},
                      "min_to_removal_p10_p25_p50_p75_p90": [q(gaps, p) for p in (0.1, 0.25, 0.5, 0.75, 0.9)],
                      "under_60_min": sum(1 for g in gaps if g < 60), "under_15_min": sum(1 for g in gaps if g < 15),
                      "negative": sum(1 for g in gaps if g < 0),
                      "removed_with_runs_after_finish": sum(1 for r in removed if r["runs_after_finish"]),
                      "their_results": sum(r["results_after_finish"] for r in removed),
                      "their_read_later": sum(r["read_later"] for r in removed)}))


if __name__ == "__main__":
    main(*sys.argv[1:4])
