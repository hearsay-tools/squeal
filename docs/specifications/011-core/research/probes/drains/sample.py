#!/usr/bin/env python3
"""011-161 probe: /proc samples of every Squeal daemon and its test processes,
with the load, and a copy of each store every few samples.

Throwaway. Read-only on the live system: it reads /proc and stats worktree
roots; it copies each store (`store.sqlite` with `-wal` and `-shm`) into the
scratch directory, reads the copy, keeps what it needs as JSON and deletes the
copy. It opens no live store, no socket and no permit pool, and signals nothing.

Usage: nice -n 10 python3 -I sample.py <scratch-dir> <samples> <interval-s> <copy-every> <repo-dir>...
Writes <scratch-dir>/samples.jsonl (one line per sample) and
<scratch-dir>/stores/<n>-<repo>.json (one per store copy).
"""
import json
import os
import shutil
import sqlite3
import sys
import time

TICK = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")


def read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def procs():
    """pid -> (ppid, cmdline list, utime+stime ticks, rss bytes, start ticks)."""
    out = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        stat = read(f"/proc/{name}/stat")
        if stat is None:
            continue
        stat = stat.decode(errors="replace")
        rest = stat[stat.rfind(")") + 2:].split()
        cmd = read(f"/proc/{name}/cmdline") or b""
        out[int(name)] = {
            "ppid": int(rest[1]),
            "args": [a.decode(errors="replace") for a in cmd.split(b"\0") if a],
            "cpu": int(rest[11]) + int(rest[12]),
            "rss": int(rest[21]) * PAGE,
            "start": int(rest[19]),
        }
    return out


def pss(pid):
    raw = read(f"/proc/{pid}/smaps_rollup")
    if raw is None:
        return None
    for line in raw.decode().splitlines():
        if line.startswith("Pss:"):
            return int(line.split()[1]) * 1024
    return None


def daemon_root(args):
    if len(args) < 3:
        return None
    for i, a in enumerate(args[:-1]):
        if a == "daemon" and ("squeal" in args[i - 1] if i > 0 else False):
            return args[i + 1]
    return None


def sample():
    table = procs()
    kids = {}
    for pid, p in table.items():
        kids.setdefault(p["ppid"], []).append(pid)
    daemons = []
    for pid, p in table.items():
        root = daemon_root(p["args"])
        if root is None:
            continue
        tree, todo = [], list(kids.get(pid, []))
        while todo:
            c = todo.pop()
            tree.append(c)
            todo.extend(kids.get(c, []))
        version = next((s for s in p["args"][1].split("/") if s.count(".") == 2 and s[0].isdigit()), None)
        daemons.append({
            "pid": pid, "root": root, "version": version, "cpu_ticks": p["cpu"], "rss": p["rss"],
            "pss": pss(pid), "start_ticks": p["start"], "root_exists": os.path.exists(os.path.join(root, ".git")),
            "children": [{"pid": c, "comm": (table[c]["args"] or ["?"])[0][-40:], "cpu_ticks": table[c]["cpu"],
                          "rss": table[c]["rss"], "pss": pss(c)} for c in tree if c in table],
        })
    mem = {}
    for line in (read("/proc/meminfo") or b"").decode().splitlines():
        k, v = line.split(":", 1)
        if k in ("MemTotal", "MemAvailable", "SwapFree", "SwapTotal"):
            mem[k] = int(v.split()[0]) * 1024
    return {"at": time.time(), "load": (read("/proc/loadavg") or b"").decode().split()[:3],
            "mem": mem, "daemons": daemons}


def copy_store(scratch, n, repo):
    src = os.path.join(repo, ".git", "squeal")
    dst = os.path.join(scratch, "copy", os.path.basename(repo))
    os.makedirs(dst, exist_ok=True)
    t0 = time.time()
    for f in ("store.sqlite", "store.sqlite-wal", "store.sqlite-shm"):
        if os.path.exists(os.path.join(src, f)):
            shutil.copyfile(os.path.join(src, f), os.path.join(dst, f))
    t1 = time.time()
    db = sqlite3.connect(os.path.join(dst, "store.sqlite"))
    keep = {"copied": [t0, t1], "repo": repo}
    keep["worktrees"] = [dict(zip(("id", "root", "is_main", "socket", "started", "heartbeat", "version"), r))
                         for r in db.execute("select id, root, is_main, daemon_socket, daemon_started_at,"
                                             " daemon_heartbeat_at, daemon_version from worktrees")]
    keep["consumers"] = [dict(zip(("wt", "session", "registered", "seen"), r))
                         for r in db.execute("select worktree_id, session_id, registered_at, last_seen_at from consumers")]
    keep["meta"] = {k: v for k, v in db.execute(
        "select key, value from meta where key like 'notes.%' or key like 'slow-tier:%' or key like 'departed:%'")}
    keep["runs"] = [dict(zip(("id", "wt", "files", "started", "ended", "state"), r)) for r in db.execute(
        "select id, worktree_id, test_files, started_at, ended_at, end_state from runs where started_at > ?",
        ((t0 - 6 * 3600) * 1000,))]
    db.close()
    shutil.rmtree(dst)
    with open(os.path.join(scratch, "stores", f"{n:02d}-{os.path.basename(repo)}.json"), "w") as f:
        json.dump(keep, f)


def main(scratch, samples, interval, every, repos):
    os.makedirs(os.path.join(scratch, "stores"), exist_ok=True)
    with open(os.path.join(scratch, "samples.jsonl"), "a") as out:
        for i in range(samples):
            started = time.time()
            if i % every == 0:
                for repo in repos:
                    try:
                        copy_store(scratch, i // every, repo)
                    except Exception as error:  # a copy that fails is one missing point, not the end
                        print(f"copy {repo} failed: {error}", file=sys.stderr)
            out.write(json.dumps(sample()) + "\n")
            out.flush()
            time.sleep(max(0, interval - (time.time() - started)))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), sys.argv[5:])
