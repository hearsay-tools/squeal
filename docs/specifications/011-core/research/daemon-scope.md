# 011-52: one daemon per repository instead of one per worktree

Researcher, 2026-10-21. Brief: `daemon-scope-brief.md`. Source examined: this checkout at `082b19e15` (0.1.235 code). Live host: 24 CPUs, Linux 6.8.0-147, Node v24.21.0, installed Squeal 0.1.234 and 0.1.235, cezar on Vitest 4.1.10 and Vite 8.1.4. The live host was read only through `/proc` and stores opened `mode=ro`. No socket was opened. No process was signalled or reniced. Probes: `probes/daemon-scope/` (throwaway, README there). The one-minute load was 21.8 to 46.8 during the work. The one live experiment (two Vitest roots in one process) ran at load 23.9, after a wait for the load to fall below 24.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Where the memory goes | Almost all of it is per-worktree runner work. A daemon with no runner holds 85 to 101 MiB. A cezar daemon with Vitest holds 450 to 1,800 MiB. It reaches about 1 GiB within 5 minutes of its start, and it moves by up to 980 MiB up or down within 20 minutes. It does not grow with uptime. No leak was seen in daemons up to 2.6 h old. The live set inside the heap is not determined. | verified by experiment (outside reads); live set not determined |
| 2 | cwd and environment | Vitest 4.1.10 still needs `process.cwd()` at the root. It forks workers with no `cwd`, so they inherit the process's cwd. A run for root B while the process cwd was root A failed a relative-path test. Squeal ties the cwd, `TMPDIR`, the signal handlers, `process.exitCode`, the environment hash's Node version and the inherited env to the one daemon process. | verified by experiment; read in source code |
| 3 | Designs and savings | On the 09:28Z population (19 daemons, 15.6 GiB with swap, plus 2.9 GiB of test processes): (a) lifecycle fixes: 1.2 GiB firm, up to 6.0 GiB; (b) a heap cap: at most 1.3 GiB at 768 MiB and 2.9 GiB at 512 MiB, with a risk of OOM crashes; (c) a repository daemon with one runner child per worktree: 0.8 to 1.1 GiB; (d) every runner in its own process: 0.3 to 0.8 GiB. CPU saving of (c) and (d): under 0.2 CPU. | inferred from measurements |
| 4 | What (c) changes | It enlarges the blast radius of a hang, a crash, a handover and a cgroup stop from one worktree to the whole repository (13 worktrees for cezar). One older session would hold back the upgrade of every worktree. The env and the Node version would come from one hook for all worktrees. It eases #58 inside one repository. It does not change #27, #60, #61, #63 or #69. It makes #47 and #50 larger. | read in source code; inferred |
| 5 | Usage | cezar: 59 worktrees active since 10-14; median activity span 1.2 h (p90 13 h); 13 to 17 live at once at peak; 65% of worktree-hours were quiet for over 30 min. 7 of 19 daemons at 09:28Z had no revision for 30 min or more. Two worktrees at the same commit: 65% of cezar revisions (319 of 488). Keys held by 2 or more worktrees: 71% of cezar's current key rows. | verified by experiment (store reads) |
| 6 | Prior art | Bazel, Nx and Gradle (in practice) run one server per workspace or checkout. Bazel documents the memory cost of this and answers it with an idle timeout and a low-memory exit, not with sharing. Watchman runs one process per user for many roots. tsserver and rust-analyzer serve several projects in one process; rust-analyzer runs its build command per workspace, with the workspace root as cwd. | read in official docs |

## 1. Where a daemon's memory goes

`daemons.py` read `status`, `smaps` and the fds of every daemon at 09:28:40Z (load 26.7), and `sample.py` read `status` every 20 s for 20 min, 09:29Z to 09:49Z (load 21.8 to 46.8). `snapshot-1.json`, `samples-1.tsv`. *Verified by experiment.*

- **Total.** 19 production daemons (13 cezar, 6 squeal) and 3 e2e test daemons. The 19 hold 14,670 MiB private and 970 MiB swap. Their test processes hold 2,930 MiB more. The JS heap (256 KiB mappings, the 014-02 method) is 8,984 MiB, 61% of daemon private memory. `[anon:mimalloc]` (Rolldown's allocator in Vite 8, *inferred*) is 3,081 MiB, 21%.
- **The fixed part.** Three squeal-worktree daemons with no `node_modules` open no runner (C9). They hold 88, 92 and 101 MiB: heap 50 to 61, glibc 15, other 22 to 24, 12 threads. This covers the Node runtime, Squeal's code, the store connection, the watcher and the hash cache. A bare `node` holds 16 MiB (`two-roots.txt`), so Squeal adds about 72 to 85 MiB. Three e2e fixture daemons with Vitest and 8 test files hold 126 to 129 MiB. Splitting the fixed part into the watcher, the hash cache and the store connection is not determined: that needs a heap snapshot of a daemon of my own on a large worktree, which the five-file rule excludes.
- **The per-worktree part.** Cezar daemons with a runner hold 450 to 1,800 MiB. Squeal daemons with a runner hold 216 to 530 MiB. One cezar daemon (2128703) held 1,063 MiB at 5 minutes of age (014-02 `snapshot-2.json`). Daemon 537418 went from 99 to 530 MiB when its runner opened. Cezar has 895 test files, several Vitest projects, Vite 8 with 60 `rolldown-worker` threads, and a second Vitest instance for the slow lane while slow files are pending (`slow-instance.ts`, 004 D2). The memory follows the project and the runner, not the uptime.
- **Not growth, not a leak in this window.** On 10 daemons seen at 08:16Z and at 09:28Z: 3704612 went from 2,165 to 1,375 MiB, 2860458 from 867 to 563, and 2741583 from 759 to 1,556. Within 20 minutes, 338183 went from 1,677 to 882 MiB, 2741583 from 1,566 to 693, 493241 from 1,459 to 691 and back to 1,186, 3699153 from 479 to 1,461 and down to 700, and 2128703 from 897 to 1,295. Swap stayed flat. *Inferred:* the 1.57 GiB heap of 014-02 is a high-water mark of per-worktree work. V8 gives it back after a major GC, and the live set is smaller for at least part of the time. The oldest daemon was 2.6 h old, so a slow leak over more hours is not determined. The heap's live set is also not determined: `process.memoryUsage()` inside a live daemon needs its socket, and no Squeal code reads it (014-02).
- **A per-worktree graph cannot be shared.** Vite's module graph is keyed by absolute path, and every worktree has another root (*inferred*). In `two-roots.mjs`, a second Vitest instance for a second root in the same process added 9 MiB, and a third 5 MiB, for a two-file project. That is the cost of a second graph, not a saving. *Verified by experiment* for the tiny case. Scaling to cezar is *inferred*.

## 2. The cwd and environment constraint

- **Vitest 4.1.10** (`cli-api.BK8pd4xc.js` in cezar's install): `ForksPoolWorker.start` calls `fork(this.entrypoint, [], { env, execArgv, stdio, serialization })` with no `cwd` (line 3084), so the workers inherit the process's cwd. `ThreadsPoolWorker` uses `new Worker(...)`, and threads share the process's cwd (line 3162). `globTestSpecifications` reads `process.cwd()` for its filters (11435). The worker's module runner keeps `const cwd = process.cwd()` from its module load (`startVitestModuleRunner…js:636`). The pool's env starts from `...process.env` (3651). `createVitest` takes `root` (Squeal passes it, `adapter.ts:186`), but `root` does not set the workers' cwd. *Read in source code.*
- **Experiment** (`run-two-roots.sh`, `two-roots.txt`, load 23.9): two copies of a two-file project, A and B. One test reads `fixture.txt` by a relative path. With the process cwd at A, B's run failed: `expected 'a' to be 'b'`. With the cwd at B, it passed. *Verified by experiment.* So one process cannot run two worktrees' tiers at the same time. `inRootWhileRunning` (`scratch.ts`) counts calls in flight and changes directory only on the first one.
- **What else is per process in Squeal.** *Read in source code.*
  - `adoptScratch`: the process cwd and `TMPDIR`, `TMP` and `TEMP` per key. The key hashes the repository id and the root, so it is per worktree (C9).
  - `ownSignals` takes over SIGINT, SIGTERM and SIGHUP for the whole process.
  - The Vitest adapter saves and restores `process.exitCode` around each run (`adapter.ts:478`, `567`).
  - The environment hash uses `process.version` (`keys/environment.ts:106`) and the allow-listed `process.env` (C10). The daemon keeps the env of the hook that started it for its life (C9, C10 Inherited environment).
  - The reaper uses the daemon's process group and one token per daemon (C13). `low-priority.ts` reads `/proc/<daemon>/task/*/children`.
  - Pool marks are keyed by worktree id (`capacity/marks.ts`), so they would work unchanged.
  - A project's `globalSetup` and config run in the daemon's process (C10). A setup that writes `process.env` would reach every worktree in a shared process.
- **What breaks with two worktrees in one process:** concurrent tiers (one cwd), `TMPDIR` per worktree, a project's env writes leaking between worktrees, keys when two worktrees' hooks ran different Node versions, and the attribution of leftovers by process group. A runner child per worktree (design c) avoids all of these, because each child has its own cwd, env and group.

## 3. Designs and their savings (09:28Z population, `estimate.py`, `estimate.txt`)

Base: 19 daemons, 14,670 MiB private + 970 MiB swap, plus 2,930 MiB of test processes; 18.6 GiB in all. *Inferred from the measurements above.*

| Design | Memory saved | CPU saved | Work and risk |
|---|---|---|---|
| (a) Lifecycle fixes: a departure drain does not run the fast backlog (014-03 4); a queued backlog or a wait for a slot does not count as use for `unusedExitMinutes` | Firm: 1.2 GiB (3 daemons with no consumer). Up to 6.0 GiB (7 daemons with no revision for 30+ min, all waiting on the slow lane, with their test processes) | The quiet daemons' runs: 6 of them used 0.31 CPU between them over 20 minutes, not counting their test processes | Small: rules in C9 and 004 D2. Risk: results that nobody waits for are not produced; the next session's baseline does that work |
| (b) A smaller heap (`--max-old-space-size`) | At most 1.3 GiB at a 768 MiB cap; 2.9 GiB at 512; 5.1 GiB at 256 | none; more GC CPU | One flag. Risk: a live set above the cap crashes the daemon with OOM, which makes its tier `unknown` (C13) and repeats at each restart. The live set is not determined, so the cap cannot be chosen yet |
| (c) One daemon per repository (watchers, scheduler, store, socket), one runner child per worktree that has a runner | 0.8 to 1.1 GiB: cezar 0.53 to 0.77, squeal 0.31 to 0.37. Assumes a fixed part of 90 MiB per daemon removed and 26 to 46 MiB of child overhead added (Node 16 MiB + runner shim, *inferred*) | Under 0.2 CPU: a quiet daemon with no runner uses 0.3 to 1.5% of one CPU | Large: a new daemon, child protocol, locks and handover (section 4) |
| (d) As (c), plus each lane's Vitest instance in its own process | (c) minus 0.3 to 0.55 GiB for 12 slow-lane children: 0.3 to 0.8 GiB | as (c) | Larger than (c). Gain: a slow instance's exit frees its own memory |

The memory that (c) saves is the fixed part, 5 to 7% of daemon memory. The per-worktree graphs stay. A runner child per worktree could exit when its worktree is quiet. But today's daemon can already do the same: it can close its Vitest instance, or exit, under the rules of (a). The 001 broker ruling (`host-capacity.md` 4C) still holds for CPU, and now holds for memory too.

## 4. What design (c) changes

*Read in source code (C1, C9, C10, C13); inferred for the consequences.*

- **Handover (#47, C9 step-down).** One step-down stops validation for every worktree of the repository. A step-down is asked only when every other session's consumer is at least the hook's version. With one daemon, that rule spans all worktrees, so one older session anywhere blocks the upgrade everywhere. The six-successor case of #47 becomes one claim per repository, but its failure now covers 13 worktrees.
- **Restarts (#50).** A restart drops the queue of every worktree, not one.
- **Older consumers.** During the move, a hook from an older release still spawns per-worktree daemons. The repository daemon would have to take every per-worktree lock (`locks/<worktree-hash>.sqlite`) of the worktrees it serves, so older daemons lose the lock and exit. Two layouts would live side by side for at least one release.
- **Blast radius.** A hung event loop, a store busy past a write's wait, or a crash stops 13 worktrees instead of one. Runner children keep a test or Vitest crash inside one worktree, as today.
- **cgroup.** The daemon stays in the cgroup of the harness whose hook spawned it (`daemon-under-harnesses.md` 1). A Codex session's unit stop would end validation for Claude Code worktrees of the same repository. Today all 22 daemons share `cezar.service` (014-02 4), so on this host the effect is the same.
- **Worktree destroy (#27).** A runner child holds the root as its cwd only during a run, as the daemon does today. The watcher's fds do not show in Cezar's cwd scan. `squeal stop <root>` would become a per-worktree request that ends a child and a watcher, not a process. #27 is not eased: its trigger is a daemon that outlives its session, and (a) addresses that.
- **Scheduling (#58, #63, #69, C10).** One scheduler sees every worktree of the repository. It could name the holder of the slow slot (#58) inside one repository, but not across repositories. The pool stays for that. #63 and #69 are waits behind a running tier of the same worktree, and the scope does not change them. Claims (D8) could move into memory, but they already stop duplicate runs.
- **Env and Node version.** Today each worktree gets the env and `process.execPath` of the first hook in that worktree. With one daemon, all worktrees get them from one hook, unless each hook sends its env over the socket for its worktree's child. That is a new channel for the C10 Inherited-environment rules. Keys include `process.version`, so a worktree whose harness runs another Node would be re-keyed.
- **Layout.** The socket and the lock would be per repository (`squeal-<repo-hash>.sock`, `locks/<repo>.sqlite`). The store is already per repository. The `worktrees.daemon_*` columns would all point at one daemon.
- **Net.** It eases #58 within one repository. It makes #47 and #50 larger. It leaves #27, #60, #61, #63 and #69 as they are.

## 5. Usage since 2026-10-13 (`usage.py`, `usage.txt`, stores `mode=ro`)

*Verified by experiment.* Limit: the stores drop removed worktrees' revisions and key rows (C7 pruning). Cezar's remaining data starts on 10-14T19:55Z. Spans are first to last stored event, so they undercount.

| | cezar | squeal | mvp-unveiled-july26 |
|---|---|---|---|
| Worktrees with activity | 59 | 28 | 10 |
| Activity span, median / p90 / max | 1.2 / 13.0 / 157.5 h | 0.0 / 2.5 / 192.7 h | 5.6 / 74.0 / 74.0 h |
| Live at once (span), median / p90 / max | 1 / 5 / 16 | 1 / 1 / 5 | 2 / 2 / 4 |
| Active at once (an event in 30 min), p90 / max | 3 / 17 | 1 / 6 | 0 / 6 |
| Worktree-hours past 30 min of quiet | 65% of 328 h | 50% of 203 h | 97% of 236 h |
| Revisions at a commit another worktree had within 24 h | 319 / 488 | 49 / 613 | 37 / 157 |
| Current key rows whose key 2+ worktrees hold | 71% | 54% | none |

Live on 2026-10-21: 13 cezar daemons at 09:28Z (014-03 counted 14 at 08:18Z). 7 of the 19 had no revision for 30+ min, and 3 had no consumer. In 20 minutes of sampling, the squeal main checkout started and stopped 9 daemons of 180 to 200 MiB each, each one ending "no session registered for 3 s" (`samples-1.tsv`, the store's notes). A repository daemon would keep Squeal's code warm across such sessions, but not the per-worktree graph.

## 6. Prior art (`read in official docs`, fetched 2026-10-21, quotes in `probes/daemon-scope/docs-quotes.md`)

| Tool | Unit | Several checkouts of one repository |
|---|---|---|
| Bazel (bazel.build, current) | one server per output base, which is per workspace path and user | "working across multiple repositories starts a dedicated Bazel server for each workspace". For memory it advises `--shutdown_on_low_sys_mem`, a shorter `--max_idle_secs` and `bazel shutdown`, not sharing |
| Gradle 9.8.2 | a daemon is reused by any compatible build; a mismatch of version or JVM starts another | "Daemons automatically stop given any of the following conditions: Available system memory is low; Daemon has been idle for 3 hours" |
| Nx (v23) | "Each workspace starts its own daemon process" | one per checkout |
| Turborepo 2.x | "The daemon is no longer used for `turbo run`" | none for runs |
| Watchman | one service per user (`<STATEDIR>/<USER>` socket), many roots | `watch-project` consolidates overlapping watches |
| tsserver | one process per editor host; it holds many configured projects | projects by tsconfig, in one process |
| rust-analyzer | one server per editor session; `linkedProjects` lists several workspaces | runs its check command "for each of them, with the working directory being the workspace root" |

The tools that run user code from one checkout (Bazel, Nx, Gradle's build) keep one process per workspace or per compatible environment. They handle memory with idle and low-memory exits. The tools that serve many roots in one process (Watchman, tsserver) run no project code. rust-analyzer does run project code, and it puts the per-workspace cwd into a child process: that is design (c)'s shape.

## Recommendation for Squeal

**Fix the lifecycle; keep one daemon per worktree.**

1. **(a) first.** Firm saving 1.2 GiB; up to 6.0 GiB (up to 32% of the 18.6 GiB) on 2026-10-21. Two rules: a departure drain does not run the fast backlog for a session that is gone; and queued backlog and a wait for a slot do not count as use under `daemon.unusedExitMinutes`. This is the C9 and 004 D2 question that 014-03 raised. Work: small. Risk: work nobody waits for runs later, at the next session's baseline.
2. **Then measure the heap's live set, before any cap.** Add `process.memoryUsage()` and `v8.getHeapStatistics()` to the ping (014-02 open question), or measure a daemon of one's own on a cezar-size worktree. If the live set after GC sits well under the high-water mark, a cap or a `global.gc` after each tier could save 1.3 to 2.9 GiB. Until it is known, a cap risks OOM crashes and `unknown` results.
3. **Not a repository daemon now.** It saves 0.8 to 1.1 GiB (5 to 7% of daemon memory) and almost no CPU. The memory is per-worktree graph, and a shared process cannot share it. Its cost is a new process model, a two-layout migration, and a blast radius of a whole repository for every hang, crash and handover. If it is ever built, use (c), with runner children per worktree as rust-analyzer does. (d) adds processes for little gain.

## Open questions

- The heap's live set and whether it grows past 2.6 h of uptime. Needs a daemon of one's own on a large worktree, or a ping field. Not determined.
- How the 90 MiB fixed part splits into watcher, hash cache and store connection, and so how much of it a repository daemon would really share. Not determined, for the same reason.
- Whether Rolldown's mimalloc arenas (3.1 GiB in all) would be shared by several Vite instances in one process. Not measured: the tiny project used little of them.
- macOS: not examined.
- Why the squeal main checkout restarted its daemon 9 times in 20 minutes (short sessions, inferred). Each start cost about 190 MiB for under 20 s. Not examined further.

## Sources

- Specs: 011 C1, C7, C9, C10 (Capacity, Inherited environment), C13; 004 D2; `001-core-loop/research/host-capacity.md` 4C and recommendation 5; `daemon-under-harnesses.md` 1 and 2; `watcher-daemon-and-shared-store.md`; `014-ps/research/process-measurement.md`, `should-not-be-up.md` and their logs.
- Issues: hearsay-tools/squeal #27, #47, #50, #58, #60, #61, #63, #69 (`gh issue view`); `research/issue-27.md`, `issue-47.md`, `issue-50.md`, `issue-61.md`, `issue-63.md`.
- Source at `082b19e15`: `src/core/daemon/{scratch,signals,slow-instance,daemon}.ts`, `src/core/keys/environment.ts`, `src/core/capacity/{marks,pool}.ts`, `src/runners/vitest/adapter.ts`.
- Vitest 4.1.10: `/home/agent/projects/cezar/node_modules/.pnpm/vitest@4.1.10_…/node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js` lines 3084, 3162, 3651, 11435; `startVitestModuleRunner.DB-7oCpn.js:636`; `node.js:78`.
- Docs: https://bazel.build/run/client-server, https://docs.gradle.org/current/userguide/gradle_daemon.html (9.8.2), https://nx.dev/docs/concepts/nx-daemon, https://turborepo.dev/docs/reference/run, https://facebook.github.io/watchman/docs/cli-options, https://facebook.github.io/watchman/docs/cmd/watch-project, https://github.com/microsoft/TypeScript/wiki/Standalone-Server-(tsserver), https://rust-analyzer.github.io/book/configuration.html.
- Live host, read-only: `/proc/<pid>/{stat,status,smaps,cmdline,fd}`, `/proc/{loadavg,meminfo,uptime}`; stores `cezar`, `squeal`, `mvp-unveiled-july26` `.git/squeal/store.sqlite` with `mode=ro`.
- Probes: `probes/daemon-scope/` (see its README).
