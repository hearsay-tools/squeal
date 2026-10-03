# Research: watcher, daemon and shared store

Topic: `watcher-daemon-and-shared-store` (see `README.md`). Researched 2026-10-03.

Experiments ran on Linux only: Ubuntu 24.04, kernel 6.8, Node v24.21.0 (plus v22.23.3 for one check), git 2.43.0, chokidar 5.0.0, @parcel/watcher 2.6.0, better-sqlite3 13.0.3, SQLite 3.53.4. The host was under load (load average 17 to 29), so treat timings as rough. **Nothing was run on macOS.** macOS findings come from source code, docs and issue trackers and are marked that way. Probes and raw output: `probes/watcher-daemon-and-shared-store/` (throwaway).

## Questions answered

1. Watcher choice on Linux and macOS: chokidar vs @parcel/watcher vs recursive `fs.watch`.
2. Honouring `.gitignore` and excluding nested worktrees.
3. Locating the main worktree and the shared store from any worktree.
4. Store format and concurrency: SQLite vs JSON files.
5. Daemon lifecycle: start, discover, singleton, stale detection, worktree removal.
6. Hook-to-daemon communication.

## Findings

### 1. Watchers

Bench: 500 source dirs, 3,000 ignored `node_modules` dirs, 200 nested-worktree dirs; scale run 5,000 / 20,000 (`results/watch-*.json`). All verified by experiment, Linux, versions above.

| | `fs.watch` recursive | chokidar 5.0.0 | @parcel/watcher 2.6.0 |
| --- | --- | --- | --- |
| Ready, small / scale tree | 711 / 1,447 ms | 743 / 1,109 ms | 70 / 133 ms |
| inotify watches, small / scale | 7,359 / 50,359 | 1,053 / 10,053 | 553 / 5,053 |
| RSS at scale | 295 MB | 307 MB | 80 MB |
| Write after an atomic save (tmp + rename over) | **lost**, every run | reported | reported |
| Writes inside a directory after it was renamed | reported | reported | **lost or reported under the old path**, 3 of 3 runs |
| Files in a 300-file tree copied into the root | 300 | 300 | **290 and 280** |
| 40k-file burst, time to last event | not run | 2.7 s (one run over 5 s) | 0.24 s |
| Root deleted by `git worktree remove` | `rename` | `unlinkDir` | `delete` |

- **Node `fs.watch({recursive:true})` on Linux is unusable for Squeal.** It is a JS emulation that puts one inotify watch on every file and directory, ignored or not. After a file is replaced by rename, its watch stays on the dead inode and later writes are never reported (`results/atomic.txt`). Cause: `#watchFile` keeps one watcher per path and `#watchFolder` skips paths it already knows. Read in source code, `lib/internal/fs/recursive_watch.js` at v24.21.0. An `ignore` option exists in v24.21.0 (PR #61433). It is absent in v22.22.0 and v24.10.0 (read in source code). On macOS, recursive `fs.watch` on a directory goes through libuv's FSEvents stream with 50 ms latency. libuv silently drops FSEvents "events were dropped, rescan" flags, so a consumer never learns about loss (read in source code, libuv v1.x `src/unix/fsevents.c`).
- **chokidar 5** passed every correctness scenario on Linux. It is pure JS with one dependency (`readdirp`) and needs Node 20.19 or later. It watches every file individually as well as every directory, which is why it uses twice parcel's watches (read in source code, `handler.js` `_handleFile`). It drains big bursts slowly because it stats and re-reads directories in JS. Its `atomic` option collapses tmp-and-rename saves into one `change` (verified by experiment). Since v4 it no longer uses fsevents (read in official docs, README changelog). On macOS each watched file therefore needs a kqueue file descriptor (read in source code, libuv `kqueue.c`, which uses FSEvents only for directories). Open issues report EMFILE/EBADF on large trees and with many watchers on macOS: #1385, #1452. Node raises the soft fd limit at startup (read in source code, `src/node.cc`), but macOS caps `RLIMIT_NOFILE` at `OPEN_MAX` (10,240) (inferred). A repo with more than about 10k files would exhaust it. Also open: #1471 (files missed in new directories; not reproduced here, 600 of 600), #1455 (throttling drops updates).
- **@parcel/watcher** is the fastest and leanest by a factor of 5 to 10, and its `ignore` keeps ignored trees out of the kernel. On Linux it has two correctness bugs that matter here: renamed directories keep stale watch paths, and files created in brand-new directories are missed. The second one is open as PR #270 ("watch directories nested in a new directory on Linux"). It drops `IN_Q_OVERFLOW` silently (read in source code, `src/linux/InotifyBackend.cc`). On macOS it uses FSEvents with file-level events and 1 ms latency, needs no per-file descriptors, and reports dropped events as an error that says "File system must be re-scanned" (read in source code, `src/macos/FSEventsBackend.cc`). It is a native addon. npm 11 blocked its install script, but the prebuilt `linux-x64-glibc` binary loaded anyway (verified by experiment).
- Latency is not a differentiator. First event for a single write arrived in 5 to 24 ms on all three (verified by experiment, single samples).
- No backend reported inotify queue overflow, in source or in practice. A 40k burst did not lose events on chokidar or parcel here (verified by experiment). Every backend can miss events in some edge case, so a watcher event can only be a hint (inferred).

### 2. `.gitignore` and nested worktrees

- In this repo `.ai/` is **not** gitignored. `git status --untracked-files=all` in the main checkout lists `?? .ai/cezar/worktrees/<id>/` as one opaque entry and never descends into it (verified by experiment, read-only). Git treats any directory containing a `.git` entry as a separate repository. So gitignore rules alone do not exclude nested worktrees. `git check-ignore` also reports a path inside a nested worktree as not ignored (verified by experiment).
- Cheap nested-worktree test: `lstat(<dir>/.git)` exists and `<dir>` is not the root. This also catches independent clones and submodules. `git worktree add` creates the directory before the `.git` file, so a watcher has often already descended into it. `fs.watch` reported 333 events from inside a freshly added nested worktree, including its `.git` (verified by experiment). The exclusion has to react to a `.git` entry appearing, not only run at startup.
- Git can be the source of truth for ignore semantics, cheaply. `git ls-files --others --ignored --exclude-standard --directory` returns ignored entries collapsed to directories (`node_modules/`, `dist/`) in 5 ms. `git check-ignore --stdin --verbose --non-matching` classifies a batch in 2 ms. It honours nested `.gitignore`, `.git/info/exclude` and `core.excludesFile` (verified by experiment, 2k-dir fixture). Re-implementing these rules with the `ignore` npm package is possible but has to replicate all three sources (inferred).

### 3. Locating the main worktree and the store

- `git rev-parse --git-common-dir` prints a **relative** path from the main worktree (`.git`, or `../../.git` from a subdirectory) and an absolute one from linked worktrees. `--path-format=absolute` (git 2.31 and later) always prints an absolute path. It took 1.9 ms per call (verified by experiment, `results/git-probe.txt`).
- `git worktree list --porcelain` lists the main worktree first (read in official docs). In a bare repo that first entry is the bare directory, marked `bare`. There is no main checkout, and `--show-toplevel` fails there (verified by experiment).
- The commit checked out in the main worktree does not matter. Main on `b50f58d` and a nested worktree on `ad9bcc4` resolve to the same common dir (verified by experiment). This repo has the same shape: main on `88fda2e`, worktrees on `392fa4f`.
- Without spawning git: if `<root>/.git` is a directory, it is the common dir. If it is a file, read its `gitdir:` path and then `<gitdir>/commondir`, which is relative to the gitdir. The file contained `../..` (verified by experiment; the format is read in official docs, gitrepository-layout).

### 4. Store format and concurrency

- `node:sqlite` on v24.21.0 is "Stability 1.2, release candidate" since v24.15.0. It loads with no flag and no warning. On v22.23.3 it loads with no flag but prints an `ExperimentalWarning` to stderr, which `--disable-warning=ExperimentalWarning` suppresses. It is unflagged since v22.13.0 and has a `timeout` (busy timeout) option. All verified by experiment, plus the docs.
- Cold hook process, 60 runs, median / p95 ms: bare `node` 48.6 / 54.3; node:sqlite query 57.5 / 64.4; better-sqlite3 65.8 / 76.5; parsing a 2 MB JSON store 65.0 / 72.8. Node startup is about 85% of the cost. The store choice adds 9 to 17 ms (verified by experiment, `results/hook-read.json`).
- 4 writer and 4 reader processes, 200 transactions of 50 rows per writer (`results/concurrency.ndjson`, verified by experiment):

| | Writer tx p50 / p99 | Reads done | Read p50 / p99 | Rows kept |
| --- | --- | --- | --- | --- |
| SQLite WAL, `BEGIN IMMEDIATE`, busy timeout | 0.19 / 7.3 ms | 16,916 | 0.45 / 19.1 ms | 40,000 of 40,000, 0 errors |
| JSON + `wx` lock file + atomic rename | 94 / 730 ms | 875 | 15.5 / 53.5 ms | 40,000 of 40,000 |
| JSON + atomic rename, no lock | 27 / 65 ms | 1,042 | 14.4 / 35.0 ms | **10,000 of 40,000** |

- Crash safety: 20 SIGKILLs of a SQLite writer mid-stream. `integrity_check` returned `ok` every time and no transaction was half-applied (verified by experiment, `results/crash.json`). WAL with `synchronous=NORMAL` survives an application crash. It can roll back the last commits after power loss, without corruption (read in official docs, sqlite.org/pragma.html). A JSON lock file left by a killed writer blocks every other writer until something removes it (inferred from the probe design; not run).
- WAL requires every process to be on the same host. It does not work over network filesystems (read in official docs, sqlite.org/wal.html).
- Migrations: SQLite gives transactional DDL and `PRAGMA user_version`. JSON needs a hand-rolled version field plus rewrite-under-lock (inferred).

### 5. Daemon lifecycle

All verified by experiment on Linux (`results/daemon.ndjson`) unless marked.

- **Singleton without stale locks:** the daemon holds `BEGIN EXCLUSIVE` with `locking_mode=EXCLUSIVE` on a small per-worktree lock database for its whole life. Five daemons started at once: 1 served, 4 got "database is locked" and exited. After SIGKILL the OS released the lock immediately. A replacement was serving 76 ms after spawn. No pid file is needed, so pid reuse after a crash or sleep cannot fool it. On macOS this relies on the same POSIX `fcntl` locks (inferred).
- A killed daemon leaves its socket file behind. Clients get `ECONNREFUSED` in 1.7 ms. The lock holder can safely unlink and re-bind, because holding the lock proves no live owner exists.
- **Socket path limit:** 108 bytes bound and 120 failed with `EINVAL` on Linux. macOS allows 104 (inferred from `sys/un.h`). This worktree's root path alone is 84 characters. A socket inside a nested worktree will overflow on macOS, so sockets belong in a short directory (`$XDG_RUNTIME_DIR` or `os.tmpdir()`), named by a hash.
- **Starting from a hook:** `spawn(node, [daemon], {detached: true, stdio: 'ignore'}).unref()` returned in 68.5 ms of hook wall time. The daemon survived a SIGKILL of the hook's whole process group, which is what a harness timeout does (verified by experiment). Claude Code's exact kill behaviour was not tested.
- **Worktree removed:** all three backends emit a root-deletion event on `git worktree remove` (verified by experiment). Git also deletes `<common-dir>/worktrees/<name>` (read in official docs, git-worktree).
- Sleep: the lock and the socket do not depend on time or pids. Whether inotify or FSEvents drop events across suspend was not tested (open question).

### 6. Hook-to-daemon communication

- A warm round trip took 0.21 ms over a unix socket and 0.46 ms over HTTP `fetch` to 127.0.0.1. A cold hook is about 50 ms either way, dominated by Node startup (verified by experiment).
- Reading the store directly needs no running daemon. Its p99 under write load was 19 ms. A dead daemon cannot block it (verified by experiment). A hung daemon would block a socket call until its timeout. The probe client used a 100 ms socket timeout (`daemon-probe.mjs client`).
- Local HTTP needs port allocation, a discovery file, and access control: any local process can reach a loopback port. A unix socket inherits file permissions (inferred).
- `node:sqlite` and `node:net` are built in, so hook scripts stay dependency-free, as ADR 0001 expects. better-sqlite3 would need a native module in the hook's environment.

## Recommendation for Squeal

1. **Watcher:** do not use `fs.watch` recursive on Linux. Put the watcher behind one small internal interface. Use **chokidar 5 on Linux**: the only backend that passed every scenario, pure JS. Use **@parcel/watcher on macOS**: FSEvents, no per-file descriptors, reports dropped events. Treat events as hints. Before calling a result current, compare `mtime`+`size` (or hashes) of the check's inputs, so a missed event costs latency, not correctness. If one dependency is required, choose parcel everywhere and add a subtree rescan after every directory create or rename on Linux; this has not been verified.
2. **Ignores:** use three layers. (a) At watch level, exclude `.git`, every directory below the root that contains a `.git` entry, and the startup list from `git ls-files -oi --exclude-standard --directory`. (b) At event level, run each debounced batch through one `git check-ignore --stdin` call. (c) Recompute (a) when any `.gitignore` changes or a `.git` entry appears.
3. **Store location:** `$(git rev-parse --path-format=absolute --git-common-dir)/squeal/`. In a normal repo that is inside the main worktree (`.git/squeal/`), which matches the status decision. It also works for bare repos and any checked-out commit. Hooks can resolve it from the `.git` file without spawning git. Watchers never see it and it cannot be committed.
4. **Store format:** **SQLite through `node:sqlite`**, WAL, `synchronous=NORMAL`, a busy timeout on every connection, short `BEGIN IMMEDIATE` write transactions, `user_version` migrations. Not JSON: it lost 75% of updates without a lock, and with a lock it was 500 times slower per write and left a stale-lock hazard. Require Node 22.13 or later. Launch hooks with `--disable-warning=ExperimentalWarning` until the floor is Node 24.
5. **Lifecycle:** there is one SQLite exclusive lock per worktree under the store; the lock is the singleton. The hook probes the socket with a 100 ms timeout. On `ENOENT` or `ECONNREFUSED` it spawns a detached daemon and returns without waiting. Daemons that lose the lock race exit. The lock owner unlinks any stale socket and binds `<short tmp dir>/squeal-<hash>.sock`, recording the path in the store. The daemon exits when its root is deleted or its `<common-dir>/worktrees/<name>` entry disappears.
6. **Hook transport:** hooks **read the store directly** for status and deltas. The unix socket is only for liveness and fire-and-forget nudges, with a hard timeout. No HTTP.

## Open questions

- macOS: none of this was run there. Confirm chokidar's fd usage and parcel's rename and new-directory behaviour on FSEvents, the 104-byte socket limit, and `fcntl` lock release.
- Should gitignored files inside a check's known dependency closure be watched anyway (generated code, `.env`)? Is a submodule, which the `.git` rule excludes, ever an input? This depends on the fingerprinting topic.
- Several Squeal versions sharing one store: what does a daemon do when it sees a newer `user_version`?
- Events lost across machine sleep or inotify overflow are never signalled on Linux. Is a periodic reconciliation scan needed, and how often?
- When should an idle daemon exit, and how does status report "no daemon running" honestly?
- Which `node` binary runs Claude Code hooks, and is Node 22.13 or later guaranteed there?
- Containers or VMs that share a worktree across hosts would break WAL. Is that a supported setup?

## Sources

- Node v24.21.0: `doc/api/fs.md` (`fs.watch`), `doc/api/sqlite.md`, `lib/internal/fs/recursive_watch.js`, `src/node.cc` (fd limit), all at https://github.com/nodejs/node/tree/v24.21.0. PRs nodejs/node#61433 (`ignore` option), #61262 (sqlite RC), #55890 (sqlite unflagged).
- libuv v1.x: `src/unix/fsevents.c`, `src/unix/kqueue.c`, `src/unix/linux.c`, https://github.com/libuv/libuv
- @parcel/watcher: README, `src/macos/FSEventsBackend.cc`, `src/linux/InotifyBackend.cc`, PR #270, https://github.com/parcel-bundler/watcher
- chokidar 5.0.0: `README.md`, `handler.js`. Issues #1385, #1452, #1455, #1471, https://github.com/paulmillr/chokidar
- SQLite: https://sqlite.org/wal.html, https://sqlite.org/pragma.html#pragma_synchronous
- git: https://git-scm.com/docs/git-rev-parse, https://git-scm.com/docs/git-worktree, https://git-scm.com/docs/gitrepository-layout
- Probes and raw results: `probes/watcher-daemon-and-shared-store/README.md`, `probes/watcher-daemon-and-shared-store/results/`
