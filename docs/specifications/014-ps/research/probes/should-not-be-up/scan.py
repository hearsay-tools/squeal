"""Throwaway probe for research 014-03: apply the should-not-be-up rules to this host, read-only.

Reads /proc, the runtime and temp directories, and each Squeal store opened `mode=ro`.
Never connects to a socket, never signals or renices, writes only the --out file.
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time

CLK = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")
UID = os.getuid()
HOME = os.path.expanduser("~")
RUNTIME = os.environ.get("XDG_RUNTIME_DIR") or f"/tmp/squeal-{UID}"
USER_TMP = f"/tmp/squeal-{UID}"
SYSTEMD_USER = None  # pid of `systemd --user`, the reaper daemons are reparented to

with open("/proc/stat") as f:
    BTIME = next(int(l.split()[1]) for l in f if l.startswith("btime"))

NOW = time.time()
NOW_MS = int(NOW * 1000)
timings = {}


def timed(name):
    def wrap(fn):
        def run(*a, **k):
            t = time.perf_counter()
            try:
                return fn(*a, **k)
            finally:
                timings[name] = round((time.perf_counter() - t) * 1000, 1)
        return run
    return wrap


def read(path, mode="r"):
    try:
        with open(path, mode) as f:
            return f.read()
    except OSError:
        return None


def vkey(v):
    return tuple(int(x) for x in v.split(".")) if v and re.fullmatch(r"\d+\.\d+\.\d+", v) else None


@timed("proc_table_ms")
def proc_table():
    table = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        stat = read(f"/proc/{pid}/stat")
        raw = read(f"/proc/{pid}/cmdline", "rb")
        if stat is None or raw is None:
            continue
        rest = stat[stat.rindex(")") + 2:].split()
        start = BTIME + int(rest[19]) / CLK
        table[pid] = {
            "pid": pid,
            "state": rest[0],
            "ppid": int(rest[1]),
            "pgid": int(rest[2]),
            "sid": int(rest[3]),
            "nice": int(rest[16]),
            "start_ticks": int(rest[19]),
            "age_s": round(NOW - start),
            "cpu_s": round((int(rest[11]) + int(rest[12])) / CLK, 1),
            "rss_mib": round(int(rest[21]) * PAGE / 2**20),
            "argv": [a.decode(errors="replace") for a in raw.split(b"\0") if a],
        }
    return table


def environ(pid):
    raw = read(f"/proc/{pid}/environ", "rb")
    if raw is None:
        return {}
    out = {}
    for item in raw.split(b"\0"):
        if b"=" in item:
            k, v = item.split(b"=", 1)
            out[k.decode(errors="replace")] = v.decode(errors="replace")
    return out


def fds(pid):
    out = []
    try:
        names = os.listdir(f"/proc/{pid}/fd")
    except OSError:
        return out
    for n in names:
        try:
            out.append(os.readlink(f"/proc/{pid}/fd/{n}"))
        except OSError:
            pass
    return out


@timed("locks_ms")
def posix_locks():
    """inode -> set of pids holding a POSIX lock on it."""
    held = {}
    for line in (read("/proc/locks") or "").splitlines():
        parts = line.split()
        if len(parts) < 6 or parts[1] not in ("POSIX", "OFDLCK"):
            continue
        inode = int(parts[5].split(":")[2])
        held.setdefault(inode, set()).add(int(parts[4]))
    return held


@timed("unix_ms")
def listening_unix():
    """socket path -> set of inodes listening on it."""
    out = {}
    for line in (read("/proc/net/unix") or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 8 and int(parts[3], 16) & 0x10000:
            out.setdefault(parts[7], set()).add(parts[6])
    return out


def installed_versions():
    """Per harness, the version a new session loads (the launcher's rule, 005 D3)."""
    out = {}
    raw = read(f"{HOME}/.claude/plugins/installed_plugins.json")
    if raw:
        for entry in json.loads(raw).get("plugins", {}).get("squeal@hearsay", []):
            if entry.get("scope") == "user":
                out["claude-code"] = entry.get("version")
                break
    cache = f"{HOME}/.codex/plugins/cache/hearsay/squeal"
    if os.path.isdir(cache):
        vs = sorted((v for v in os.listdir(cache) if vkey(v)), key=vkey)
        if vs:
            out["codex"] = vs[-1]
    return out


def common_dir_of(root):
    dotgit = os.path.join(root, ".git")
    if os.path.isdir(dotgit):
        return dotgit, None
    text = read(dotgit)
    if not text or not text.startswith("gitdir:"):
        return None, None
    gitdir = text.split(":", 1)[1].strip()
    common = read(os.path.join(gitdir, "commondir"))
    if common is None:
        return None, gitdir
    return os.path.normpath(os.path.join(gitdir, common.strip())), gitdir


def store_rows(common):
    path = os.path.join(common, "squeal", "store.sqlite")
    if not os.path.exists(path):
        return None
    t = time.perf_counter()
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    try:
        db.execute("begin")
        rows = {
            "worktrees": {r[0]: dict(zip(("id", "root", "socket", "started", "heartbeat", "interval", "version"), r))
                          for r in db.execute("select id, root, daemon_socket, daemon_started_at, daemon_heartbeat_at,"
                                              " daemon_heartbeat_interval_ms, daemon_version from worktrees")},
            "consumers": [dict(zip(("wt", "session", "agent", "registered", "seen", "delivered"), r))
                          for r in db.execute("select * from consumers")],
            "meta": dict(db.execute(
                "select key, value from meta where key like 'harness-process:%' or key like 'consumer-version:%'"
                " or key like 'departed:%' or key like 'daemon-token:%' or key like 'daemon-stopped:%'"
                " or key like 'slow-tier:%' or key like 'daemon-handoff:%'")),
            "revision": dict(db.execute("select worktree_id, max(created_at) from revisions group by worktree_id")),
            "open_runs": dict(db.execute(
                "select worktree_id, min(started_at) from runs where ended_at is null group by worktree_id")),
            "last_run_end": dict(db.execute("select worktree_id, max(ended_at) from runs group by worktree_id")),
        }
        db.execute("rollback")
    finally:
        db.close()
    timings[f"store_ms:{common}"] = round((time.perf_counter() - t) * 1000, 1)
    return rows


def policy(root):
    out = {"idleExitMinutes": 60, "unusedExitMinutes": 30, "timeoutMs": 600000}
    raw = read(os.path.join(root, "squeal.config.json"))
    try:
        cfg = json.loads(raw) if raw else {}
    except ValueError:
        cfg = {}
    out.update({k: v for k, v in (cfg.get("daemon") or {}).items() if k in out})
    if isinstance((cfg.get("runner") or {}).get("timeoutMs"), int):
        out["timeoutMs"] = cfg["runner"]["timeoutMs"]
    return out


def main():
    global SYSTEMD_USER
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--sizes", action="store_true", help="also sum the size of leftover temp dirs (slow)")
    args = ap.parse_args()
    t0 = time.perf_counter()

    load = read("/proc/loadavg").split()[:3]
    psi = (read("/proc/pressure/cpu") or "").splitlines()[:1]
    procs = proc_table()
    SYSTEMD_USER = next((p["pid"] for p in procs.values()
                         if p["argv"][:1] == ["/usr/lib/systemd/systemd"] and "--user" in p["argv"]), None)
    locks = posix_locks()
    unix = listening_unix()
    installed = installed_versions()
    flags = []

    def flag(rule, subject, detail, end, **extra):
        flags.append({"rule": rule, "subject": subject, "detail": detail, "end": end, **extra})

    # Daemons: a `squeal.mjs daemon <root>` argv.
    daemons = []
    for p in procs.values():
        a = p["argv"]
        for i, word in enumerate(a[:-2]):
            if word.endswith("squeal.mjs") and a[i + 1] == "daemon":
                m = re.search(r"/squeal/(\d+\.\d+\.\d+)/dist/", word)
                harness = "claude-code" if "/.claude/" in word else "codex" if "/.codex/" in word else "other"
                daemons.append({**p, "bundle": os.path.dirname(os.path.dirname(word)), "version": m and m.group(1),
                                "harness": harness, "root": a[i + 2], "await_lock": "--await-lock" in a})
                break

    t = time.perf_counter()
    stores, by_root = {}, {}
    for d in daemons:
        common, gitdir = common_dir_of(d["root"]) if os.path.isdir(d["root"]) else (None, None)
        own = fds(d["pid"])
        lockfile = next((f for f in own if re.search(r"/squeal/locks/[0-9a-f]{16}\.sqlite$", f)), None)
        if common is None and lockfile:
            common = lockfile.split("/squeal/locks/")[0]
        d["common"], d["gitdir"], d["lockfile"] = common, gitdir, lockfile
        d["socket_inodes"] = {f[8:-1] for f in own if f.startswith("socket:[")}
        if common and common not in stores:
            stores[common] = store_rows(common)
        by_root.setdefault(d["root"], []).append(d)
    timings["daemon_fds_and_stores_ms"] = round((time.perf_counter() - t) * 1000, 1)

    tokens = {}  # token -> (common, worktree id, startedAt)
    for common, rows in stores.items():
        for k, v in (rows or {}).get("meta", {}).items():
            if k.startswith("daemon-token:"):
                try:
                    j = json.loads(v)
                    tokens[j["token"]] = (common, k.split(":", 1)[1], j.get("startedAt"))
                except (ValueError, KeyError, TypeError):
                    pass

    live_keys, live_by_wt = set(), {}
    for d in daemons:
        rows = stores.get(d["common"]) or {}
        wt = next((w for w in rows.get("worktrees", {}).values() if w["root"] == d["root"]), None)
        d["wt"] = wt and wt["id"]
        live_by_wt[(d["common"], d["wt"])] = d
        pol = policy(d["root"])
        d["policy"] = pol
        held = False
        if d["lockfile"]:
            try:
                held = d["pid"] in locks.get(os.stat(d["lockfile"]).st_ino, set())
            except OSError:
                pass
        d["holds_lock"] = held
        if d["common"]:
            rid = read(os.path.join(d["common"], "squeal", "repository-id"))
            if rid:
                live_keys.add(hashlib.sha256(f"{rid.strip()}\0{d['root']}".encode()).hexdigest()[:16])
        cons = [c for c in rows.get("consumers", []) if c["wt"] == d["wt"]]
        meta = rows.get("meta", {})
        procs_rec = json.loads(meta.get(f"harness-process:{d['wt']}", "{}") or "{}")
        versions = json.loads(meta.get(f"consumer-version:{d['wt']}", "{}") or "{}")
        dead = []
        for key, rec in procs_rec.items():
            q = procs.get(rec.get("pid"))
            if q is None or q["start_ticks"] != rec.get("startTime") or q["state"] == "Z":
                dead.append(key.replace("\n", "/"))
        d["consumers"] = len(cons)
        d["consumer_versions"] = sorted(set(versions.values()))
        d["dead_harness"] = dead
        started_ms = int((NOW - d["age_s"]) * 1000)
        last = max(filter(None, [started_ms, rows.get("revision", {}).get(d["wt"]),
                                 rows.get("last_run_end", {}).get(d["wt"]),
                                 *[c["seen"] for c in cons], *[c["delivered"] or 0 for c in cons]]))
        if rows.get("open_runs", {}).get(d["wt"]):
            last = NOW_MS
        d["quiet_min"] = round((NOW_MS - last) / 60000, 1)
        departed = meta.get(f"departed:{d['wt']}")
        d["departed_min"] = round((NOW_MS - int(departed)) / 60000, 1) if departed and departed.isdigit() else None
        d["open_run"] = bool(rows.get("open_runs", {}).get(d["wt"]))
        d["heartbeat_age_s"] = wt and wt["heartbeat"] and round((NOW_MS - wt["heartbeat"]) / 1000)
        d["recorded"] = bool(wt and wt["socket"])
        d["listening"] = any(d["socket_inodes"] & inodes for inodes in unix.values())

        subj = f"daemon {d['pid']} {d['version']} {d['root']}"
        stop = f"squeal stop {d['root']}"
        if not os.path.isdir(d["root"]):
            flag("root-gone", subj, "root directory is missing; the daemon exits within one check (5 s)",
                 f"kill {d['pid']}")
        elif d["gitdir"] and not os.path.isdir(d["gitdir"]):
            flag("root-gone", subj, f"worktree entry {d['gitdir']} is missing", f"kill {d['pid']}")
        if not os.path.isdir(d["bundle"]):
            flag("install-gone", subj, f"its bundle {d['bundle']} is gone; it exits `reinstalled`", stop)
        inst = installed.get(d["harness"])
        if inst and vkey(d["version"]) and vkey(d["version"]) < vkey(inst):
            older = [v for v in d["consumer_versions"] if vkey(v) and vkey(v) < vkey(inst)]
            flag("older-release", subj,
                 f"{d['harness']} installs {inst}; consumer versions {d['consumer_versions'] or 'none'}"
                 + ("; an older consumer is registered, so no step-down is asked (C9)" if older else ""),
                 stop, healthy_reason="older consumer registered" if older else None)
        if not d["holds_lock"] and d["age_s"] > (130 if d["await_lock"] else 40):
            flag("no-lock", subj, f"holds no worktree lock after {d['age_s']} s"
                 + (" (a successor waits at most 120 s)" if d["await_lock"] else " (a loser retries at most 30 s)"),
                 f"kill {d['pid']}")
        if d["holds_lock"] and d["heartbeat_age_s"] is not None and wt["interval"] and \
                d["heartbeat_age_s"] * 1000 > 2 * wt["interval"] and d["recorded"]:
            flag("hung", subj, f"heartbeat {d['heartbeat_age_s']} s old, interval {wt['interval']} ms",
                 f"kill {d['pid']}")
        if d["consumers"] == 0 and not d["open_run"] and d["quiet_min"] > pol["idleExitMinutes"] + 1:
            flag("past-idle-exit", subj, f"no consumer, quiet {d['quiet_min']} min > daemon.idleExitMinutes "
                 f"{pol['idleExitMinutes']}", stop)
        elif d["consumers"] == 0 and d["departed_min"] is not None and \
                d["departed_min"] * 60 < d["age_s"] and d["departed_min"] > 0.5:
            slow = meta.get(f"slow-tier:{d['wt']}")
            d["slow_tier"] = slow
            if slow not in (None, "null") and d["departed_min"] <= pol["idleExitMinutes"] + 1:
                flag("draining", subj, f"last consumer left {d['departed_min']} min ago; slow lane {slow}; "
                     f"exits by rule when the slow files ran or at {pol['idleExitMinutes']} min "
                     f"({round(pol['idleExitMinutes'] - d['departed_min'])} min left)", stop, level="info")
            else:
                flag("past-departure", subj, f"last consumer left {d['departed_min']} min ago, slow lane {slow} "
                     f"(3 s grace; a slow drain holds it up to daemon.idleExitMinutes)", stop)
        if d["consumers"] > 0 and d["quiet_min"] > pol["unusedExitMinutes"] + 1:
            flag("past-unused-exit", subj, f"{d['consumers']} consumer(s), quiet {d['quiet_min']} min > "
                 f"daemon.unusedExitMinutes {pol['unusedExitMinutes']} (store evidence only)", stop)
        if dead:
            flag("dead-consumer", subj, f"consumers whose harness process is gone: {dead}",
                 "none needed: the daemon drops them at its next heartbeat")

    for root, ds in by_root.items():
        if len(ds) > 1:
            flag("duplicate", f"root {root}", "daemons " + ", ".join(
                f"{d['pid']} {d['version']} lock={d['holds_lock']} age={d['age_s']}s" for d in ds),
                 "; ".join(f"kill {d['pid']}" for d in ds if not d["holds_lock"]) or "none")

    # Test processes: carriers of SQUEAL_DAEMON_CHILD, and members of a daemon's session.
    t = time.perf_counter()
    daemon_pids = {d["pid"] for d in daemons}
    tests = []
    for p in procs.values():
        if p["pid"] in daemon_pids:
            continue
        env = environ(p["pid"])
        token = env.get("SQUEAL_DAEMON_CHILD")
        if token is None and p["sid"] not in daemon_pids:
            continue
        owner = None
        if token:
            tok, _, lane = token.partition(":")
            info = tokens.get(tok)
            d = info and live_by_wt.get((info[0], info[1]))
            # startedAt is stamped after Node starts and takes the lock: seconds after
            # the process start under load (6 s seen at load 45).
            if d and info[2] and -2 <= info[2] / 1000 - (NOW - d["age_s"]) <= 120:
                owner = d
        elif p["sid"] in daemon_pids:
            owner = next(d for d in daemons if d["pid"] == p["sid"])
        tests.append({"pid": p["pid"], "ppid": p["ppid"], "sid": p["sid"], "age_s": p["age_s"], "nice": p["nice"],
                      "rss_mib": p["rss_mib"], "token": token, "owner": owner and owner["pid"],
                      "argv": " ".join(p["argv"])[:120]})
        subj = f"process {p['pid']} ({' '.join(p['argv'])[:60]})"
        if owner is None:
            flag("orphan-test-process", subj, f"carries {token or 'no token'}; no live daemon owns it; "
                 f"parent {p['ppid']}, age {p['age_s']} s", f"kill {p['pid']}")
        elif token and p["age_s"] * 1000 > owner["policy"]["timeoutMs"] + 60000 and p["ppid"] != owner["pid"]:
            flag("overdue-test-process", subj, f"{p['age_s']} s old > runner.timeoutMs "
                 f"{owner['policy']['timeoutMs'] // 1000} s and not the daemon's child", f"kill {p['pid']}")
    timings["test_process_scan_ms"] = round((time.perf_counter() - t) * 1000, 1)

    # Waiters (Claude Code's idle waiter, 012 CC4).
    for p in procs.values():
        if any(a.endswith("/dist/waiter.mjs") for a in p["argv"]):
            parent = procs.get(p["ppid"])
            if p["ppid"] in (1, SYSTEMD_USER) or parent is None:
                flag("orphan-waiter", f"waiter {p['pid']}", f"parent gone, age {p['age_s']} s", f"kill {p['pid']}")

    # Files: sockets, pool marks and permits, temp dirs, e2e fixtures, session roots.
    t = time.perf_counter()
    for base in {RUNTIME, USER_TMP}:
        try:
            names = os.listdir(base)
        except OSError:
            continue
        for n in names:
            if re.fullmatch(r"squeal-[0-9a-f]{16}\.sock", n):
                # A daemon binds a hidden name and renames it into place (server.ts), so
                # /proc/net/unix never shows this path: a file is stale when no live
                # daemon of its worktree id holds its lock.
                path = os.path.join(base, n)
                if n[7:23] not in {d["wt"] for d in daemons if d["holds_lock"]}:
                    st = os.stat(path)
                    flag("stale-socket", path, f"no live daemon of worktree {n[7:23]}; created "
                         f"{time.strftime('%F %T', time.localtime(st.st_mtime))}", f"rm {path}")
    slot_dir = os.path.join(RUNTIME, "squeal") if os.environ.get("XDG_RUNTIME_DIR") else USER_TMP
    permits = {}
    for n in sorted(os.listdir(slot_dir)) if os.path.isdir(slot_dir) else []:
        path = os.path.join(slot_dir, n)
        if n.startswith("pool.mark.") and not n.endswith(".tmp"):
            age = NOW - os.stat(path).st_mtime
            if age > 30:
                flag("stale-pool-mark", path, f"{round(age / 3600, 1)} h old; readers skip marks older than 30 s",
                     f"rm {path}")
        elif re.fullmatch(r"(pool|slow)(\.\d+)?\.lock", n):
            holders = locks.get(os.stat(path).st_ino, set())
            permits[n] = sorted(holders)
            strangers = [h for h in holders if h not in daemon_pids]
            if strangers:
                flag("permit-held-by-non-daemon", path, f"held by {strangers}", f"kill {' '.join(map(str, strangers))}")
    tmp_root = os.path.join(USER_TMP, "tmp")
    left = []
    for n in os.listdir(tmp_root) if os.path.isdir(tmp_root) else []:
        key = n.split(".old-")[0]
        if key not in live_keys:
            left.append((n, os.stat(os.path.join(tmp_root, n)).st_mtime))
    size = None
    if args.sizes:
        size = 0
        for n, _ in left:
            for dp, _, files in os.walk(os.path.join(tmp_root, n)):
                for f in files:
                    try:
                        size += os.lstat(os.path.join(dp, f)).st_size
                    except OSError:
                        pass
    if left:
        oldest = min(m for _, m in left)
        flag("leftover-temp-dirs", tmp_root, f"{len(left)} of {len(left) + len(live_keys)} key dirs belong to no live "
             f"daemon; oldest {time.strftime('%F', time.localtime(oldest))}"
             + (f"; {round(size / 2**20)} MiB" if size is not None else ""),
             f"rm -rf {tmp_root}/<key> for each listed key", count=len(left))
    referenced = " ".join(" ".join(p["argv"]) for p in procs.values())
    cwds = set()
    for p in procs.values():
        try:
            cwds.add(os.readlink(f"/proc/{p['pid']}/cwd"))
        except OSError:
            pass
    e2e = [os.path.join("/tmp", n) for n in os.listdir("/tmp") if re.match(r"squeal-e2e-(oc-|pi-)?[A-Za-z0-9]{6}$", n)]
    idle_e2e = [d for d in e2e if d not in referenced and not any(c.startswith(d) for c in cwds)]
    if idle_e2e:
        flag("leftover-e2e-fixtures", "/tmp/squeal-e2e-*", f"{len(idle_e2e)} of {len(e2e)} fixture dirs used by no "
             "live process", "rm -rf /tmp/squeal-e2e-<id> for each", count=len(idle_e2e))
    fallbacks = [n for n in os.listdir("/tmp") if re.fullmatch(rf"squeal-{UID}-[0-9a-f]{{16}}-\w{{6}}", n)]
    for n in fallbacks:
        flag("fallback-temp-dir", f"/tmp/{n}", "a daemon's private temp dir, used when /tmp/squeal-<uid> was refused",
             f"rm -rf /tmp/{n}")
    sessions = os.path.join(RUNTIME, "squeal-sessions")
    gone = 0
    for n in os.listdir(sessions) if os.path.isdir(sessions) else []:
        try:
            if not os.path.isdir(json.loads(read(os.path.join(sessions, n)) or "{}").get("root", "/")):
                gone += 1
        except ValueError:
            pass
    if gone:
        flag("stale-session-root", sessions, f"{gone} session root files name a missing root",
             "none needed: ignored when read", count=gone)
    timings["files_ms"] = round((time.perf_counter() - t) * 1000, 1)
    timings["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    report = {
        "at": time.strftime("%FT%TZ", time.gmtime(NOW)), "load": load, "cpu_pressure": psi,
        "processes": len(procs), "installed": installed, "daemons": [
            {k: d[k] for k in ("pid", "version", "harness", "root", "age_s", "rss_mib", "cpu_s", "nice", "holds_lock",
                               "recorded", "listening", "heartbeat_age_s", "consumers", "consumer_versions",
                               "dead_harness", "quiet_min", "departed_min", "open_run", "await_lock")}
            for d in sorted(daemons, key=lambda d: d["age_s"], reverse=True)],
        "test_processes": tests, "permits": permits, "flags": flags, "timings_ms": timings,
    }
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=1, default=str)

    print(f"at {report['at']}  load {' '.join(load)}  {psi[0] if psi else ''}  processes {len(procs)}")
    print(f"installed: {installed}")
    print(f"{'PID':>8} {'VERSION':8} {'HARNESS':11} {'AGE':>6} {'RSS':>6} {'LOCK':4} {'CONS':>4} {'QUIET':>6} ROOT")
    for d in report["daemons"]:
        print(f"{d['pid']:>8} {d['version']:8} {d['harness']:11} {d['age_s'] // 60:>5}m {d['rss_mib']:>5}M "
              f"{'yes' if d['holds_lock'] else 'NO':4} {d['consumers']:>4} {d['quiet_min']:>5}m {d['root']}")
    print(f"test processes: {len(tests)} ({sum(1 for t in tests if t['owner'] is None)} without a live daemon)")
    print(f"permits held: { {k: v for k, v in permits.items() if v} }")
    print("FLAGS")
    for fl in flags:
        print(f"  [{fl['rule']}{' (info)' if fl.get('level') == 'info' else ''}] {fl['subject']}\n      {fl['detail']}\n      end: {fl['end']}")
    print(f"timings ms: {timings}")


if __name__ == "__main__":
    sys.exit(main())
