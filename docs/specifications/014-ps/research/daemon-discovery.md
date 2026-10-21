# 014-01 Finding every daemon and what it can say

Researcher, 2026-10-21. Squeal 0.1.235 at `9060a96c9`; Linux 6.8, Node 24.21.0, SQLite 3.53.4, iproute2 6.1.0, 24 CPUs. The host carried 21 to 23 live daemons during the work; load is given beside each timing. Probes are in `probes/daemon-discovery/` (README there). No probe connected to a live socket, opened a live store for writing, or signalled a process it did not start.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Sources | A `/proc` scan for daemon command lines finds every daemon, waiters included. Each daemon's open lock file (`/proc/<pid>/fd`) names its store and worktree id. `/proc/locks` says which daemon holds its lock. Socket files alone miss waiters and include leftovers; stores, pool marks and lock dirs are not lists of live daemons. No registry is needed on Linux. | verified by experiment |
| 2 | Identity | pid, root, version, plugin cache, start time, store and worktree id come without a socket. A socket file is tied to its pid through `ss -xle` (VFS inode) and the pid's fds. `/proc/net/unix` alone cannot do it: it shows the staging name the daemon bound before its rename. | verified by experiment |
| 3 | Work | The store gives heartbeat, pending and running counts, open runs and checkpoints, consumers and their harness pids, rest, stop and exit marks. The idle and unused exit clocks exist only in the daemon's memory, and no request returns them. `ping` is the one request without side effects, in every release since the first daemon. `squeal ps` does not need it. | read in source code; store reads verified by experiment |
| 4 | Versions | Yes, through a read-only connection: it reads any `user_version` (1 and 99 tried) and never waits for the write lock (0.22 ms under a held write lock). Squeal's `openStore` must not be used: it migrates an older store. | verified by experiment; `openStore` read in source code |
| 5 | macOS | `ps -axww -o pid=,lstart=,command=` for (b); the hash of the root gives the socket path for (a); `lsof -p <pid>` for the open lock file. No `/proc/locks` and no VFS inode join. | read in official docs and source code; not run on macOS |

## 1. Sources

**(a) Socket files** in `$XDG_RUNTIME_DIR` and `/tmp/squeal-<uid>` (`paths.ts` `socketPathFor`). Live: 23 files and 22 daemons. One file, `squeal-fd5a859b8ca77ef9.sock` from 2026-10-16, had no listener, so it is a leftover. P6 showed how such a file is made: after SIGKILL the socket file and the store row (`daemon_socket` set) stay, and the lock and the listener go. After SIGTERM the file and the row's socket are cleared, and version, start time and a `daemon-exit:` mark stay. Socket files miss a daemon waiting for the lock (P6 B: the 0.1.235 `--await-lock` waiter behind a 0.1.234 daemon had no socket and no lock). They also miss a stopping daemon, which clears its record and socket before it releases the lock (C9), and a daemon with another `XDG_RUNTIME_DIR` (an e2e inner daemon, 004-16). Cost: 1.4 ms for both directories. *Verified by experiment.*

**(b) `/proc` scan** for `argv[k-1]` matching `squeal`, `squeal.mjs` or `squeal/dist/cli/index.js` and `argv[k] == "daemon"`. It found every daemon, the waiter and the SIGSTOPped one (state `T`), from 0.1.234 and 0.1.235, from Claude Code's and Codex's caches. It misses a daemon started through a script of another name, and a relative root (`squeal daemon .`) cannot be resolved after the daemon moved to `<common-dir>/squeal/`. The lock fd (below) covers both. Cost: 12 to 24 ms for about 3,200 processes at load 28 to 38; `ps -eo pid,lstart,args` costs 48 to 57 ms. *Verified by experiment.*

**(c) Stores.** A store lists its worktrees and their recorded daemons. But no file lists the stores of a user, so the stores cannot be the starting point. They are reached from (b): `/proc/<pid>/fd` of a daemon always holds `<common-dir>/squeal/locks/<id>.sqlite` and `store.sqlite` (P8: 21 of 21). Between them, the squeal and cezar stores held 60 worktree rows for 22 live daemons. *Verified by experiment.*

**(d) Pool.** `$XDG_RUNTIME_DIR/squeal/pool.mark.<sha(id)>` holds `{v, id, want, grant, since, project}` only while a daemon has backlog work (10 marks for 22 daemons). Permit files keep their last holder in a `holder` table, but a held permit cannot be read, because its holder keeps an exclusive lock. `/proc/locks` names the holders (pool.0 to pool.2 and `slow.lock`, 4 pids). So the pool tells who holds capacity, not who is up. A daemon without `XDG_RUNTIME_DIR` uses `/tmp/squeal-<uid>`, which is another pool (4 permit files there, last used 03:32). *Verified by experiment; `marks.ts`, `slot.ts` read in source code.*

**(e) A per-user registry** would add a write on every daemon start and stop. A SIGKILLed daemon would leave it stale, as it leaves its socket, and daemons of older releases would never write it. (b) + `/proc/locks` already gives the live set on Linux, so a registry would only serve macOS. *Inferred.*

**`/proc/locks`.** Each daemon holds a `POSIX WRITE` lock on its lock file. 22 daemon holders in 1,564 lock files in two stores (P3), each a daemon P2 had found, and one more that started between the probes. A SIGKILLed daemon's lock went at once (P6 D); a SIGSTOPped one kept it (P6 C). A waiter holds none. So "process found, lock not held" means waiting or losing. "Lock held, no socket" means stopping: C9 clears the record and socket before the lock goes. That state was not caught in P6, because a SIGTERM stop of an idle daemon took well under a second. The file also lists the Claude Code waiter locks (`locks/waiter-<id>.sqlite`), which the 16-hex name pattern leaves out (one was held, by a `waiter.mjs` process). Cost: 4 to 15 ms. *Verified by experiment.*

## 2. Identity

- **pid, start time, state:** `/proc/<pid>/stat` fields 3 and 22. The row's `daemon_started_at` is 1.2 to 12.1 s later than the process start (P8, 21 daemons, load 28). A row therefore ties to a pid through the held lock, never by start time. *Verified by experiment.*
- **Worktree id, store:** the lock fd path. In 21 of 21 it equals `sha256(realpath(root))[:16]` (`git-layout.ts` `worktreeIdFor`) of the command-line root. *Verified by experiment.*
- **Root, repository:** the command line, or the row's `root` (21 of 21 equal). The repository is the common dir of the lock path. *Verified by experiment.*
- **Version, plugin cache:** the script path `.../{.claude,.codex}/plugins/cache/hearsay/squeal/<version>/dist/cli/squeal.mjs`. In 21 of 21 it matched `daemon_version`. A checkout's `dist/` has no version in its path, so the row is the fallback. *Verified by experiment.*
- **Root and admin dir exist:** `existsSync(root)` and the `gitdir:` of `<root>/.git`. All live daemons had both. The daemon exits when either goes (C9), so one that stays up without them is news for 014-03. *Verified by experiment; rule read in spec.*
- **Socket to pid without connecting:** `ss -xle` prints each listener's socket inode and `ino:<VFS inode>` of its file. `stat` of `squeal-<id>.sock` gives the same inode, and `/proc/<pid>/fd` gives `socket:[<socket inode>]` (P1, P8: 21 of 21). `/proc/net/unix` lists `/run/user/1001/.<hex>`, the staging name that `bindAt` listens at before the rename (001-77, every tagged release since 0.1.62). `ss -xle` costs 4 ms; `ss -xlpe` costs 45 to 52 ms, since it scans every process's fds. Without `ss`, a socket file whose id has no lock holder is a leftover. Only a hung daemon's listener needs `ss`. *Verified by experiment.*
- **Working directory:** `/proc/<pid>/cwd` is `<common-dir>/squeal/` between runner calls and the root during one (C9). One of 22 was in its root while its tier ran. *Observed once; rule read in spec.*

## 3. Work

Read through a read-only connection (P5: 0.3 ms open, 0.4 to 3.8 ms per worktree; stores of 84 MB and 542 MB + 295 MB WAL):

- **Heartbeat age and interval:** `worktrees`. Alive is within two intervals (C9).
- **Pending:** `test_file_keys.pending` per worktree, `queued` and `running` counts.
- **Running tier:** `runs` with `end_state IS NULL AND started_at >= daemon_started_at`, as `status/open-runs.ts` reads it. Without the time bound the result is wrong: the cezar main worktree showed a run 21.6 h open under a daemon 59 min old. The lane is in `checkpoint-lanes.<id>` for checkpoint runs and in `slow-tier:<id>`. An edit's tier has no lane column. `pool.mark` adds `slow` and the grant.
- **Checkpoint:** `checkpoints` with `completed_at IS NULL` and the same time bound (3 open on the cezar main worktree, 2 of them 22 h old).
- **Consumers:** `consumers` rows. `meta` `harness-process:<id>` holds `{slot: {pid, startTime, pidNamespace}}`, which `harnessGone` checks against `/proc/<pid>/stat`. `consumer-version:<id>` holds the hook versions.
- **Marks:** `daemon-exit:<id>` is `<version>@<startedAt>#<token>` and stays after exit. `daemon-rest:<id>` is `{at, spawnedAt}` and also stays under a later live daemon (seen live). `daemon-stopped:<id>` is set after `squeal stop`. Each mark means something only when compared with the current row's incarnation and heartbeat.

*Verified by experiment (live reads); meanings read in source code.*

**Not in the store:** the idle and unused clocks (`daemon.ts` `#lastUsed`, `#lastActive`, `lifecycle.ts` `unused`). The store has proxies only: the last revision time, run ends, and consumers' `last_seen_at`. Waits and requests leave no trace. *Read in source code.*

**Socket requests** (`protocol.ts`): `ping`, `nudge`, `retry`, `run-all`, `run-all-status`, `run-slow`, `run-slow-status`, `sync`, `sync-status`, `promote`, `stop`, `step-down`. Each one except `ping` and the three `*-status` requests calls `onActivity` or acts, so it resets the unused clock or starts work. `stop` and `step-down` end the daemon. `ping` returns `{pid, worktreeId, root, squealVersion, phase: starting|ready|stopping, startedAt}` and touches nothing. That is true in the first daemon commit `fd6ffee30` and in every later `handlers.ts` (checked by `git log`). An unknown type gets an error answer and nothing else. Only `ping` adds something the store does not have: `phase`. `stopping` can be told without it, from the held lock plus the cleared row and the exit mark. *Read in source code.*

## 4. Versions

`SCHEMA_VERSION` is 1, and `MIGRATIONS` has one step (`schema.ts`). Both live stores are at `user_version` 1. P4: a `{ readOnly: true }` connection read `user_version` 99 and changed no byte of the file. It refused an insert and read in 0.22 ms while another process held `BEGIN IMMEDIATE`. If `-wal` and `-shm` are missing, it creates them empty. Squeal's `openStore(..., { create: false })` is not read-only: it runs `migrate`, which writes under `BEGIN IMMEDIATE` on an older store. A future `squeal ps` at schema 2 would so migrate a store that a 0.1.235 daemon serves, and that daemon would exit on the newer schema (C7). Meta key formats are not covered by `user_version`, so each meta read must tolerate a value it does not know. *Verified by experiment; `open.ts`, `schema.ts` read in source code.*

## 5. macOS

There is no `/proc`. For (b): `ps -axww -o pid=,lstart=,command=` (adv_cmds `ps.1`, seconds only; `kinfo_proc` needs a native addon, per 001's `harness-process-liveness.md`). For the socket tie, the id hash of the root gives the expected path, without a listener check. `lsof -U` lists unix sockets (lsof 4.95 manual, which names Darwin). It would show the bound staging name, as Linux does, but that is *inferred*. For the lock: `lsof -p <pid>` lists the open lock file. Whether lsof on Darwin reports the lock itself is *not determined*: the manual lists lock characters without saying which dialects fill them, and nothing was run on macOS.

## Recommendation

Use no registry and no socket request. On Linux, `squeal ps` lists daemons in this order:

1. Scan `/proc/*/cmdline` for daemon processes.
2. Take each one's store and worktree id from its lock fd, or else from the hash of the command-line root.
3. Read `/proc/locks` for which daemons hold their lock.
4. Run `ss -xle`, when present, to tie socket files to pids.
5. Read each store once through a read-only connection: the row, pending, running tier, checkpoint, consumers and marks.

This found 21 of 21 daemons and the one leftover socket in about 40 ms of reads plus Node's start (P8, load 28). Name four states from these sources: serving, waiting (no lock), stopping (lock, no socket), and leftover socket. Leave the idle and unused clocks out until the daemon records them, or add them to `ping` in a later row. On macOS, list from `ps` and the root hash, and say that lock state is unknown.

## Open questions

- Whether a daemon should record its last-use time (store or `ping`) so `ps` can show the unused clock. That is a product decision for the spec.
- Lock files are not pruned: 1,037 in squeal's store, 527 in cezar's, against 23 held. The pool also has two homes, one per `XDG_RUNTIME_DIR` presence. Both are for 014-03.
- Daemons in another PID namespace (containers) were not examined.
- Nothing was run on macOS.

## Sources

- Code at `9060a96c9`: `src/core/daemon/{paths,server,handlers,protocol,lock,ensure,desk,front-desk,daemon,lifecycle}.ts`, `src/core/store/{schema,open,paths}.ts`, `src/core/store/repos/runs.ts`, `src/core/status/open-runs.ts`, `src/core/capacity/marks.ts`, `src/core/slow/slot.ts`, `src/core/delivery/harness-process.ts`, `src/core/types/{store,store-records,daemon}.ts`, `src/core/fs/git-layout.ts`; commits `fd6ffee30` (first daemon), `73e65f70a` (staging rename, 001-77).
- Spec `docs/specifications/011-core/spec.md` C1, C7, C9, C10.
- `docs/specifications/001-core-loop/research/harness-process-liveness.md` (macOS `ps`, `kinfo_proc`).
- `ss(8)` iproute2 6.1.0 (`ino:` is "the socket's inode number in VFS"); `lsof(8)` 4.95.0; `proc(5)` (`/proc/locks`, `/proc/net/unix`).
- Installed bundles `~/.claude/plugins/cache/hearsay/squeal/{0.1.234,0.1.235}`.
- Probes `probes/daemon-discovery/p1` to `p8`.
