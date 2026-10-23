#!/usr/bin/env python3
"""011-84 probe: what departure drains ran, from the stores' notes and runs.

Read-only: each store is opened `mode=ro` in one read transaction. No socket,
no signal. Usage: python3 -I drains.py <common-dir>... > drains-<time>.txt

A drain starts at the note "the last session ended with ... pending" and ends
at the worktree's next "daemon stopped:" note. Notes keep the newest 20 per
worktree, so an old drain may have lost its start note; one that ended at the
bound then started `idleExitMinutes` before its end. Runs started inside the
window are the drain's. A slow file is one the root's `slow.include` matches.
A result is "read later" when a lookup moved its `last_used_at` more than
60 s past its `recorded_at`, from any worktree, the same one included.
"""
import fnmatch
import json
import os
import sqlite3
import sys
import time

START = "the last session ended with"
BOUND = "after its last session ended (daemon.idleExitMinutes)"
DRAINED = ("have run", "is done")


def config(root):
    try:
        with open(os.path.join(root, "squeal.config.json")) as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    idle = (cfg.get("daemon") or {}).get("idleExitMinutes", 60)
    slow = (cfg.get("slow") or {}).get("include", [])
    return idle, slow


def episodes(notes, idle_ms):
    """(start or None, end, ended_how, pending text) per drain."""
    out = []
    open_start, pending = None, None
    for note in sorted(notes, key=lambda n: n.get("at", 0)):
        text, at = note.get("text", ""), note.get("at", 0)
        if text.startswith(START):
            if open_start is not None:
                out.append((open_start, at, "cancelled by a registration (inferred)", pending))
            open_start, pending = at, text[len(START):].split(";")[0].strip()
            continue
        if not text.startswith("daemon stopped:"):
            continue
        if BOUND in text:
            how = "bound"
        elif any(d in text for d in DRAINED):
            how = "drained"
        elif open_start is not None:
            how = "other: " + text[len("daemon stopped: "):][:60]
        else:
            continue
        start = open_start
        if start is None and how == "bound":
            start = at - idle_ms
        out.append((start, at, how, pending))
        open_start, pending = None, None
    return out


def main(commons):
    now = int(time.time() * 1000)
    print(f"at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now / 1000))} load {open('/proc/loadavg').read().split()[:3]}")
    for common in commons:
        path = os.path.join(common, "squeal", "store.sqlite")
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        db.execute("begin")
        roots = dict(db.execute("select id, root from worktrees"))
        main_root = next((r for r in roots.values() if os.path.realpath(os.path.join(r, ".git")) == os.path.realpath(common)), None)
        idle, slow = config(main_root or os.path.dirname(common))
        print(f"\n## {common}  idleExitMinutes {idle}  slow.include {slow}")
        tot = {"drains": 0, "known": 0, "minutes": 0.0, "fast_runs": 0, "fast_files": 0, "fast_s": 0.0,
               "slow_runs": 0, "slow_files": 0, "slow_s": 0.0, "results": 0, "read_later": 0,
               "fast_results": 0, "fast_read_later": 0, "later_daemon": 0}
        how_count = {}
        for key, value in db.execute("select key, value from meta where key like 'notes.%'"):
            wt = key[len("notes."):]
            try:
                notes = json.loads(value)
            except ValueError:
                continue
            for start, end, how, pending in episodes(notes, idle * 60_000):
                tot["drains"] += 1
                how_count[how] = how_count.get(how, 0) + 1
                later = db.execute("select count(*) from revisions where worktree_id = ? and created_at > ?",
                                   (wt, end + 5_000)).fetchone()[0]
                if start is None:
                    print(f"{wt} end {iso(end)} {how}: start note evicted; later revisions {later}")
                    continue
                tot["known"] += 1
                tot["minutes"] += (end - start) / 60_000
                if later:
                    tot["later_daemon"] += 1
                line = {"fast_runs": 0, "fast_files": 0, "fast_s": 0.0, "slow_runs": 0, "slow_files": 0,
                        "slow_s": 0.0, "kinds": {}, "states": {}}
                run_ids, fast_ids = [], []
                for rid, files, cp, s, e, state in db.execute(
                        "select r.id, r.test_files, c.kind, r.started_at, r.ended_at, r.end_state from runs r"
                        " left join checkpoints c on c.id = r.checkpoint_id"
                        " where r.worktree_id = ? and r.started_at >= ? and r.started_at <= ?", (wt, start, end)):
                    paths = [f["path"] for f in json.loads(files)]
                    is_slow = bool(paths) and all(any(fnmatch.fnmatch(p, g) for g in slow) for p in paths)
                    side = "slow" if is_slow else "fast"
                    line[f"{side}_runs"] += 1
                    line[f"{side}_files"] += len(paths)
                    line[f"{side}_s"] += ((e or end) - s) / 1000
                    kind = cp or "no checkpoint"
                    line["kinds"][kind] = line["kinds"].get(kind, 0) + 1
                    line["states"][state] = line["states"].get(state, 0) + 1
                    run_ids.append(rid)
                    if not is_slow:
                        fast_ids.append(rid)
                for k in ("fast_runs", "fast_files", "fast_s", "slow_runs", "slow_files", "slow_s"):
                    tot[k] += line[k]
                res = read_later(db, run_ids)
                fres = read_later(db, fast_ids)
                tot["results"] += res[0]
                tot["read_later"] += res[1]
                tot["fast_results"] += fres[0]
                tot["fast_read_later"] += fres[1]
                print(f"{wt} {iso(start)} +{(end - start) / 60_000:.1f} min {how}; pending: {pending}; "
                      f"fast {line['fast_runs']} runs/{line['fast_files']} files/{line['fast_s']:.0f} s, "
                      f"slow {line['slow_runs']} runs/{line['slow_files']} files/{line['slow_s']:.0f} s; "
                      f"checkpoints {line['kinds']}; ends {line['states']}; results {res[0]} "
                      f"(read later {res[1]}; fast {fres[0]}, read later {fres[1]}); later revisions {later}")
        db.execute("rollback")
        db.close()
        print(f"totals: {tot}")
        print(f"ended: {how_count}")


def read_later(db, run_ids):
    if not run_ids:
        return 0, 0
    marks = ",".join("?" * len(run_ids))
    total, later = db.execute(
        f"select count(*), sum(last_used_at > recorded_at + 60000) from results where run_id in ({marks})",
        run_ids).fetchone()
    return total, later or 0


def iso(ms):
    return time.strftime("%m-%dT%H:%MZ", time.gmtime(ms / 1000))


if __name__ == "__main__":
    main(sys.argv[1:])
