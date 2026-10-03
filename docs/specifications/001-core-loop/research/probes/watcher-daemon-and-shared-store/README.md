# Probes: watcher-daemon-and-shared-store

**Throwaway.** Everything in this folder is a research probe for `../../watcher-daemon-and-shared-store.md`. It is not product code, is not tested, and must not be imported or copied into Squeal. Delete it whenever it stops being useful.

Host: Ubuntu 24.04, kernel 6.8, x86_64, 24 cores (load average 17 to 29 during runs, so timings are noisy). Node v24.21.0, git 2.43.0. `max_user_watches` 375518, `max_queued_events` 16384.

Setup: `npm install` (chokidar 5.0.0, @parcel/watcher 2.6.0, better-sqlite3 13.0.3, ignore). Probes write to `./tmp/` and clean up. Raw outputs are in `results/`.

| Probe | What it checks | Output |
| --- | --- | --- |
| `watch-bench.mjs <fswatch\|chokidar\|parcel> [srcDirs] [ignoredDirs]` | startup, inotify watch count, latency, atomic save, new dirs, 1000-file storm, dir rename, rm -rf, ignored paths | `results/watch-*.json`, `results/watch-scale-*.json` |
| `rename-repro.mjs <backend>` | writes inside a directory after it was renamed | `results/rename.ndjson` |
| `atomic-repro.mjs <backend>` | a plain write after an atomic save (tmp + rename over) | `results/atomic.txt` |
| `newtree-repro.mjs <backend>` | copying a 300-file tree into the watched root | `results/newtree.ndjson` |
| `overflow-repro.mjs <backend> [n] [waitMs]` | 40k-file burst while the JS thread is blocked | `results/overflow.ndjson` |
| `worktree-probe.mjs <backend>` | `git worktree add` under the root; `git worktree remove` of the watched root | `results/worktree-probe.ndjson` |
| `git-probe.sh` | `rev-parse` / `worktree list` from main, subdir, nested worktree, bare repo | `results/git-probe.txt` |
| `gitignore-probe.sh` | cost and semantics of `git ls-files -oi` and `git check-ignore --stdin` | `results/gitignore-probe.txt` |
| `store-setup.mjs` + `bench-hook.mjs` (+ `hook-read.mjs`) | cold-process hook read latency: node:sqlite, better-sqlite3, JSON | `results/hook-read.json` |
| `concurrency.mjs <sqlite\|json-lock\|json-nolock> [w] [r]` | 4 writer + 4 reader processes on one store | `results/concurrency.ndjson` |
| `crash.mjs [n]` | SIGKILL a SQLite writer n times, then integrity check | `results/crash.json` |
| `daemon-probe.mjs <race\|crash\|hook-spawn\|pathlen\|rtt>` | singleton lock, crash recovery, detached spawn, socket path limit, IPC round trip | `results/daemon.ndjson` |
