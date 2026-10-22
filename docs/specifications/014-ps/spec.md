# 014 squeal ps: what Squeal runs on this host

## Problem

Squeal starts one daemon per worktree, and each daemon starts test processes. On a shared host nobody can see them as one picture. On 2026-10-21 the host ran 21 to 22 daemons and 36 to 38 test processes. They held about 20.5 GiB of private memory, 63 to 67% of the host's used memory, and 1 GiB of swap. They used 7.3 to 9.4 of 24 CPUs, 33 to 41% of the host's busy CPU (`research/process-measurement.md` 4). To see this, the human had to read `ps` output by hand. `ps` does not say which daemon a test process belongs to, what a daemon is doing, or whether it should still run.

Some states should not be up and cost resources, and no command shows them today. For example: a daemon whose worktree is gone, a test process whose daemon is gone, a socket a killed daemon left, and temp directories no process uses. On 2026-10-21 the host had 3,446 leftover temp key directories (149 MiB) and 84 unused e2e fixture directories (6.3 GiB). Four daemons were draining for sessions that had left. They held 3,976 MiB, 24% of all daemon memory (`research/should-not-be-up.md` 2).

## Goals

1. `squeal ps` lists every live Squeal daemon of the user on the host. For each, it gives the pid, the repository, the worktree, the version, the harness whose install it runs from, the uptime, one state word, the CPU over the sample, the cumulative CPU time, the private memory, the swap, the current work and the consumers.
2. It lists every test process Squeal started, under its daemon. For each, it gives the lane, the runner, its test files or tier, the CPU, the memory, nice, the age and its descendants.
3. It gives the host totals (load, CPU and memory pressure, memory, swap, CPU count, the capacity pool), and Squeal's share of the CPU and the memory.
4. It flags each D7 state with its reason and the command that would end it. It changes nothing: it opens no daemon socket, writes no store, sends no signal and removes no file.
5. `--json` gives the same data as a versioned shape. `--repo` narrows the output to the current repository. The exit code is 0 without a flag, 1 with any flag, 2 on a usage error and 3 on a platform other than Linux and macOS (D10).
6. One snapshot takes at most 2.5 s wall time and 0.4 s CPU on a host with 650 processes and 25 daemons. The CPU counts the whole command, Node's start included, and is judged when the host's one-minute load is at or below its CPU count (human, 2026-10-21; 0.4 s, not 0.3 s, human, 2026-10-22, after `lessons.md` Round 4).

## Non-goals

- No live view. A `--watch` can be a later row (the human, 2026-10-21).
- No action. Each flag prints a command, and the human runs it or not (the human, 2026-10-21).
- No process that Squeal did not start, beyond the host totals (the human, 2026-10-21).
- No socket request to any daemon, `ping` included. The store and `/proc` give all D2 to D7 need (`research/daemon-discovery.md` 3).
- No PSS and no heap split. `smaps_rollup` costs about 1.1 s of kernel CPU per snapshot (`research/process-measurement.md` 5).
- No file per Vitest worker. Only the daemon knows it; `ps` gives the files of the tier.
- No platform other than Linux and macOS, and no test on a Mac (D10).
- No fix to the policies `ps` makes visible, such as the departure drain or the leftover temp directories. Those are board Later items for 004 and 011.

## Design

### D1. Command

```text
squeal ps [--repo] [--full] [--json]
squeal ps --leftovers
```

- With no flag, the output covers every daemon of the user on the host, grouped by repository. The current repository comes first; the others follow by their CPU over the sample. `ps` runs outside a repository too. Docker, pm2 and Watchman also default to the host; Gradle limits itself to one version and its docs must send the user to `jps` for the rest (`research/should-not-be-up.md` 4).
- `--repo` keeps the daemons, test processes, flags and files of the current repository only. The host totals stay.
- `--full` also lists the descendants of each test process, one per line. It also counts the files that never get a flag (D7, last paragraph).
- `--json` prints the D8 shape and nothing else.
- `--leftovers` prints the path of every leftover directory of D7, one per line, and nothing else. The D7 end commands use it. It takes no other option, runs without the 2 s window and exits 0 (014-11).
- `--repo` outside a repository is a usage error, exit 2: exit 1 already means that a flag holds. It keeps a stale socket only when the current repository has a lock file of its worktree id, and it drops orphans, pool marks and leftover directories, which no repository owns. The Squeal totals count only the daemons it keeps (014-11).
- A snapshot that throws exits 3 with its error on stderr, never 1. The line for a platform `ps` does not cover goes to stderr too, so stdout stays clean for `--json` (014-11).
- `ps` needs no daemon, no store write and no harness. It is not a hook, and no delivery or primer mentions it.

### D2. Discovery

On Linux, `ps` finds daemons without a registry (`research/daemon-discovery.md` recommendation; macOS in D10):

1. Scan `/proc/*/stat` once. Read `cmdline` only for processes whose `comm` is `MainThread` or `node`. A daemon is a process whose arguments hold a Squeal script (`squeal`, `squeal.mjs` or `squeal/dist/cli/index.js`) followed by `daemon <root>`.
2. Take each daemon's store and worktree id from the lock file it holds open, `<common-dir>/squeal/locks/<id>.sqlite` in `/proc/<pid>/fd`. When the fd is not there, use the hash of the command line's root (`worktreeIdFor`).
3. Read `/proc/locks` to learn which daemon holds its lock, at both ends of the window (D4): a lock either reading shows is held, a permit by the holders of the latest reading that shows it. One read returns a page per `read()` and can miss a held lock while other locks change, and a read right after it misses the same lock far more often than chance (`lessons.md` P9). Only two readable readings that both miss a lock prove it absent: then a daemon is `waiting` (and `no-lock`), a socket file has no daemon and a permit is free. When a reading cannot be read, a lock the other misses is unknown, as without locks (D10): such a daemon's phase is serving by its heartbeat, or unknown, any daemon of its id may own its socket, the permit counts are `null`, and `unknown` names the reading. Two holders of one lock file are the two readings' (the lock passed), not a `duplicate` of each other; holders of different lock files of one root still are (014-31, `reviews/wave-5.md` B1, B2).
4. Tie each `squeal-<id>.sock` file, in `$XDG_RUNTIME_DIR` and in `/tmp/squeal-<uid>`, to its daemon by the worktree id. When `ss` is present, `ss -xle` also confirms the listener (4 ms). `/proc/net/unix` cannot do this, because it shows the staging name the daemon bound before the rename.
5. Read each store once, through `node:sqlite` with `{ readOnly: true }`. Never use Squeal's `openStore`: it migrates an older store, and the daemon serving that store would then exit on the newer schema (C7). Each meta value is read so that a value of an unknown format reads as unknown, not as an error.

The daemon's phase comes from these sources:

| Phase | Rule |
|---|---|
| `serving` | holds its lock, and its store row's record names it: the record's start is at or after the process start minus 1 s |
| `starting` | holds its lock, and the row has no record of it: no row start, or a start earlier than the process start minus 1 s (the previous daemon's, or a SIGKILLed predecessor's record not yet replaced). A daemon takes its lock before it opens the store and registers |
| `stopping` | holds its lock, its row has no record, and the row's kept start is its own (C9 clears the record before the lock goes) |
| `waiting` | holds no lock (a loser's retry or a `--await-lock` successor) |
| `unknown` | the lock is held but the store cannot be read, or the boot time cannot be read where the rule needs the process start, or the source has no lock state (D10) |

A process's start time never ties it to a store row, because the row's `daemon_started_at` is 1.2 to 12.1 s later than the process start. Only the held lock ties them; the start time only excludes (014-06). `discover.ts` exports `phaseOn(source)`, which reads the boot time and the tick rate once and returns the phase function `(daemon, work, now)`.

Identity: the pid and the start time come from `stat`. The version and the harness come from the script path (`.../{.claude,.codex}/plugins/cache/hearsay/squeal/<version>/...`), with the row's `daemon_version` as the fallback for a checkout's `dist`. The root comes from the command line, and the repository from the lock path's common directory.

### D3. Work

From the store, without the daemon (`research/daemon-discovery.md` 3):

- **Heartbeat:** its age, against two of the row's intervals.
- **Pending:** the count of `test_file_keys` that are `queued` and `running`.
- **Running tier:** `runs` with `end_state IS NULL AND started_at >= daemon_started_at`, with its lane, its file count and its start. The lane is `fast`, `slow` or `null`, the store's vocabulary and that of a checkpoint: the checkpoint's one lane when it has one, else `slow` when the `slow-tier` row names the run's files, else `fast` while that row can be read, else `null` (014-06). The time bound matters: on 2026-10-21 one worktree had a run open for 21.6 h under a daemon 59 min old.
- **Checkpoint:** `checkpoints` with `completed_at IS NULL`, with the same time bound.
- **Consumers:** each `consumers` row, with its harness process from `harness-process:<id>`, alive or gone by `/proc/<pid>/stat` and its start time, and its hook version from `consumer-version:<id>`.
- **Departure and drain:** `departed:<id>` and `slow-tier:<id>`.
- **Last use:** the time the daemon was last used (D9). Until the daemon records it, the idle and unused clocks exist only in its memory.

A row whose start is earlier than the lock holder's process start is a predecessor's (D2's start rule, `ownStartOn`): the daemon is `starting`, and the row's record, token, runs, checkpoints and last use are not read as its own, so the predecessor's escaped processes are not attributed to it (`reviews/wave-1.md` B1). The consumers and the pending count are the worktree's and stay.

The settings each rule needs (`daemon.idleExitMinutes`, `daemon.unusedExitMinutes`, `runner.timeoutMs`) come from the daemon's own `squeal.config.json`, through the loader that never throws (C10). Each daemon has its own values.

The store is read so that it creates no file (goal 4; `lessons.md` P6, 014-26). When `-wal` and `-shm` both exist, SQLite's WAL reader opens them and creates nothing. With no `-wal`, or an empty one, the database file has every commit: `ps` opens it as a `file:` URL with `immutable=1`, which opens no other file, and checks the database file's inode, size, mtime and ctime before and after; a change makes the work of each daemon of that store unknown. A `-wal` that holds frames with no `-shm` is a crash's: `ps` reads nothing and names those daemons' work unknown (`reviews/wave-4.md` B1). One limit stays: if the store's last connection closes in the about 0.1 ms between that check and the reader's first read, the reader makes `-wal` and `-shm` again; its read stays right, and no `node:sqlite` open mode avoids it (N1; only a read lock taken before the check would, and Node has no `fcntl`). The open runs are one query per store and reading (`end_state IS NULL`), filtered per daemon by worktree and `started_at >= daemon_started_at` (014-23).

### D4. Measurement

From `research/process-measurement.md`:

- **CPU:** read `/proc/<pid>/stat` twice, 2 s apart. Show the CPU over those 2 s in percent of one CPU, and the cumulative CPU time beside it. Never show a lifetime percent: it was more than 5 points off for 12 of 22 daemons. The 2 s window has about half the 90th-percentile error of 1 s (17 to 18 points against 31 to 33). Vitest pool threads are threads of the daemon, so their CPU is the daemon's. A row's CPU over the window also counts what ended or started inside it (014-21, `lessons.md` P2): the growth of its children's times (`cutime + cstime`), less the first-reading ticks of each child that ended; all ticks of each process born in the window; and the growth of processes under a daemon that are no rows (a daemon's own `git`). Each part counts in the nearest ancestor row that lived through the window, and a row never reads below its own growth. A parent waited for an ended child only when it lived through the window, is no zombie at the second reading, has readable children's times, and those grew by at least what its ended children had at the first reading; then `reapedBy` names the row that holds the CPU. Otherwise the ticks still come off, the CPU is a lower bound, and `reaperUnknown` marks the ended row, or the row holding the bound (`reviews/wave-4.md` B3). On a source without children's times (D10) each row that lived gets `childCpuUnread`. `cpuMs` stays the process's own. The second reading takes every process below Squeal's and every process born since the first; the flags still read the pids they read before. A reused pid inside the window is missed.
- **Memory:** per process, the private memory (`RssAnon + RssShmem`) and the swap (`VmSwap`) from `/proc/<pid>/status`. Totals sum the same two values, so nothing is counted twice. Private memory equalled USS for every daemon. Summed RSS counts shared file pages once per process (+13 to 15%). It is never summed. Memory is read right after the second `stat` read, before the stores are read again (014-24, `lessons.md` P4). A process gone at that read, or a zombie, holds none and adds 0; a process alive with no readable memory makes the total a lower bound.
- **Reads:** all reads are synchronous and serial, and they run inside the 2 s window, but for the second `/proc/locks` reading and the pool, which are read at its end (014-31), and the D7 rules' own reads (arguments, working directories, open files, sockets and directories), which run after the second sample (`snapshot.ts`, counted in `snapshot-cost.test.ts`; quality `quality/2026-10.md` slice 9). Reads through the libuv pool cost 3 to 8 times the CPU. Without `smaps`, the reads took 57 to 126 ms wall and 60 to 85 ms CPU for about 630 processes at load 41 to 45.

### D5. Test processes

Built from the same `stat` scan (`research/process-measurement.md` 3):

- **Owner:** the daemon is the nearest daemon ancestor in the ppid tree. When there is none, the owner is the daemon whose token (`daemon-token:<id>` in its store) the process's `SQUEAL_DAEMON_CHILD` mark carries. That links a process that escaped its daemon, such as a test's browser.
- **Lane:** the part of the mark after the token (`vitest`, `slow:vitest`, `<lane>#<runId>`).
- **Run:** the mark's `#<runId>`; else the daemon's only open tier whose lane is the mark's class (`slow` for a lane that starts with `slow:`, else `fast`); else the daemon's one open tier when its lane is `null`; else `null` (014-07).
- **Runner and files:** from the command line. A Vitest fork worker ends in `vitest/dist/workers/forks.js`, and its files are those of its tier's open run, not per worker. A node:test process names its file after `--test ...`, and a pytest batch names its files after `--basetemp=<dir>`.
- **Nice:** field 19 of `stat`. Ionice is not read, because Node has no binding and it would cost a spawn.
- **Descendants:** a test process's descendants without a mark (a test's `git`, servers or browsers) are summed into it as `+N children`, with their CPU and memory. `--full` lists them. A test process without descendants prints its own values; with them, a column is the sum, and unknown (`?`) when its own value is (014-13r, `reviews/wave-2.md` B3). A descendant that ended adds 0 memory, and its CPU counts in the process that waited for it (014-24); a sum that leaves a value out, or holds a lower-bound CPU (D4), prints `+` after the column.
- `ps` reads only the `SQUEAL_DAEMON_CHILD` variable of a process's `environ`. It never prints, stores or emits any other environment value.

### D6. Host totals

From `research/process-measurement.md` 4:

- `/proc/loadavg`; `/proc/pressure/cpu` `some avg10` and `/proc/pressure/memory` `some` and `full avg10`; `MemTotal`, `MemAvailable` and swap from `/proc/meminfo`, read at every snapshot; and `os.availableParallelism()`, which follows the CPU affinity and a cgroup's `cpu.max`.
- Squeal's CPU share is Squeal's CPU over the window divided by the host's busy CPU from `/proc/stat` over the same window. Squeal's memory share is Squeal's private memory divided by `MemTotal - MemAvailable`. Swap is stated apart. Either share is a lower bound when its total leaves a value out, or holds a CPU value that is itself a lower bound (an unsure reaper, or a source without children's times, D4): the Squeal and repository lines then print `at least`, and `unknown` names what is missing (014-21, 014-24, `reviews/wave-4.md` B3, S1).
- **The capacity pool:** the host's slots (C10: `capacity.hostSlots` of the user-level config file, which `PsPlaces.userConfig` names and which follows `XDG_CONFIG_HOME`), and the permits each daemon holds, from the `/proc/locks` holders of `pool.<i>.lock` and `slow*.lock`, over both readings: a permit goes to its holders in the latest reading that shows it held, so one that passed between two daemons counts once (D2 step 3, 014-31).

### D7. Flags

Every rule is read-only, from `/proc`, `/proc/locks`, `ls` and `stat`, and the read-only store. The list is `research/should-not-be-up.md` 1, with two changes: the two kinds of leftover directory are one flag, and a test daemon is named by its install, not by Squeal's own e2e paths.

| Flag | Rule | Ends it |
|---|---|---|
| `root-gone` | the root, or the `gitdir` its `.git` names, is missing | `kill <pid>` (SIGTERM runs the shutdown order; `squeal stop` refuses a missing root) |
| `install-gone` | the bundle directory in its arguments is missing | `squeal stop <root>` |
| `older` | its version is older than the newest one installed for its harness (Claude Code: `installed_plugins.json`; Codex: the newest cache directory) | `squeal stop <root>`; but see the info states below |
| `duplicate` | two daemon processes have one root | `kill <pid>` of the one without the lock |
| `no-lock` | `waiting` for more than 40 s (130 s with `--await-lock`) | `kill <pid>` |
| `hung` | `serving`, with a heartbeat older than two intervals, on two samples | `kill <pid>`, then `kill -9 <pid>` |
| `past-departure` | no consumer, departed more than 1 min ago, and no slow work | `squeal stop <root>` |
| `past-idle` | no consumer ever, and unused for more than `daemon.idleExitMinutes` (D9) | `squeal stop <root>` |
| `past-unused` | consumers, and unused for more than `daemon.unusedExitMinutes` (D9) | `squeal stop <root>` |
| `dead-consumer` | a consumer's harness process is gone, or has another start time, for more than two heartbeat intervals | none: when it stays, the daemon is `hung` |
| `not-installed` | the bundle is outside every plugin cache and the launcher, and the root is under the temp directory, for more than 1 h | `kill <pid>` |
| `orphan-test-process` | it carries a mark that no live daemon owns, on two samples at least 1 s apart | `kill <pid>` |
| `overdue-test-process` | it carries a token, is not its daemon's own child, and is older than `runner.timeoutMs` plus 60 s | `kill <pid>` |
| `orphan-waiter` | a `waiter.mjs` process whose parent is gone or is `systemd --user` | `kill <pid>` |
| `stale-socket` | a `squeal-<id>.sock` file with no live daemon of `<id>` holding its lock | `rm <path>` |
| `stale-pool-mark` | a `pool.mark.*` file older than 30 s (`SLOT_WAITER_FRESH_MS`) | `rm <path>` |
| `foreign-permit` | a `pool.<i>.lock` or `slow*.lock` holder that is no daemon | `kill <pid>` |
| `leftover-temp` | a directory of a name Squeal makes (a key directory `<16 hex>` or `<16 hex>.old-<8 hex>` under `/tmp/squeal-<uid>/tmp/`; `/tmp/squeal-<uid>-<key>-XXXXXX`; `/tmp/squeal-e2e-XXXXXX`, `squeal-e2e-oc-XXXXXX`, `squeal-e2e-pi-XXXXXX` and `squeal-update-XXXXXX`, XXXXXX being `mkdtemp`'s six letters and digits) that no live daemon's key names and no process has as its working directory, in its arguments, as a bound unix socket or as an open file, with an mtime older than 1 h | `squeal ps --leftovers \| xargs -d '\n' rm -rf --` |

Three states are information, never flags, and each says why:

- `draining <N>m left`: no consumer, `departed` is set, slow work waits, and the departure was less than `daemon.idleExitMinutes` ago. This is the rule of 004-29.
- `older`, while a consumer registered with that older version has a live harness process: `older (session <pid> holds it)`. C9 asks no step-down then, and a stop would make that session's next edit start the old version again.
- `draining <N>m left, older`: an `older` daemon that is `draining`. The drain ends it at its deadline, and a stop before would end the work it drains. From `daemon.idleExitMinutes` after the departure it is flagged `older` again, with `squeal stop <root>` (014-38, the human, 2026-10-22).

On 2026-10-21, at load 24 to 42, the list flagged no live daemon. It found 4 draining daemons, 1 older daemon held by its session, 1 stale socket, 1 stale pool mark and 3,530 leftover directories (`research/should-not-be-up.md` 2). Two flags need a second sample: `hung` and `orphan-test-process` are confirmed by a second read at the end of the CPU window, because one false orphan showed on a single sample.

Rules the table leaves open, as 014-10 built them: an open checkpoint is drain work, as slow work is (001-219), and a departure older than the daemon's own start is its predecessor's; `past-idle` reads `activeAt` and `past-unused` reads `usedAt`, as `lifecycle.ts` does, each with two heartbeat intervals of grace and on a `serving` daemon only; `dead-consumer` needs the harness gone on both readings and a heartbeat between them that kept the consumer, since the store keeps no time of death; `older` reads the installed version from the daemon's own install (`installed_plugins.json` or the Codex cache), for Claude Code and Codex only; on Linux a duplicate's waiter gets `duplicate` with `no-lock` after that bound; `hung`'s command is `kill <pid>; sleep 5; kill -9 <pid>`; `not-installed` counts a plugin-cache script under the home directory, or anything under `~/.local`, as installed; an overdue descendant is flagged on its head test process's row; a socket with a listener but no daemon of its id is named in `unknown`, never flagged; `leftover-temp` counts only this user's directories, never lists a name with a newline, stops with an `unknown` entry at a daemon whose root is unknown, and sums sizes over at most 10,000 entries (`null` past them, never a partial sum). `leftover-temp` is a flag like the others: it counts in the first line and the exit code (014-11, the coordinator's reading of this table over the D8 example). A directory is in use when a working directory or an argument is it or lies under it, or an argument is `<option>=` and such a path; a path is cut at `/` alone, never read as shell text, since a name may hold a space, a quote, `=` or `:`; on macOS a working directory under the temp directory's real path (`/private/tmp`) counts as a use. The rules of the whole host (`leftover-temp`'s use check, `orphan-waiter`) read the first reading's full table, since the second reads only the processes the window measures; `hung` and `orphan-test-process` still confirm on both (014-13r, `reviews/wave-2.md` B1, B2). Wave 4 (`lessons.md` P1, P5, P8): `leftover-temp` never takes another tool's `/tmp/squeal-*` directory (`squeal-evals-<uid>`, `squeal-e2e-cache`, an agent's `squeal-review-*`), nor another uid's, nor `/tmp/sq-*` (a Later item); its use reads run cheapest first (working directories, arguments, bound unix sockets, open files) and stop once every candidate is in use. The sockets are every bound name in `/proc/net/unix`, datagram and unconnected ones included; a relative name is not placed. A use read fails when the socket list cannot be read, or a process that is still there (one batched `stat` re-read; a process that left, a zombie or a reused pid is no failure) has unreadable arguments or open files; a missing working directory alone is none, since such a process's fd read fails too. When any use read fails, no candidate's non-use is proved: none is flagged, listed or in `--leftovers`, and nothing adds to the exit code. One `unknown` entry (`flag leftover-temp`) gives the count, the size with `--full`, and the unreadable processes as `pid name`, the first five then `and N more`; its `paths` holds the withheld directories, and `--leftovers` writes it to stderr, as it does when the rule is not evaluated (`reviews/wave-4.md` B2). On this host every SSH login makes such processes (`sshd`, `(sd-pam)`, `gpg-agent`, `sftp-server`; 8 of 169 on 2026-10-21), so the rule withholds every candidate while a session is open: 100 directories, 84 MiB that day. No name exemption is sound, since `sftp-server` can hold any file open. Its size walk runs with `--full` only: without it `bytes` is `null` and `unknown` gives the `du` command; with it the walk is bounded at 10,000 entries, and reads nothing when the candidates' own subdirectory link counts already pass the bound (014-23). `orphan-test-process` also needs the process to be at least 60 s old at the first reading; a younger one is named in `unknown`, not flagged (014-28).

Files whose lock the OS frees when the holder dies never get a flag: lock files, waiter lock files, permit files above the pool's size, and session-root files. `--full` counts them.

Each end command quotes its paths for the shell. A flag never runs its command.

### D8. Output

The first line is the answer: `squeal ps · 21 daemons, 38 test processes · no flags`, or `· 2 flags` followed by the flags' names. Then the host line, the Squeal line, one block per repository and the files section:

```text
squeal ps · 21 daemons, 38 test processes · 2 flags: stale-socket, leftover-temp
Host    load 36.8 41.3 51.1 on 24 CPUs · CPU pressure 45% · memory 32.7 of 47.0 GiB used, swap 4.0 of 4.0 GiB
Squeal  CPU 8.1 CPUs (36% of busy) · memory 21.0 GiB (65% of used) + 1.0 GiB swap · pool 3 of 12 permits

/home/agent/projects/cezar · 18 daemons · CPU 7.2 · memory 18.9 GiB
  STATE            PID      WORKTREE  VERSION         UP   CPU  CPU TIME  MEMORY  SWAP  WORK
  serving          3704612  f1ca49e6  0.1.235 codex  39m   30%    11m42s  2.2G    264M  backlog tier, 200 files
    vitest         3704700  fork worker               4m   12%     0m29s  310M          nice 10, +2 children
  draining 22m     2721938  aee4a33f  0.1.235 codex  61m   16%     9m10s  1.1G     80M  fast backlog; session left 38m ago
  older (session 3212240 holds it)
                   3241641  70b80c8e  0.1.234 claude 49m   12%     5m51s  821M          idle

Files no live process uses
  ! stale-socket  /run/user/1001/squeal-fd5a859b8ca77ef9.sock (2026-10-16)
      ends it: rm /run/user/1001/squeal-fd5a859b8ca77ef9.sock
  ! leftover-temp  3,530 directories (size with --full)
      ends it: squeal ps --leftovers | xargs -d '\n' rm -rf --
```

A flagged row starts with `!` and has its reason and an `ends it:` line under it. The work text prints `session left` only for the daemon's own departure: no session holds it, and the departure came after its start; `work.departedAt` stays the worktree's row (014-27, `lessons.md` P7). The numbers above are an example; their layout is the contract, and the worker who builds D8 settles the column widths.

`--json` prints one object. It is versioned (styleguide), and `render` is a layer on top of it. The types are `src/core/ps/shape.ts` (`PS_SHAPE_VERSION` 1), as amended for 014-04:

```text
{ v: 1, at, sampleMs, platform, memory: "private" | "rss",
  host: { load, cpus, cpuPressure, memoryPressure: { some, full }, memTotal, memAvailable, swapTotal, swapUsed, busyCpuPct },
  squeal: { daemons, testProcesses, cpuPct, cpuShare, privateBytes, memoryShare, swapBytes, skipped, pool: { slots, held } },
  repositories: [ { commonDir, current, cpuPct, privateBytes, swapBytes, skipped, daemons: [ {
      pid, phase, state, worktreeId, root, version, harness, startedAt, cpuPct, cpuMs, privateBytes, swapBytes, permits,
      work: { pending, running, tiers: [ { runId, lane, files, startedAt, checkpointId } ],
              checkpoints: [ { id, startedAt, lane, files } ], departedAt, drainLeftMs, lastUsedAt },
      consumers: [ { harnessPid, alive, version } ],
      processes: [ { pid, lane, runner, runId, files, escaped, cpuPct, cpuMs, privateBytes, swapBytes, nice, startedAt,
                     descendants: { count, cpuPct, cpuMs, privateBytes, swapBytes, skipped, list }, flags } ],
      flags: [ { flag, reason, command } ] } ] } ],
  orphans: [ { pid, comm, startedAt, flags } ],
  files: [ { flag, reason, path, count, bytes, command } ],
  unflaggedFiles: [ { kind, count } ] | null,
  flags: number, unknown: [ { what, why, paths? } ] }
```

`memory` says what every `privateBytes` holds: `rss` on macOS (D10), where sums count shared pages more than once. `orphans` holds the flagged processes no live daemon owns (`orphan-test-process`, `orphan-waiter`, `foreign-permit`), which have no daemon block. A key that holds a list has a plural name. `pending` and `running` count `test_file_keys`. `flags` counts every flag of the snapshot. `unflaggedFiles` counts, by kind (`lock`, `waiter-lock`, `surplus-permit`, `session-root`), the files that never get a flag (D7); it is `null` without `--full`, as `descendants.list` is. `skipped` counts, per value, what a sum left out, whole or in part (a lower-bound CPU, D4), so a total reads as a lower bound; `paths` is set only on the withheld `leftover-temp` entry (D7); the shape stays `v: 1`, because every key is additive and a row's `cpuPct` is still the CPU over the window in D4's sense (wave 4).

A value that `ps` could not read is `null`, and `unknown` names it. It never reads as zero (vision, principle 2).

### D9. Last use

The past-idle and past-unused rules need the time the daemon was last used. Today that time is only in the daemon's memory (`#lastUsed`, `#lastActive`), and no request returns it. A `squeal status` over the socket leaves no trace in the store, so a rule built from store proxies would fire early (`research/should-not-be-up.md` open questions).

The daemon writes `daemon-used:<worktree id>` in `meta` with each heartbeat: `{ v: 1, usedAt, activeAt }`. The row is the worktree's, not one daemon's: `readDaemonUsed(value, startedAt)` reads `null` when `usedAt` is earlier than the start the row records, so a row a predecessor left, under a daemon of a release that writes none, never reads as that daemon's (014-08). That is one key in the write it already does, and it needs no migration. `ps` reads it when present. For a daemon of a release without it, the two flags are not evaluated, `lastUsedAt` is `null`, and `unknown` names the daemon. This changes 011 C9; the row that adds it amends C9's text.

### D10. Platforms

Linux gets the full design of D2 to D7. macOS gets a fallback built from `ps` and the stores. Nobody has run it on a Mac: the human chose it untested (2026-10-21). Every value it cannot read is `null`, and `unknown` names it (D8). On any other platform, `squeal ps` prints one line saying the platform is not covered and exits 3, Squeal's code for no verdict.

On macOS (`process.platform` is `darwin`), from `research/daemon-discovery.md` 5 and `research/process-measurement.md` 4, all `inferred`:

- **Processes:** one `ps -axww -o pid=,ppid=,pgid=,uid=,nice=,time=,rss=,lstart=,command=` per sample, two samples 2 s apart, run as `env -u LC_ALL LC_TIME=C ps ...` so that `lstart` parses in any locale (014-12). `uid=` keeps another user's daemons out, as on Linux. `ps` gives no argument boundaries: the command is split at single spaces, so a daemon root with a space in it reads wrong; the process name is the base name of the first word, and no state (zombie) is read. The CPU is the difference in `time` over the window. Never `%cpu`, which on macOS is a decaying average. `time` gives the process's own time only, so no children's times are read, `unknown` names it once (014-21), and the Squeal and repository CPU print `at least` (`reviews/wave-4.md` S1).
- **Daemons:** from the command line, as in D2 step 1. The worktree id is the hash of the root (`worktreeIdFor`), and the store is in the root's common directory. The lock state is unknown. The phase is `serving` when the store row's record is the daemon's own (D2's start rule) and its heartbeat is within two intervals of the snapshot's clock, and `unknown` otherwise; never `starting`, `stopping` or `waiting`.
- **Memory:** RSS per process, labelled RSS. The totals are summed RSS, and they say that they count shared pages more than once. Swap per process is `null`.
- **Test processes:** by the ppid tree only. The mark is not read, so the lane is `null` and an escaped process is not attributed.
- **Host:** `os.loadavg()`, `os.availableParallelism()`, `os.totalmem()`, used memory from `vm_stat`, and swap from `sysctl vm.swapusage`. There is no pressure (`null`). The host's busy CPU comes from two `os.cpus()` samples over the window.
- **Flags not evaluated** (named in `unknown`): `no-lock`, `hung`, `foreign-permit` and the `stopping` phase, which need `/proc/locks`; `orphan-test-process` and `overdue-test-process`, which need the mark. `duplicate` is evaluated, and its end command names both pids, because which one holds the lock is unknown. `stale-socket` uses the process rule: a socket file whose id is the root hash of no daemon process. `leftover-temp` reads the working directories from one `lsof -d cwd -F pn` spawn; when that fails, it is not evaluated. It reads no bound sockets or open files there, so it withholds every candidate and its `unknown` entry says the bound unix sockets cannot be read (`reviews/wave-4.md` B2). A `ps` that fails, is missing or times out is no snapshot: exit 3 with its error (D1); a `ps` that lists no process is an empty host (014-13r, `reviews/wave-2.md` B4).
- **Paths:** the socket and temp directories are those the daemon uses there (011 C9: `/tmp/squeal-<uid>` when `XDG_RUNTIME_DIR` is unset).
- **Tests:** the parsers run against fixture outputs of `ps`, `vm_stat`, `sysctl` and `lsof` on Linux CI. No test runs on macOS, and the dogfood row covers Linux only. The first run on a Mac goes to `lessons.md`.

### D11. Modules

- `src/core/ps/source.ts`: the interface between the platform and the rest: process table, per-process reads, locks, host files.
- `src/core/ps/proc.ts`: the Linux source, reading `/proc` under a root path that tests replace with a fixture tree.
- `src/core/ps/darwin.ts`: the macOS source (D10), over an injected command runner that tests replace with fixture outputs.
- `src/core/ps/shape.ts`: the D8 JSON types only, the public and versioned contract. `src/core/ps/model.ts`: the model the stages pass and one function type per stage; it imports from `shape.ts`, never the reverse (014-04).
- `src/core/ps/discover.ts` (D2), `work.ts` (D3), `measure.ts` (D4), `processes.ts` (D5), `host.ts` (D6), `flags.ts` (D7, with `flags-files.ts`, `flags-leftovers.ts`, `flags-processes.ts` and `flags-text.ts`), `snapshot.ts` (D1 and D4: the window and the stages in their order), `snapshot-shape.ts` (the D8 shape of one snapshot), `snapshot-unknown.ts` (the D8 `unknown` entries the stages do not name), `render.ts` (the D8 text) and `render-units.ts` (how it prints a value). `PsSource.processTable(pids, since)` takes the processes born since the first reading (014-21).
- `src/cli/ps.ts`: argument parsing, the sample and the exit code; an entry in `main.ts` and its help text.
- `src/cli/ps-index.ts`: the entry of `dist/cli/ps.mjs`, a bundle of `ps` alone, so `squeal ps` loads only its own code (goal 6, 014-33). The Claude Code and OpenCode `bin/squeal`, and the launcher from format 5, run it for `ps`. It hands every other command, and `ps --help`, to `squeal.mjs` beside it. `node squeal.mjs ps` still works, at the cost of loading the whole CLI; Pi's command names `squeal.mjs`.
- D9's heartbeat write belongs to the daemon (`src/core/daemon/`).

## Testing

- **Unit:** each module against fixture `/proc` trees and fixture stores. The fixtures come from the probe logs of `research/` (anonymized paths). Each D7 flag has a case that flags it and a case of the healthy state it could wrongly flag (`research/should-not-be-up.md` 1, the fifth column).
- **No side effects:** a test runs `ps` against a live store and a listening socket. It asserts that the store's bytes and mtime did not change and that the socket accepted no connection.
- **Integration:** start a real daemon in a scratch repository, with `HOME`, `XDG_RUNTIME_DIR` and `TMPDIR` under a temp directory. `ps` finds it `serving`, ties its socket, and lists its test processes during a tier. After a SIGKILL it flags `stale-socket`, and after the root is removed under a SIGSTOPped daemon it flags `root-gone`.
- **Cost:** a test asserts the reads outside the window stay under a bound on a fixture of 650 processes. Goal 6 is measured on this host in the proof row, with the load recorded.
- **Proof:** an e2e case runs the shipped bundle's `squeal ps --json` beside a daemon. A dogfood row runs `ps` on this host during ordinary work, compares it with `ps`, `top` and `/proc` by hand, and writes the result to `lessons.md`.

## Open questions

Resolved at the review (the human, 2026-10-21): D9 yes, as its own row; D10 adds the untested macOS fallback. None is open.

Recorded for other specs, as board Later items:

- 004 and 011: a departure drain runs the whole fast backlog for a session that is gone (4 daemons, 3,976 MiB on 2026-10-21).
- 011: 3,446 temp key directories from 2026-10-14 on, 104 to 845 a day, most of them from Squeal's own tests (inferred); and 84 e2e fixture directories, 6.3 GiB, an older Later item.
- 011: a 2.2 GB daemon held about 1.57 GiB in its JS heap. Nothing reads the heap inside the daemon today.

## References

- The human's decisions, 2026-10-21: `status.md`.
- Research: `research/daemon-discovery.md` (014-01), `research/process-measurement.md` (014-02), `research/should-not-be-up.md` (014-03), with their probes.
- Spec 011 C1, C7, C9, C10, C13; 004 D2; 012 CC4.
- Prior art: `docker ps`, `docker stats`, `pm2 ls`, `gradle --status`, `nx daemon`, `watchman watch-list`, `systemd-cgtop` (`research/should-not-be-up.md` 4).
