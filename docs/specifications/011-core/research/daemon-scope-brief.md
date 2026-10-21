# Research brief 011-52: one daemon per repository instead of one per worktree

Use /researcher. Shape: research. Outcome: whether one daemon per repository (every worktree of one git common directory) would now cost clearly less than one daemon per worktree, by how much, and what it would break or fix, measured against this host's actual use.

## Why now

Squeal runs one daemon per worktree (011 C1, C9). On 2026-10-13 a host-wide broker was ruled out (`../../001-core-loop/research/host-capacity.md` 4C and recommendation 5): Vitest runs in the daemon's process with the worktree root as its cwd, one process has one cwd and one environment, the environment hash holds the Node version, and a broker concentrates failure and needs its own handover. That ruling was about CPU capacity across the host. It did not weigh memory or a daemon per repository.

The data has changed. On 2026-10-13, 17 daemons held 7.7 GiB RSS. On 2026-10-21, 21 to 22 daemons held 16.6 GiB RSS, Squeal's private memory was 63 to 67% of the host's used memory, and swap was full. 14 daemons served one repository (cezar). One daemon held 2.2 GB, about 1.57 GiB of it JS heap. Four draining daemons held 24% of daemon memory (`../../014-ps/research/process-measurement.md` 2 and 4, `should-not-be-up.md` 2).

## Read first

011 C1, C9, C10 Capacity, C13; the 013 spec where the Vitest instance needs the root or the cwd; `host-capacity.md`, `watcher-daemon-and-shared-store.md`, `daemon-under-harnesses.md` (all under `001-core-loop/research/`); 014's three findings files and their probe logs; issues #27, #47, #50, #58, #60, #61, #63, #69 and their `research/issue-*.md`; the board's Later items on the drain, the temp directories and the daemon heap.

## Questions

1. **Where a daemon's memory goes.** Split a daemon's private memory into what is per worktree (the Vitest and Vite instance and its module graph, the watcher, the hash cache, node:test and pytest graphs) and what a repository daemon would hold once (the Node runtime, the code, store connections and caches). Is the 1.57 GiB heap per-worktree work, growth with uptime, or a leak? Relate memory to uptime, worktree size and project. Outside a daemon you own, read only `/proc`.
2. **The cwd and environment constraint today.** Do the installed Vitest versions still need `process.cwd()` at the root? Which Squeal code depends on the cwd, `process.env` or the Node binary per worktree? What breaks when two worktrees share one process?
3. **Designs and their savings.** Estimate memory and CPU on the 2026-10-21 population for at least: (a) today with lifecycle fixes (drain, idle and unused exits); (b) today with a smaller heap; (c) one repository daemon that owns the watchers, the scheduler, the store and the socket, with one runner child process per active worktree; (d) one repository daemon with every runner in its own process.
4. **What it changes.** For the leading repository design: handover across releases and harnesses (#47, #50, older-release consumers, C9 step-down), the blast radius of a hang or crash, the cgroup of the harness that spawns it, worktree destroy (#27), scheduling across worktrees (#58, #63, #69, C10), per-worktree environment and Node version, and the socket, lock and store layout. Which open issues it closes or eases, which it makes harder.
5. **Usage.** From the stores, read-only, since 2026-10-13: worktrees live at once per repository, their lifetimes, how many sit idle (no revision for 30 min) while their daemon runs, how often two worktrees share one commit.
6. **Prior art** (`read in official docs`): Bazel, Gradle, Nx, Turborepo, Watchman, tsserver, rust-analyzer: one process per checkout, per repository or per host, and how each handles several checkouts of one repository.

## Rules

Follow `../../014-ps/research/README.md`, "Rules for every brief": the live host is read-only evidence, your own scratch daemon only with isolated `HOME`, `XDG_*` and `TMPDIR`, at most five test files, no build, the load beside every timing. Skip a live experiment while the one-minute load is above the CPU count, and say so. A `process.memoryUsage()` or heap snapshot is allowed only in a daemon you started. Budget about two hours.

Own `daemon-scope.md` and `probes/daemon-scope/` only. Edit no board, spec, status, test or product file.

Done when every numbered question has a tagged answer or "not determined, because", and the recommendation picks one of keep, fix the lifecycle, shrink the heap, or a repository daemon, with the saving in GiB, the cost in risk and work, and its limits. Commit.
