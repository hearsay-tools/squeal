# 001-132 notes: observed runtime inputs

Evidence for the board row's done-when, and the seams a later worker needs. Drivers here are evidence, not product code: `ab.ts` (one full suite through Squeal's Vitest adapter, recorder on or off, delivered as the daemon delivers it) and `mock.ts` (done-when 2 through the real scheduler, store and adapter, policy `baseline.onStart: "lookup-only"`, no `inputs`).

## Setup

- `cezar` cloned from `/home/agent/projects/cezar` and checked out at `1c97556a`, the research's commit: `scripts/mock-cursor-print.mjs` is not on `cezar`'s `main` (`13351da8` spawns `scripts/mock-cursor-acp.mjs` for cursor), so the brief's path exists only there. `npm ci`; Vitest 4.1.10; 640 test files in 4 projects (`server`, `contract`, `api-client`, `web`).
- Node 24.21.0, Linux, 24 cores, load 10 to 35 from other sessions throughout.

## Done-when 2: the mock edit, on `cezar`

`npx tsx mock.ts <clone> on`, a clean clone and store:

```
18.0s main started (lookup-only): 0 runs, parity key ce0bfcb1e950
35.9s first run: ran ["src/core/runner-shutdown-parity.test.ts"]; closure holds the mock: true
35.9s   observed scripts: packages/cezar/scripts/mock-claude.mjs, packages/cezar/scripts/mock-codex-app-server.mjs, packages/cezar/scripts/mock-cursor-print.mjs, packages/cezar/scripts/mock-omp-rpc.mjs, packages/cezar/scripts/mock-opencode-serve.mjs, packages/cezar/scripts/mock-pi-rpc.mjs, packages/cezar/scripts/pi-retry-degraded-service.mjs
35.9s   parity key 33e575770f3e, states ["pass/current/-"]
36.0s mock edited: parity key 33e575770f3e -> b1c14d42fde3
52.7s after the mock edit: ran ["src/core/runner-shutdown-parity.test.ts"] in 1 tier(s)
52.7s   states ["pass/current/-"] (first run 097651f2, mock-edit run 008dac1a)
67.8s old-mock worktree: parity key 33e575770f3e, states ["pass/current/-"], ran []
67.8s   mock in worktree equals main's: false
```

The first run is the parity test's only run before the edit: it is current under the key that holds the seven scripts it spawned (`33e5`), with no second run. The mock edit re-keys it (`b1c1`) and the next tier runs it. A second worktree with the old mock keys the file at `33e5`, the first run's key, so it can only inherit the result its own contents produced, never the mock-edit run's (`b1c1`).

The same with `off` (today's keys):

```
54.2s first run: ran ["src/core/runner-shutdown-parity.test.ts"]; closure holds the mock: false
54.3s mock edited: parity key 810508d9eca6 -> 810508d9eca6
56.4s after the mock edit: ran [] in 0 tier(s)
129.0s old-mock worktree: parity key 810508d9eca6, states ["pass/current/-"], ran []
```

The edit re-keys nothing and runs nothing, and the old-mock worktree shares the one key with the edited one: `lessons.md` defect 28.

## Done-when 3: three full suites each way, and the cost per file

`ab.sh` alternated `ab.ts` off, on, off, on, off, on on one clone (Vitest's default pools, the recorder delivered as the daemon delivers it); `analyze.mjs` summarizes. Load is the 1-minute average at start and end of each run.

| Run | Wall | Summed file time | Load | Failing files |
| --- | --- | --- | --- | --- |
| off 1 | 618 s | 6,802 s | 25 -> 11 | `web` `github.test.tsx` |
| on 1 | 749 s | 11,319 s | 11 -> 6 | `github.test.tsx` and 9 `server` files (below) |
| off 2 | 619 s | 6,547 s | 6 -> 11 | `github.test.tsx` and 6 `server` files: `runs/ci-wait-store`, `runs/store-order`, `runs/store-transcript-facts`, `server/nonblocking-discovery`, `server/project-context-repo-handle`, `server/usage-scope` |
| on 2 | 555 s | 6,372 s | 11 -> 9 | `github.test.tsx` |
| off 3 | 529 s | 6,632 s | 9 -> 2 | `github.test.tsx` |
| on 3 | 508 s | 5,724 s | 2 -> 3 | `github.test.tsx` |

- `web` `packages/web/src/routes/github/github.test.tsx` fails in all six runs, so not the recorder's.
- Failing only with the recorder, each once, all in `on 1`: `application-update/service`, `artifacts/cli`, `autosave-timeout`, `ci-wait/process`, `discovery/cli`, `git-worktree-lock`, `server-install/platforms/ubuntu-vps`, `server/repo-branches-api`, `server/worktrees-api` (timeouts at 5 s and 15 s, a lock-wait race, a missing log under a dying watcher). `on 1` overlapped this worker's own `mock.ts` runs and Squeal's daemon re-running this repository's suite, hence its 11,319 s. Not shown to be load, and only partly load (review wave 12d, S1; 001-137 below): under one fixed competing load, seven of the nine fail as often without the recorder, while `artifacts/cli` and `discovery/cli` fail only with it. What this round did show: none fails in `on 2` or `on 3`, the nine pass three times out of three run alone with the recorder (`ab.ts ... <the nine>`: 14.2, 14.3, 14.4 s on; 14.1, 14.1, 15.6 s off; load 2 to 5), and `off 2` failed six other files without it.
- Cost per file, the median of each file's three durations on over its median off: p25 0.87, p50 0.97, p75 1.20, p90 1.50; the difference p50 -47 ms, p90 +722 ms. By project: `server` (398 files) p50 0.95, -95 ms, p90 +386 ms; `web` (233 files, jsdom, no spawns) p50 1.20, +150 ms, p90 +886 ms; `contract` 0.98; `api-client` 1.08. Load dominates `server`; `web` pays a fixed cost per file, the preload and resolve hook in each worker.
- Growth (`on 2`, `on 3` identical): 150 of 640 files observe paths beyond their snapshot, 1,719 distinct paths, 5,266 file-path pairs, per file p50 4, p90 54, max 787; 76 run a project script; `mock-cursor-print.mjs` is observed by 26 files. Before the closure filter, so a path also in a file's Vite graph counts (the research's 153 files and 1,092 paths were after it).

## Defects found on the way

- The recorder skipped all of `tmpdir()`. This session's `TMPDIR` is an ancestor of the clone, so the first `cezar` run observed nothing. Now the temp directory is skipped only when the worktree is not inside it (`test/runners/vitest/observe.test.ts`, "inside the temp directory").
- Vitest copies `createVitest`'s `env` option into a root project's serialized config, so the per-instance observe directory moved the environment hash between worktrees (the node-test integration test's second worktree re-ran `vitest/sum.test.ts`). `canonicalConfig` leaves the recorder's env out. A config with `projects` (the research's `cezar` probe) does not show it.
- A Worker terminated at its message lost its last turn's paths (8 of 40 kept). The recorder now flushes before `MessagePort.postMessage` and `process.send`.

## Seams

- Recorder: `src/runners/observe/recorder.cjs`; settings in `SQUEAL_OBSERVE`; reader `read.ts`, filter `inputs.ts`, locator `runtime.ts` (candidates `../observe/`, `./observe/`, `./`).
- Vitest delivery: `src/runners/vitest/observe.ts` (`VitestObserver`), hooked into `adapter.ts` at `#start`, `#serial` (recreate when the policy moved), `environment()` (adapter version, `injected`), `run()` (`RunReport.observed`).
- Keys: `src/core/keys/observed.ts` (`ObservedSets` over `meta` `observed.<project>`, `Listings`, listing paths `dir/` and `./`); `assembleClosure`'s third argument; `WorktreeKeys` in `src/core/scheduler/keying.ts` (hash source for listings, `addObserved`, `rekeyListings`, the policy toggle in `setPolicy`).
- Scheduler: `src/core/scheduler/observed.ts` (`prepareObserved`, under the lock: ignored paths dropped, paths tracked, stability against the stat cache), `recordTier`'s `observed` argument in `tiers.ts`, listings in `Ledger.tierChanges` (`batch.ts`) and their re-key first in `rekeyContent` (`revision.ts`).
- node:test: `src/runners/node-test/` is untouched. Its runner keeps its own `nodeTest.observed.<project>` store; adopting the shared recorder and `RunReport.observed` is a spec 003 row.

## 2026-10-08: 001-137, the nine `on 1` files under one fixed competing load

Question (review wave 12d, S1): do the nine files that failed only in `on 1` fail from load alone, or does the recorder's added work push deadline-bound tests over their limits in a crowded run? Answer: both. Seven are load and fail as often without the recorder. Two, `artifacts/cli` and `discovery/cli`, fail under contention only with it. Drivers and raw summary: `tasks/001-137/` (`nine.ts`, `rounds.sh`, `arm.sh`, `analyze.mjs`, `child.sh`, `cpu.sh`, `results.txt`).

### Setup

- A fresh clone of `/home/agent/projects/cezar` at `1c97556a`, `npm ci`, Vitest 4.1.10, Node 24.21.0, Linux, 24 cores. Every cezar command ran under `env -u` for each `CEZ_*` variable, cwd in the clone through a subshell.
- `nine.ts` runs the nine files in one Vitest instance with the recorder delivered as the adapter delivers it (`VitestObserver.start()` into `createVitest`'s `env`, then `configure`). `maxWorkers` is fixed at 23, Vitest's run-mode default on this host, so each of the nine gets its own fork. Deadlines are cezar's own. It records each file's start, end and state, each failing test's time and error, and every 500 ms the 1-minute load, the runnable count (`procs_running`), the Vitest workers (the driver's children) and everything below them.
- Competing load: 24 single-threaded busy loops held through every round, plus the host's ambient load from other sessions, which I could not control. `rounds.sh` alternates the order inside each pair (on off, then off on). One warmup pair, not counted.
- Pairs 1 to 13 ran; pair 14 was stopped with the burners. Nine rounds were SIGKILLed from outside, the round's whole process group, in both modes (see Incidents). Counted: 10 rounds each way, 8 of them complete pairs.

### Load and processes through the runs

| Mode | Rounds | Run, s (median) | Runnable mean (median) | Load1 mean (median) | Vitest workers | Children below them, max |
| --- | --- | --- | --- | --- | --- | --- |
| on | 10 | 62 to 139 (88) | 50 to 87 (61) | 66 to 151 (93) | 9 | 18 to 27 |
| off | 10 | 50 to 171 (99) | 50 to 82 (67) | 64 to 141 (91) | 9 | 15 to 26 |

The two modes ran under comparable load. Per-round rows, every failure with its time, the runnable count then and how many of the nine were running: `tasks/001-137/results.txt`.

### Outcomes per file (rounds failed of 10)

| File | on | off | Median duration on, off |
| --- | --- | --- | --- |
| `artifacts/cli` | 5 | 0 | 17.1 s, 9.3 s |
| `discovery/cli` | 5 | 0 | 26.2 s, 16.3 s |
| `server-install/platforms/ubuntu-vps` | 6 | 3 | 8.4 s, 6.2 s |
| `git-worktree-lock` | 4 | 2 | 24.2 s, 18.0 s |
| `application-update/service` | 2 | 1 | 10.5 s, 7.8 s |
| `ci-wait/process` | 1 | 1 | 17.8 s, 17.0 s |
| `autosave-timeout` | 2 | 4 | 20.9 s, 20.4 s |
| `server/worktrees-api` | 7 | 7 | 62.5 s, 78.8 s |
| `server/repo-branches-api` | 10 | 10 | 23.8 s, 18.8 s |

- Totals: failing files 42 on, 28 off; failing tests 63 on, 66 off. Complete pairs: on worse in 6, off worse in 2, sign test p 0.29. Both reversals (pairs 12 and 13) had the heavier off round (load1 134 and 87, against 96 and 66 on).
- The two CLI files together: 10 of 20 on, 0 of 20 off, Fisher two-sided p 0.0004. Each failure is the one test that runs `node --import tsx src/index.ts <command> --help` under a 15 s deadline: `Test timed out in 15000ms`. Off rounds never failed it, including the arm's two heaviest (load1 141 and 134). Verified by experiment.
- The other seven pooled: 30 of 70 on, 28 of 70 off, Fisher p 0.86. They fail without the recorder under the same load at a similar rate, so for them "load" holds. `ubuntu-vps` (6 vs 3) and `git-worktree-lock` (4 vs 2) lean toward the recorder, but ten rounds cannot tell. `repo-branches-api` fails nearly always on this host, yet it passed once (a no-burner round with the recorder on), so it is contention-sensitive, not broken. Verified by experiment.

### Not the recorder's CPU in bulk

- Whole tree, no burners, ambient load 60 to 130 (`cpu.sh`, three pairs, user plus sys of every waited descendant): on 65.3, 71.2, 70.9 CPU-s; off 68.8, 66.7, 68.6. The recorder adds about 2 CPU-s, 3%. In the same runs `artifacts/cli` took 6.4, 10.6, 12.2 s on and 4.9, 6.8, 5.5 s off. Verified by experiment.
- The CLI child alone, outside Vitest, recorder through `NODE_OPTIONS` as a worker's child inherits it (`child.sh`, six pairs, no burners): 1.5 CPU-s and about 1.0 to 1.4 s wall either way, 260 paths recorded. Only the first, cold run was slower (4.8 s, on). Verified by experiment.
- So under contention the recorder slows these two tests by more than its CPU share, and the child on its own does not show it. Where the time goes inside the worker is not determined. Candidates, read in `src/runners/observe/recorder.cjs` but not measured: the flush before every `process.send`, which is a synchronous `appendFileSync` whenever paths are pending, in a fork worker that talks to Vitest over IPC; one `realpathSync` per new path; and the `registerHooks` resolve hook in the worker and every node child.

### The 001-132 `CEZ_*` exposure

- The 001-132 worker's handoff holds six lines `mock: implemented the change (dry run)` between 15:25:07Z and 16:14:07Z, one per A/B round, plus one at 15:20:19Z from `mock.ts`. So `scripts/mock-claude.mjs` ran with the worker's `CEZ_*` in every round, on and off alike. Read in that handoff, `.ai/cezar/runs/8dfd4b17-c590-46ea-82f5-7a65d7ef5044.handoff.md`.
- The mock writes the handoff file, the todos file and `notes.md` in its cwd. None of the nine imports or spawns it (grep), and over 26 rounds here none left a `notes.md` in the clone, which the mock writes whatever `CEZ_*` holds. An effect through the inherited environment would be deterministic and show in every round; the nine failed in one. Verified by experiment and read in source.
- Verdict: not plausibly the cause of the `on 1` failures. It was symmetric across modes. The one indirect path, `notes.md` appends waking the 001-132 worktree's own Squeal daemon, adds to the uncontrolled load `on 1` already names. Not determined, because that worktree is gone. Inferred.

### Incidents

- Nine rounds were SIGKILLed from outside, the whole process group of the round, in both modes. Decoy `sleep` processes with the same cwds, in their own sessions, lived through 30 minutes of it. Nothing in the nine files' code paths, in Squeal's sources or in 001-138's teardown kills a foreign group by inspection. Cause not determined. Each round now runs under `setsid`, so a kill ends only that round, which `rounds.sh` logs.
- The 24 busy loops held the shared host near load 140 and blocked another coordinator. They were stopped on the coordinator's instruction. `arm.sh` now refuses more than 8 and wraps each in `timeout`, so a rerun cannot reproduce this load exactly.
- This session's shell was briefly in the clone once. No Squeal daemon or store appeared there (checked).

### For done-when 3 and D4

- Done-when 3 is causally settled for seven of the nine (load) and failed for two: the recorder makes the CLI-spawning tests miss their 15 s deadline under contention, while the same load does not fail them without it.
- The p50/p90 cost figures above stay measurements under different loads. They are not causal overhead estimates, and they hide this tail.

Open: where the time goes in those two workers (a profile of `artifacts/cli.test.ts` alone, on and off, under at most 8 burners); whether `ubuntu-vps` and `git-worktree-lock` also lean on the recorder; who killed the rounds.

## 2026-10-08: 001-143, where the recorder's time goes in a spawned node CLI

Question (001-137's open item): with the recorder, cezar's `artifacts/cli` and `discovery/cli` take far longer under contention and their `node --import tsx src/index.ts ... --help` child misses its 15 s deadline, while CPU rises 3%. Where is the wall time spent? Answer: in about 238 synchronous `appendFileSync` calls in the child's main thread, one before each `postMessage` to esbuild's worker. The child makes those calls because its tsx cache is always cold. Each append blocks on the shared, I/O-saturated disk. Drivers, recorder copy and raw summary: `tasks/001-143/` (`README.md`, `results.txt`).

### Setup

- A fresh clone of `/home/agent/projects/cezar` at `1c97556a`, `npm ci`, Vitest 4.1.10, tsx 4.23.0, esbuild 0.28.1, Node 24.21.0, Linux, 24 cores. Every cezar command ran under `env -u` for each `CEZ_*` variable, cwd in the clone, in its own session.
- `two.ts` runs the two files in one Vitest instance, `maxWorkers` 23, the recorder delivered as `VitestObserver` delivers it (`--require` first in `NODE_OPTIONS`, settings in `SQUEAL_OBSERVE`, output under `tmpdir()`). The recorder is `tasks/001-143/recorder/`, a copy of `src/runners/observe/` at `75c2fbf` whose `SQUEAL143_OFF` disables one candidate at a time. `stamp.cjs` times every worker and child (wall from process start, CPU, context switches). `SQUEAL143_TIME` times each append. Samples of load1, runnable count and I/O pressure (PSI `some avg10`) every 500 ms.
- The host was never idle. Ambient load ran 35 to 190, with I/O pressure 30% to 87% from other sessions. Runs before 23:18 local were discarded, because the host disk was full until then (the coordinator's note). The arms below all ran on a healthy disk. Variants rotate within each round.

### Candidates

| Candidate (001-137) | Verdict | Tag |
| --- | --- | --- |
| The flush before each IPC message | The cause, in its `MessagePort` form: 238 appends before esbuild's `postMessage` in the child's main thread. Vitest's `process.send` flushes are 2 or 3 per worker, not a factor. | verified by experiment |
| One `realpathSync` per new path | Not the cause. Disabled alone: still slow, 2 of 6 failed. | verified by experiment |
| The `registerHooks` resolve hook | Not the cause. Disabled alone: still slow, 1 of 6 failed. | verified by experiment |
| tsx's loader under the hook | The trigger, not the cost. A cold tsx cache makes about 238 `transformSync` calls, each a `postMessage`. | verified by experiment, read in source code |
| (also) the `fs` wrappers | Not the cause. Disabled alone: still slow, 1 of 6 failed. | verified by experiment |

### Results (median child wall over both `--help` children; failures of the two `--help` tests)

| Arm | off | on | flushbefore | threadport | shm | heldfd |
| --- | --- | --- | --- | --- | --- | --- |
| a: no burners, load1 ~110, 6 rounds | 4.7 s, 0 of 12 | 11.4 s, 6 of 12 | 3.6 s, 0 of 12 | 4.0 s, 0 of 12 | 3.9 s, 0 of 12 | 10.1 s, 7 of 12 |
| b: 8 burners, load1 ~105, 3 rounds | 5.4 s, 0 of 6 | 5.4 s (to 22.5), 2 of 6 | | 4.0 s, 0 of 6 | 5.6 s, 0 of 6 | |

| Arm c: one candidate off, 3 rounds, load1 ~70 | off | on | hook | realpath | fs |
| --- | --- | --- | --- | --- | --- |
| median child wall, failures | 3.2 s, 0 of 6 | 9.9 s, 0 of 6 | 9.2 s, 1 of 6 | 8.0 s, 2 of 6 | 11.3 s, 1 of 6 |

- `flushbefore` drops the flush before `process.send` and `postMessage`. `threadport` is a candidate fix: it flushes before a `MessagePort` message only in a worker thread, and still before every `process.send`. `shm` keeps the whole recorder but writes its output to tmpfs. `heldfd` keeps the flush but writes through one held descriptor (`writeSync`), with no open and close.
- On against off: 8 of 18 against 0 of 18 failed, Fisher p 0.003. The same holds against `threadport`. Verified by experiment.
- Accounting: in `on`, the child's appends sum to a median 5.9 s (arm a). Its wall minus its own appends is 5.5 s, against 4.7 s off. The same subtraction for `hook`, `realpath` and `fs` gives 4.4 to 5.1 s, against 3.2 s off and 4.5 s for `on` (arm c). The appends account for the difference. The child's CPU is 2.6 s on and 2.4 s off, so the time is spent blocked, not computing. Verified by experiment.
- Profile (`--cpu-prof`, `on`, healthy disk, load1 65): of the child's 7.7 s, 3.9 s is self time in `writeFileUtf8`. The stack is `appendFileSync < flush < flushBefore < Worker.postMessage < runCallSync < transformSync` (esbuild, called by tsx). Verified by experiment.
- The bounded-load arm (b) shows the same order, with weaker numbers. Its appends cost less (median 1.5 s), because I/O pressure moved independently of the burners: the burners add CPU, while the cost is disk waits.

### Why the cache is cold, and why the writes are slow

- cezar's `packages/cezar/vitest.setup.ts` points `TMPDIR` at a fresh `/tmp/cez-vitest-tmp-*` in every worker. tsx caches its transforms in `path.join(os.tmpdir(), "tsx-" + uid)` (`tsx/dist/temporary-directory-*.mjs`). esbuild's `transformSync` does `worker.postMessage(msg)`, then `Atomics.wait` (`esbuild/lib/main.js`, `runCallSync`). Read in source code.
- Outside Vitest, the `artifact --help` child alone (`child.sh`). With a fresh `TMPDIR` per run: on 13.6, 7.3, 7.3, 6.9 s; off 4.6, 4.9, 4.1, 4.5 s; threadport 3.1, 3.9, 5.1, 3.3 s. With the shared, warm cache: on 2.2, 1.2, 1.7 s; off 0.9, 1.0, 1.6 s. 001-137's `child.sh` ran warm, which is why it found no difference. Verified by experiment.
- Each flush is one `appendFileSync` (open, write, close) of the paths the module brought in. On this host's ext4 root (96% full at times, I/O pressure some 40% to 87%), these calls sum to seconds per child: 238 calls, a mean of about 25 ms each in arm a. A lone append loop measured 0.01 to 0.02 ms at the median. `heldfd` (one `write` per flush) is as slow as `on`, and `shm` (the same writes to tmpfs) is as fast as off. So the cost is the write reaching this disk, not the open and close, and not the flush's own work. Verified by experiment. Which kernel wait it is (journal, dirty-page throttling): not determined, because the kernel was not traced.
- Squeal's own recorder writes to `mkdtempSync(join(tmpdir(), "squeal-observe-"))` (`src/runners/vitest/observe.ts:62`), the daemon's temp directory, on the same disk here. Read in source code.

### Recommendation

- Flush before `MessagePort.prototype.postMessage` only in a worker thread (`!workerThreads.isMainThread`), and keep the flush before `process.send` and at exit. The flush exists because a parent stops a thread or a fork on its message (001-132's defect: a Worker terminated at its message kept 8 of 40 paths). A process's main thread is not stopped by what it posts to its own Worker. Expected effect, measured as `threadport`: the `--help` child at off's wall (4.0 s against 4.7 s off and 11.4 s on, arm a), and 0 of 18 failures against 8 of 18. The paths still reach the file at the turn's batch or at exit. Verified by experiment (timing). That no path is lost is inferred; the recorder's own tests (`test/runners/observe/`, the Worker-terminated case) would show it.
- Not recommended alone: `heldfd` (no gain). `shm` fixes it here, but `/dev/shm` is Linux-only, and it would put the output outside the daemon's temp directory.

### Open

- A worker thread that itself makes many synchronous esbuild calls, for example a Vitest `threads`-pool test calling `transformSync`, still pays one append per call under `threadport`. Not measured. Narrowing the flush to the port that leads to the thread's parent would cover it. How to recognize that port in Vitest's thread pool: not determined, because not read.
- Whether `ubuntu-vps` and `git-worktree-lock` (001-137's two leaning files) spawn tsx children the same way: not determined, because not measured here.
- macOS: not determined. No macOS host.
