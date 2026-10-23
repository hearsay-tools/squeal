#!/usr/bin/env python3
"""011-161 probe: every departure drain a store copy's notes record since a time.

Throwaway. Extends 011-84's `drains-011-84.py` (copied beside it, unchanged).
Reads a COPY of a store (`store.sqlite` with `-wal` and `-shm`), a copy of
cezarion's `runs.db` for the worktrees' removal times, and a snapshot of the
run reports. Opens nothing live.

Usage: python3 -I drains.py <store-copy> <repo-root> <runs.db-copy|-> <reports-dir> <since-iso> <copied-at-epoch-ms>
Prints one JSON line per drain, then a totals line.

A drain starts at the note "the last session ended with <X> pending". It ends
at the first later note of the worktree that ends it: a "daemon stopped:"
note, or another drain's start note (a session registered between: then the
end is the first revision or run after the start that a session caused, else
unknown). A drain with neither is "open at the copy" when the daemon's heartbeat
is fresh, else "no end note". A slow file is one `slow.include` matches.

Per drain: its runs (fast or slow), wall and recorded seconds (`fileDurations`),
the minutes with no slow run in flight while slow files were pending, the
slot notes inside it, and its results: still stored, read later (a lookup
moved `last_used_at` more than 60 s past `recorded_at`), at a key another
live worktree holds, and the reports' result count beside the stored one.
"""
import calendar
import fnmatch
import json
import os
import sqlite3
import sys
import time

START = "the last session ended with "
SLOT = "the slow slot "


def iso_ms(text):
    return calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ")) * 1000


def iso(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000)) if ms else None


def how_ended(text):
    t = text[len("daemon stopped: "):]
    if "have run" in t or "is done" in t:
        return "drained"
    if "after its last session ended (daemon.idleExitMinutes)" in t:
        return "bound"
    if t.startswith("worktree root") or t.startswith("worktree entry"):
        return "worktree removed"
    if t.startswith("signal"):
        return "signal"
    if t.startswith("squeal stop"):
        return "squeal stop"
    if t.startswith("no edit, run, wait or request"):
        return "unused exit"
    if t.startswith("hooks at Squeal"):
        return "step-down"
    return "other: " + t[:60]


def removals(path):
    """worktree id -> (removed at ms, how, the task's finishedAt ms) from cezarion's runs."""
    out = {}
    if path == "-":
        return out
    db = sqlite3.connect(path)
    import hashlib
    for wt_path, data in db.execute("select worktree_path, data from runs where worktree_path is not null"):
        d = json.loads(data)
        when = d.get("worktreeReclaimedAt") or ((d.get("delegation") or {}).get("destroy") or {}).get("requestedAt")
        wid = hashlib.sha256(wt_path.encode()).hexdigest()[:16]
        fin = d.get("finishedAt")
        out[wid] = {"removed": iso_ms(when[:19] + "Z") if when else None,
                    "how": "reclaimed" if d.get("worktreeReclaimedAt") else ("destroy" if when else None),
                    "finished": iso_ms(fin[:19] + "Z") if fin else None, "status": d.get("status")}
    return out


def main(store, repo, runsdb, reports, since_iso, copied_ms):
    since, copied_ms = iso_ms(since_iso), int(copied_ms)
    with open(os.path.join(repo, "squeal.config.json")) as f:
        cfg = json.load(f)
    idle = (cfg.get("daemon") or {}).get("idleExitMinutes", 60) * 60_000
    slow_globs = (cfg.get("slow") or {}).get("include", [])
    removed = removals(runsdb)
    db = sqlite3.connect(store)
    rows = {r[0]: r for r in db.execute(
        "select id, root, is_main, daemon_socket, daemon_heartbeat_at, daemon_version from worktrees")}
    live_keys = {}
    for wt, key in db.execute("select worktree_id, key from test_file_keys where key is not null"):
        live_keys.setdefault(key, set()).add(wt)
    is_slow = lambda p: any(fnmatch.fnmatch(p, g) for g in slow_globs)
    tot = {}
    for meta_key, value in db.execute("select key, value from meta where key like 'notes.%'"):
        wt = meta_key[len("notes."):]
        notes = sorted(json.loads(value), key=lambda n: n.get("at", 0))
        row = rows.get(wt)
        root = row[1] if row else None
        kind = ("main checkout" if row and row[2] else
                "worker (.ai/cezar/worktrees)" if root and "/.ai/cezar/worktrees/" in root else
                "other" if root else "removed")
        # A drain whose start note was evicted (20 notes kept) but whose stop note names the
        # bound started `idleExitMinutes` before it, as 011-84's script reads it.
        for i, n in enumerate(notes):
            t = n.get("text", "")
            if t.startswith("daemon stopped:") and how_ended(t) == "bound" and n["at"] - idle >= since and not any(
                    m.get("text", "").startswith(START) and n["at"] - idle - 60_000 <= m["at"] <= n["at"] for m in notes[:i]):
                notes.insert(i, {"at": n["at"] - idle, "text": START + "(start note evicted; inferred from the bound) pending;"})
        for i, n in enumerate(notes):
            if not n.get("text", "").startswith(START) or n["at"] < since:
                continue
            start, pending = n["at"], n["text"][len(START):].split(" pending;")[0]
            end, how, version = None, None, None
            for m in notes[i + 1:]:
                t = m.get("text", "")
                if t.startswith("daemon stopped:"):
                    end, how = m["at"], how_ended(t)
                    version = (m.get("exitOf") or "@").split("@")[0] or None
                    break
                if t.startswith(START):
                    nxt = m["at"]
                    first = db.execute(
                        "select min(created_at) from revisions where worktree_id = ? and created_at > ? and created_at < ?",
                        (wt, start, nxt)).fetchone()[0]
                    end, how = (first, "a session registered (first revision)") if first else (None, "a session registered (time unknown)")
                    end = end or nxt
                    break
            if how is None:
                fresh = row and row[3] and row[4] and copied_ms - row[4] < 60_000
                version = row[5] if row else None
                registered = [r for (r,) in db.execute(
                    "select registered_at from consumers where worktree_id = ? and registered_at > ?", (wt, start))]
                first = db.execute("select min(created_at) from revisions where worktree_id = ? and created_at > ?",
                                   (wt, start)).fetchone()[0]
                if fresh and (registered or copied_ms - start > idle):
                    # The daemon serves on past the bound or with a consumer: a session came back, with no note.
                    end = min([x for x in registered + [first] if x] or [copied_ms])
                    how = "a session registered (no note; consumer or revision at the copy)"
                elif fresh:
                    how, end = "open at the copy", copied_ms
                else:
                    how, end = "no end note", min(start + idle, copied_ms)
            elif how == "unused exit":
                # The unused check skips a drain (`lifecycle.ts`): a session registered first.
                how = "a session registered, then the unused exit"
            window_end = min(end, start + idle) if how != "open at the copy" else end
            runs = []
            for rid, files, s, e, state, ck in db.execute(
                    "select r.id, r.test_files, r.started_at, r.ended_at, r.end_state, c.kind from runs r"
                    " left join checkpoints c on c.id = r.checkpoint_id"
                    " where r.worktree_id = ? and r.started_at >= ? and r.started_at <= ?", (wt, start, window_end)):
                paths = [x["path"] for x in json.loads(files)]
                slow = bool(paths) and all(is_slow(p) for p in paths)
                rec, reported = 0.0, 0
                rp = os.path.join(reports, rid, "report.json")
                if os.path.exists(rp):
                    with open(rp) as f:
                        rep = json.load(f)["report"]
                    rec = sum(x["durationMs"] for x in rep.get("fileDurations", [])) / 1000
                    reported = len(rep.get("results", []))
                runs.append({"id": rid, "slow": slow, "files": len(paths), "start": s, "end": e or window_end,
                             "state": state, "checkpoint": ck, "recorded_s": rec, "reported": reported, "report": os.path.exists(rp)})
            slow_busy = union([(r["start"], r["end"]) for r in runs if r["slow"]], start, window_end)
            fast_busy = union([(r["start"], r["end"]) for r in runs if not r["slow"]], start, window_end)
            both_busy = union([(r["start"], r["end"]) for r in runs], start, window_end)
            minutes = (window_end - start) / 60_000
            slots = sum(1 for m in notes if m.get("text", "").startswith(SLOT) and start <= m["at"] <= window_end)
            res = results(db, [r["id"] for r in runs], wt, live_keys)
            for r in runs:
                r.update(results(db, [r["id"]], wt, live_keys))
            rem = removed.get(wt, {})
            line = {
                "store": os.path.basename(os.path.dirname(store)), "wt": wt, "kind": kind, "root": root,
                "version": version, "start": iso(start), "pending": pending, "ended": how, "end": iso(end),
                "minutes": round(minutes, 1),
                "runs_fast": sum(1 for r in runs if not r["slow"]), "runs_slow": sum(1 for r in runs if r["slow"]),
                "files_fast": sum(r["files"] for r in runs if not r["slow"]),
                "files_slow": sum(r["files"] for r in runs if r["slow"]),
                "wall_fast_s": round(sum((r["end"] - r["start"]) / 1000 for r in runs if not r["slow"])),
                "wall_slow_s": round(sum((r["end"] - r["start"]) / 1000 for r in runs if r["slow"])),
                "recorded_s": round(sum(r["recorded_s"] for r in runs)),
                "reports_missing": sum(1 for r in runs if not r["report"]),
                "run_states": count(r["state"] for r in runs), "checkpoints": count(r["checkpoint"] for r in runs),
                "min_no_run": round(minutes - both_busy / 60_000, 1),
                "min_no_slow_run": round(minutes - slow_busy / 60_000, 1),
                "min_fast_run": round(fast_busy / 60_000, 1),
                "slot_notes": slots, "reported_results": sum(r["reported"] for r in runs), **res,
                "removed_at": iso(rem.get("removed")), "removed_how": rem.get("how"),
                "task_finished": iso(rem.get("finished")),
                "min_departure_to_removal": round((rem["removed"] - start) / 60_000, 1) if rem.get("removed") else None,
                "root_exists_at_copy": os.path.exists(os.path.join(root, ".git")) if root else False,
                "start_ms": start, "window_end_ms": window_end,
                "run_list": [{k: r[k] for k in ("slow", "files", "start", "end", "recorded_s", "results", "read_later",
                                                "key_held_elsewhere")} for r in runs],
            }
            print(json.dumps(line))
            for k, v in line.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool) and not k.endswith("_ms"):
                    tot[k] = tot.get(k, 0) + v
            tot["drains"] = tot.get("drains", 0) + 1
            tot.setdefault("ended", {})[how] = tot.setdefault("ended", {}).get(how, 0) + 1
    print(json.dumps({"totals": tot}))


def results(db, run_ids, wt, live_keys):
    if not run_ids:
        return {"results": 0, "read_later": 0, "key_held_elsewhere": 0}
    marks = ",".join("?" * len(run_ids))
    total, later, elsewhere = 0, 0, 0
    for key, rec, used in db.execute(
            f"select key, recorded_at, last_used_at from results where run_id in ({marks})", run_ids):
        total += 1
        later += used is not None and used > rec + 60_000
        elsewhere += bool(live_keys.get(key, set()) - {wt})
    return {"results": total, "read_later": later, "key_held_elsewhere": elsewhere}


def union(spans, lo, hi):
    spans = sorted((max(lo, a), min(hi, b)) for a, b in spans if b > lo and a < hi)
    total, cur_a, cur_b = 0, None, None
    for a, b in spans:
        if cur_b is None or a > cur_b:
            if cur_b is not None:
                total += cur_b - cur_a
            cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    if cur_b is not None:
        total += cur_b - cur_a
    return total


def count(items):
    out = {}
    for x in items:
        out[str(x)] = out.get(str(x), 0) + 1
    return out


if __name__ == "__main__":
    main(*sys.argv[1:7])
