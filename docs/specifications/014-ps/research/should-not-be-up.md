# 014-03 What should not be up, and how others list it

Researcher, 2026-10-21. Source examined: this checkout at `9060a96c9` (main, 0.1.235 code). Host: the 24-CPU shared host, installed Squeal 0.1.235 (Claude Code and Codex), one live 0.1.234 daemon. Probe: `probes/should-not-be-up/scan.py`, read-only (README there); its outputs `scan-sizes-20261021T0818Z.txt` (load 41.60) and `scan-20261021T0822Z.txt` (load 24.05) are committed.

## Answers

| # | Question | Answer |
|---|---|---|
| 1 | The list | 19 flags: 11 for daemons and their consumers, 3 for processes, 5 for files. Each has a read-only rule from `/proc`, `/proc/locks`, `ls`/`stat` and a `mode=ro` store read. One more state, "draining", is information, not a flag. Lock files and permit files never get a flag: the OS frees their locks when the holder dies. |
| 2 | The host now | 21 daemons. None breaks an exit rule. 4 are in a departure drain (24% of daemon RSS). The one 0.1.234 daemon left is right to be alive. The other 0.1.234 daemon spent its full 60-minute drain and finished nothing. The files: 1 stale socket, 1 stale pool mark, 3,446 temp key dirs (149 MiB) and 84 e2e fixture dirs (6.3 GiB). |
| 3 | Time bounds | 11 flags need a bound. Six come from settings: `daemon.idleExitMinutes`, `daemon.unusedExitMinutes`, `runner.timeoutMs` and the heartbeat interval. The rest come from constants in 011 C9/C10. |
| 4 | Prior art | Docker, pm2 and Gradle list one row per process and show state as one column. Docker and pm2 add a JSON form. Docker, pm2 and Watchman cover the host by default. Gradle and Nx cover the version or the workspace, and Gradle documents the blind spot this causes. |

## 1. The list

Tags: **E** verified by experiment on this host (the probe), **S** read in source code at `9060a96c9` or the specs, **I** inferred.

The rule column describes what `scan.py` does, except for the test-daemon rule, which `scan.py` does not implement. A daemon is a process with `…/squeal.mjs daemon <root>` in its argv. Its worktree id is the name of its lock file in `<common>/squeal/locks/<id>.sqlite`, read from its fds. It "holds the lock" when `/proc/locks` lists its pid on that file's inode (E).

| Flag | Source | Read-only rule | Cost when true | Healthy states it could flag | Ends it |
|---|---|---|---|---|---|
| root-gone | C9 (`root-removed`, `worktree-removed`); `lifecycle.ts` checks every ≤5 s (S) | root dir missing, or the `gitdir` its `.git` file names is missing | daemon RSS, workers | none past one check (5 s) | `kill <pid>`: SIGTERM runs the shutdown order (`signals.ts`, S). `squeal stop <root>` exits 1 on a missing path (C9, S) |
| install-gone | C9 `reinstalled`, C11 (S) | the bundle dir in argv (`…/squeal/<v>/dist`) is missing | as above | none past one check | `squeal stop <root>` |
| older-release | defect 26; C9 step-down (S) | daemon version < the version the harness loads now (Claude Code: `installed_plugins.json` user entry; Codex: newest cache dir; the launcher's rule, 005 D3) | the newer fixes miss that worktree | **by rule**: a consumer registered with an older version (`consumer-version:<wt>` in `meta`) whose harness process is alive; no step-down is asked then (C9) | when an older session holds it: restart that session (name its harness pid). Otherwise `squeal stop <root>`. A stop while the old session lives leaves a stopped mark, and that session's next edit starts the old version again (C9, I) |
| duplicate | 004 lessons (two 0.1.58 daemons); C9 lock rules (S) | two daemon processes with one root | one extra Node process | successor in `--await-lock` ≤120 s; loser lock retry ≤30 s | `kill <pid>` of the one without the lock |
| no-lock | C9, row 011-30 (six waiting successors held 582 MB) (S) | daemon holds no lock on its worktree lock file, age >40 s (>130 s with `--await-lock`) | RSS, CPU of retries | the same two waits | `kill <pid>` |
| hung | defect 22; C9 heartbeat grace (S) | holds the lock, store record set, `daemon_heartbeat_at` older than 2 × `daemon_heartbeat_interval_ms` | hooks spawn nothing; the worktree has no validation | a store busy past a heartbeat (C13 notes it); confirm on a second sample | `kill <pid>`, then `kill -9` (D12) |
| past-departure | defect 24; C9 `sessions-gone` (S) | no consumer row, `departed:<wt>` later than the daemon's start, older than 1 min, and `slow-tier:<wt>` is `null` | daemon and its workers | a daemon started by `squeal start` with no consumer has `idleExitMinutes` (no `departed` after its start) | `squeal stop <root>` |
| past-idle / past-unused | C9 idle, 001-415 unused (S) | no consumer and quiet > `idleExitMinutes`; or consumers and quiet > `unusedExitMinutes`. "Quiet" is now minus the latest of: revision `created_at`, run end, consumer `last_seen_at`/`last_delivered_at`, and it is 0 while a run is open (I: the daemon's in-memory "request" time is not in the store) | as above | a socket request (`status`, `--wait`) the store does not record; the rule then fires early | `squeal stop <root>` |
| draining *(info)* | 004-29, C9 drain; 004-60 (S) | no consumer, `departed` set, `slow-tier:<wt>` not `null` (`{"kind":"waiting","for":"fast"\|"slot"}`) and departure < `idleExitMinutes` ago | the whole fast backlog runs first, because the slow lane waits for its own fast backlog (004-60) (E, below) | it is the rule; show the minutes left | `squeal stop <root>` cancels the tiers in flight (C9) |
| dead-consumer | C9 harness-process drop (S) | a `harness-process:<wt>` entry whose pid is gone, has another `starttime` (field 22) or is `Z` | keeps a daemon alive until the next heartbeat | the window before the daemon's next heartbeat (5 s); flag after 2 intervals | none; if it persists, the daemon is hung (above) |
| orphan-test-process | lessons 003 defect 8; C13 reaper (S) | `environ` has `SQUEAL_DAEMON_CHILD=<token>[:lane]` and no live daemon owns the token. The owner is `daemon-token:<wt>` in `meta`, `startedAt` 0 to 120 s after the live daemon's process start (6 s seen at load 45, E) | CPU, RSS, ports (two `fake-dev-server.mjs` lived 57 min) | a carrier whose daemon is exiting, seen once at age 2 s (E); require two samples ≥1 s apart | `kill <pid>` |
| overdue-test-process | C13 timeout, C10 `runner.timeoutMs` (S) | a token carrier that is not the daemon's own child, older than `runner.timeoutMs` + 60 s | as above | a carrier the reaper still owes, ≤1 s grace and ≤3 rounds (C13) | `kill <pid>` |
| test daemon | defect 29 (S) | daemon bundle outside every plugin cache (`node_modules/.cache/squeal-test/…`, an e2e plugin dir), root under `/tmp` | RSS; blocks worktree destroy | a test run in progress: bound it at 1 h (I) | `kill <pid>` |
| orphan-waiter | 012 CC4 (S) | a `dist/waiter.mjs` process whose parent is `systemd --user` or gone | small | none | `kill <pid>` |
| stale-socket | C9 "unlinks a stale socket" (S) | `squeal-<id>.sock` in the runtime dir or `/tmp/squeal-<uid>` with no live daemon of worktree `<id>` holding its lock. `/proc/net/unix` cannot be used: a daemon binds a hidden `.<hex>` name and renames it into place (`server.ts`, E: every live socket showed as `/run/user/1001/.<hex>`) | none (a hook gets ECONNREFUSED and spawns) | a daemon in the ms between rename and lock check: none, since it takes the lock first | `rm <path>` |
| stale-pool-mark | C10 marks, `marks.ts` (S) | `pool.mark.*` older than 30 s (`SLOT_WAITER_FRESH_MS`) | none: readers skip it | none | `rm <path>` |
| permit-held-by-non-daemon | C10 (S) | `/proc/locks` holder of `pool.<i>.lock`/`slow*.lock` is no daemon pid | a permit lost to the pool | none known | `kill <pid>` |
| leftover-temp-dir | C9 temp dir: removed at exit, else by the next daemon *of the same key* (S) | `/tmp/squeal-<uid>/tmp/<key>` (or `.old-*`) where `<key>` ≠ `sha256(repository-id + "\0" + root)[:16]` of any live daemon, mtime > 1 min; also `/tmp/squeal-<uid>-<key>-XXXXXX` | disk | a daemon starting at that key (it takes the lock first, then moves the dir aside) | `rm -rf <dir>` |
| leftover-e2e-fixture | board Later (20 dirs, disk at 98%, 2026-10-08) (S) | `/tmp/squeal-e2e-[oc-\|pi-]XXXXXX` that no process names in argv or cwd, mtime > 1 h | disk, 40 to 190 MB each | an e2e run between tests: hence the hour | `rm -rf <dir>` |

These states never get a flag (S, E): lock files with no holder (`locks/<id>.sqlite`, `waiter-*.sqlite`, `pool.<i>.lock` above the current pool size). The OS frees an fcntl lock when its holder dies (`slot.ts`, `waiter-lock.ts`), so a lock with no live holder cannot exist; only the file stays. The same holds for zombie `esbuild` children of a live Vitest worker (3 seen, no memory), session-root files (`squeal-sessions/`, "nothing removes a file whose session never ends", `session-root.ts`) and worktree lock files (1,560 across two stores). At most `squeal ps` can count them.

## 2. The host now (stopped nothing)

Two scans: 08:18:50Z at load 41.60 / 39.07 / 39.51 with PSI `some avg10` 38.5; and 08:22:38Z at load 24.05 / 33.33 / 37.33. Scan cost: 188 to 241 ms wall per scan without sizes (3 runs at load 24): `/proc` table 31 to 47 ms, every `environ` 29 to 51 ms, both stores 7 to 11 ms each, files 86 ms (listing `/tmp`, 3,467 key dirs). With sizes (walking the leftovers) it is 583 ms. All E.

- **21 daemons** (the coordinator's snapshot had 20): 11 Codex on cezar worktrees, 10 Claude Code (1 cezar main, 2 cezar worktrees, 7 squeal worktrees). All hold their lock, all heartbeat within 5 s, none duplicated, no root gone, no dead consumer. Their RSS together: 16,647 MiB. Test processes: 38, 6,593 MiB, all at nice 10, all with a live owner. E.
- **The two 0.1.234 daemons of the snapshot.** (a) Pid 3241641 (Claude Code cache, cezar `70b80c8e`) is **right to be alive**. Its one consumer registered with version 0.1.234 from the Claude Code process 3212240. That process started 07:06:49Z, before the plugin update at 07:12:10Z (`installed_plugins.json` `lastUpdated`), and it is still alive. C9 asks no step-down while an older plugin's session is registered. It ends when that session ends. (b) Cezar `747fa407` was right by rule too, but it got nothing done. Its session left at 07:09:30Z. The daemon drained for the full bound and stopped at 08:09:30Z with the note "slow files were still pending 60 min after its last session ended (daemon.idleExitMinutes)". E.
- **Four daemons are draining** (2721938, 3546894, 4099030, 4102450; all Codex on cezar). Their sessions left 10 to 38 min earlier. Three have `slow-tier` `{"kind":"waiting","for":"fast"}`: by 004-60 the slow lane waits for the daemon's own fast backlog, so the drain runs the fast backlog first. One waits for a slot. Daemon 3546894 ran 5 runs after its session left (71 to 351 files, 2 `timed-out`). Together the four hold 3,976 MiB (24% of daemon RSS) and 1,610 MiB of test processes. They also held 1 to 2 of the pool's permits at each scan. This is the largest cost on the host that no flag can call wrong by rule. E for the state; I for "no one reads these results": the sessions are gone.
- **Files.** One stale socket and one pool mark of worktree `fd5a859b8ca77ef9`, from 2026-10-16 20:29 to 20:36. That id is in none of the three stores on the host (cezar, squeal, mvp-unveiled-july26), so its origin is not determined. 3,446 of 3,467 temp key dirs belong to no live daemon: 149 MiB, from 2026-10-14 on, 104 to 845 a day by mtime. Their contents (`squeal-links`, `squeal-observe`, `squeal-oc-*`) are temp files of Squeal's own tests, and each test repository has a key of its own that no later daemon reuses (I). 84 e2e fixture dirs, 6.3 GiB, 2026-10-14 to 10-20, none in use. 4 waiter lock files, none held. 2 session-root files name a missing root. Pool lock files `pool.0` to `pool.22` exist, but `capacity.hostSlots` is 12: these are files from an older pool size, and they cost nothing. E.

## 3. Time bounds

| Flag | Bound | Given by |
|---|---|---|
| past-departure | 3 s grace, ≤5 s check, ≤5 s heartbeat; flag at 1 min | constants (C9 departure grace, `lifecycle.ts` `checkMs`) |
| draining → past-departure | departure + `daemon.idleExitMinutes` | setting (default 60; cezar sets 60) |
| past-idle | quiet > `daemon.idleExitMinutes` | setting |
| past-unused | quiet > `daemon.unusedExitMinutes` | setting (default 30, project policy only) |
| no-lock | 30 s loser retry; 120 s `--await-lock`; a handoff claim's bound is the lock wait + 10 s; "did not finish" 130 s after shutdown began | constants (C9) |
| hung | 2 × `daemon_heartbeat_interval_ms` | the worktree row (5 s by default, `daemon.ts`) |
| dead-consumer | 2 heartbeat intervals; the backstops are 12 h with no delivery and 10 min for a free waiter lock | row + constants (C9) |
| overdue-test-process | `runner.timeoutMs` + 1 s reaper grace (per run, and per slow file, 004) | setting (default 600000) |
| orphan-test-process | two samples ≥1 s apart | probe finding (E) |
| stale-pool-mark | 30 s | constant `SLOT_WAITER_FRESH_MS` |
| leftover temp / e2e | 1 min / 1 h mtime | proposed, no setting (I) |

`squeal ps` must read the settings from the daemon's root's `squeal.config.json`. Each daemon has its own: cezar's sets `daemon.idleExitMinutes` 60 and `runner.timeoutMs` 600000, and squeal's sets neither.

## 4. Prior art (read in official docs, fetched 2026-10-21)

| Tool (doc version) | Columns | Grouping, problem display | JSON | Default scope |
|---|---|---|---|---|
| `docker ps` (docs.docker.com, current) | `CONTAINER ID IMAGE COMMAND CREATED STATUS PORTS NAMES`; `--size` adds `SIZE` | flat. A problem is in `STATUS`: "Container status with details about duration and health-status" (`Exited (0) 2 weeks ago`). `--filter status=…\|health=unhealthy` | `--format json` | the daemon's (host's) running containers; `-a` adds stopped ones |
| `docker stats` | `CONTAINER ID NAME CPU % MEM USAGE / LIMIT MEM % NET I/O BLOCK I/O PIDS`; "CPU % and MEM % the percentage of the host's CPU and memory" | flat, live stream; `--no-stream` gives one snapshot | `--format "{{ json . }}"` | running containers |
| `pm2 ls` (pm2.keymetrics.io) | sort keys `name\|id\|pid\|memory\|cpu\|status\|uptime`; status is one of "online, stopping, stopped, launching, errored" | flat, one state column | `pm2 jlist`, `pm2 prettylist` | every app of the user's PM2 daemon |
| `gradle --status` (9.8.2) | `PID STATUS INFO` (`IDLE`/`BUSY`, version) | flat. "only shows Daemons spawned running the same version of Gradle"; the docs send the user to `jps` for the rest. Daemons stop on low memory or "idle for 3 hours" | none | the calling Gradle version |
| `nx daemon` (v23) | prints the daemon's process ID and log file path | one daemon; "Each workspace starts its own daemon process"; "shuts down after 3 hours without requests or file changes" | none | the workspace |
| `turbo` (turborepo.dev, 2.x) | `turbo info` prints `Daemon status: Running` | the daemon "is no longer used for `turbo run`" | none found | the repository |
| `watchman watch-list` | `{ "version", "roots": [...] }` | roots only, no resources | JSON is its native form | the user's one server, all roots |
| `systemd-cgtop` (systemd 255, `man`) | per control group: tasks, CPU, memory, I/O; "ordered by their CPU, memory, or disk I/O load" | tree by cgroup, `--depth`; batch mode `-b -n` | none (`man` has no JSON) | the host |

`turbo daemon status`: the page `turborepo.dev/docs/reference/daemon` returns 404, so that command is not determined from the current docs.

What carries over: one row per process, with state as one word in one column (Docker `STATUS`, pm2 `status`, Gradle `IDLE/BUSY`). CPU and memory are given as a share of the host (Docker `stats`). Every tool that lists processes has a JSON switch. Docker, pm2, Watchman and cgtop cover the host by default. Gradle covers only its own version, and its docs must point to `jps` for the rest: that is the older-release blind spot. A per-version or per-repository default would hide a 0.1.234 daemon in the same way. No tool in the set prints a suggested command per row. That part is Squeal's own (status.md, 2026-10-21).

## Recommendation for Squeal

1. Flag the 19 states of section 1, each with its rule and end command. Show "draining" as information with the minutes left. Never flag lock or permit files.
2. Give each row one state word in one column, as `docker ps` and `pm2 ls` do: `serving`, `draining 22m left`, `older (session 3212240 holds it)`, `stopping`, `past-unused`. Name the end command under each flagged row. Keep the host default from `status.md`. Gradle's own docs show the cost of a per-version scope.
3. Put the files (temp key dirs, e2e fixtures, stale socket and mark) in one closing section, as counts and sizes with one `rm` line per class. 3,446 dirs are too many for one row each.
4. Print "older" and "draining" with their reason, never as faults. On this host every live daemon was alive by rule, and the cost came from what the rules allow: a 60-minute drain that runs the fast backlog for a session that is gone. That is a question for 004/011 (should a departure drain wait for the fast backlog?). `squeal ps` can only make it visible.
5. Take a second sample ≥1 s later before flagging a process, as 014-02 needs for CPU anyway. It removes the one false orphan seen.

## Open questions

- The worktree `fd5a859b8ca77ef9` (stale socket and mark, 2026-10-16) is in no store on the host. What kills daemons without cleanup (SIGKILL in tests?) is not determined.
- past-unused uses the store as a stand-in for the daemon's in-memory last request. A `squeal status` to the socket is not recorded, so the rule can fire early. A read-only ping field would settle it (014-01's topic).
- macOS: every rule here uses `/proc` and `/proc/locks`. Not examined.
- Whether `squeal ps` should also count files that never get a flag (session roots, worktree lock files) is the spec's choice.

## Sources

- `docs/specifications/011-core/spec.md` C9, C10, C13; `004-slow-suites/spec.md` D2, line 45 (`runner.timeoutMs` per slow file); `012-claude-code-adapter/spec.md` CC4; `001-core-loop/lessons.md` defects 22, 24, 26, 29; `003-node-test-runner/lessons.md` defect 8; `004-slow-suites/lessons.md` (two 0.1.58 daemons, orphans); `009-pi-adapter/lessons.md` defect 2; `docs/board.md` Later (e2e fixtures).
- Source at `9060a96c9`: `src/core/daemon/{lifecycle,scratch,server,signals,paths}.ts`, `src/core/capacity/{marks,pool}.ts`, `src/core/slow/slot.ts`, `src/core/waiter-lock/waiter-lock.ts`, `src/harness/shared/session-root.ts`, `plugins/claude-code/hooks/hooks.json`, `~/.local/bin/squeal` (launcher format 4).
- Docs: https://docs.docker.com/reference/cli/docker/container/ls/, https://docs.docker.com/reference/cli/docker/container/stats/, https://pm2.keymetrics.io/docs/usage/process-management/, https://pm2.keymetrics.io/docs/usage/quick-start/, https://pm2.keymetrics.io/docs/usage/pm2-doc-single-page/, https://docs.gradle.org/current/userguide/gradle_daemon.html (9.8.2), https://nx.dev/docs/reference/nx-commands and https://nx.dev/docs/concepts/nx-daemon (v23), https://turborepo.dev/docs/reference/run and /info (`/daemon` 404), https://facebook.github.io/watchman/docs/cmd/watch-list, `man systemd-cgtop` (systemd 255.4).
- Probe: `probes/should-not-be-up/` (`scan.py`, README, two scan outputs).
