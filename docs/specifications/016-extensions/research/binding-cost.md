# 016-34: the per-edit cost of three ways to connect a check provider

Researcher: Opus 5.5, 2026-10-26, HEAD `6f8a579a1`, Node v24.21.0, ESLint 9.39.5, 24 CPUs. Brief: [binding-cost-brief.md](binding-cost-brief.md). Probe: [probes/binding-cost/](probes/binding-cost/README.md).

**Draft.** Questions 1, 3 and 4 as the code and the call counts show them. The timed parts (question 2, the per-call cost in question 3, the containment runs in question 4) wait for the coordinator's go: at the first request the one-minute load was 39.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Harness | One provider module behind six bindings: in-thread, worker thread, stdio JSON-RPC, a command per run, the same with Node's compile cache, and ESLint's own CLI per run. Two checks: a trivial one and ESLint on one 236-line file. Same selection and the same four calls per edit for all. | verified by experiment (smoke run, no times) |
| 2 | Cost per edit | Pending the timed turn. | – |
| 3 | Scheduler calls | An edit that reaches one test file: 4 awaited calls (`invalidate`, `affected`, `closure`, `run`) and 9 synchronous hints. An edit that reaches all 60 files: 64 awaited calls and 755 hints (Vitest shape), 119 and about 1,288 (node:test shape). Hints grow faster than the file count. Per-call cost pending. | verified by experiment (counts); read in source code (the lock) |
| 4 | Containment | From the code: a provider in the daemon's thread that blocks also stops the bound on its own calls, because that bound is a `setTimeout`. A worker thread or a process keeps the daemon's timers and can be killed. An uncaught throw from a provider's timer ends the daemon's process when the provider is in its thread. Runs pending. | read in source code; inferred; verified by experiment in 016-02 p1 |

## Findings

### 1. Harness

`provider.mjs` holds all the logic: `invalidate` drops cached file text, `affected` and `closure` read imports by a regex, `tierWidth` answers from local state, and `run` either reads the check file (`trivial`) or lints it with ESLint's Node API (`eslint`). ESLint is loaded on the first run and kept for later runs. Nothing in the module knows which binding carries it. The bindings (`bindings.mjs`):

- `inproc`: the module imported into the host's thread; each call is a direct function call.
- `worker`: the module in a `worker_threads` worker; messages are structured clones.
- `rpc`: the module in a persistent child process; JSON-RPC 2.0 with `Content-Length` framing over stdin and stdout, stdout for frames only (`framing.mjs`, `rpc-server.mjs`). This is the framing the 016-08 judgment chose.
- `command`: a fresh `node command.mjs` per run that writes a JSON report file; the host reads it. The host selects with the same provider code, as a core would select from a manifest's declared scope. `command-cc` sets `NODE_COMPILE_CACHE`, so later runs reuse V8's compiled code. `command-cli` runs ESLint's own CLI (`-f json -o <report>`), the command a manifest tier would really run.

Selection is equal: every binding makes the same edit (`src/a.js`), selects the same unit, and returns the same verified result (trivial: one pass; ESLint: one fail with one `no-unused-vars` message). Startup is equal: the timed span of a cold sample starts before `open()`, so module load, process start, ESLint load and framing all count. A warm sample starts after three untimed edits on an open binding. Verified by experiment: the smoke run passed for all six bindings on both checks; it recorded no times.

One fact the smoke run showed: ESLint's CLI enables Node's compile cache in `TMPDIR` by itself (`bin/eslint.js` line 15, `mod.enableCompileCache?.()`, read in source code, 9.39.5). A per-run ESLint command therefore reuses compiled code from earlier runs unless `TMPDIR` is fresh. Each cold sample gets a fresh `TMPDIR` for this reason.

CPU accounting: host CPU from `process.cpuUsage()` (getrusage, all threads, so it includes the worker thread). Provider-process CPU from the process's own `process.cpuUsage()`: the RPC server's is read before and after each sample, outside the timed span; each command preloads `exit-cpu.mjs`, which writes its CPU from fork to exit. The command's CPU is cross-checked against the host's `/proc/self/stat` children ticks (10 ms resolution).

Not in the harness: the watcher, revisions, keys and the store. The span is the provider's part of an edit: from a changed path to a verified result.

### 2. Cost per edit

Pending the timed turn: 25 samples per binding, check and cold or warm, each started below load 24, with the load stored beside it.

### 3. Scheduler calls

Verified by experiment (`count.probe.ts`, the real `createScheduler` at `6f8a579a1` with a counting runner and the 016-18 probe's virtual clock, `results/count-*.jsonl`). Every hint is defined, as the daemon's `afterEachRun` wrapper defines them for every adapter (`src/core/daemon/escaped.ts` lines 397 to 409). Counts per edit were the same in three repeats, except for a drift of one or two `backlogSlot` calls in the node:test shape at 60 files.

| Edit | Shape | Awaited calls | Synchronous hints | Runs |
|---|---|---|---|---|
| a module one test file imports | either, 6 or 60 files | 4: `invalidate` 1, `affected` 1, `closure` 1, `run` 1 | 9: `lane` 5, `backlogSlot` 3, `tierWidth` 1 | 1 |
| a module every test file reaches, 6 files | Vitest (tiers) | 10: `closure` 6, `run` 2, ... | 53: `lane` 30, `backlogSlot` 11, `tierWidth` 10, `tierPart` 2 | 2 (4, 2 files) |
| same, 6 files | node:test (slots) | 11 | 43 | 3 |
| same, 60 files | Vitest (tiers) | 64: `closure` 60, `run` 2, ... | 755: `lane` 408, `tierWidth` 172, `backlogSlot` 119, `tierPart` 56 | 2 (4, 56 files) |
| same, 60 files | node:test (slots) | 119: `closure` 60, `run` 57, ... | 1,287 to 1,289: `lane` 980, `backlogSlot` 303 to 305, `tierWidth` 4 | 57 |

The load read 25.2 just before these count runs, above the CPU count. The runs give counts, not times, so the load does not change them.

What it shows:

- Awaited calls grow with the affected files: one `closure` per re-keyed file, one `run` per tier or slot. A process binding pays one message pair for each.
- Hints grow faster than the files. From 6 to 60 files (10 times), `lane` calls grow from 30 to 408 in the tiers shape and from 23 to 980 in the slots shape (13 and 43 times). Inferred from the counts and `tiers.ts` line 124: `lane` is called per queued file at each selection, and each slot that ends starts a selection.
- The hints are synchronous by contract, because "selection holds the scheduler's lock" (`src/core/types/runner.ts`, the doc of `slowWidth`, `tierWidth`, `tierPart`, `besideBacklog`, `backlogSlot`; read in source code). A process or a worker thread cannot answer a synchronous call without blocking the daemon's thread until the reply comes. So for these bindings a hint is either a declared value or a local cache. The daemon already answers the node:test and pytest hints as constants from options (`src/core/daemon/node-test-runners.ts` lines 61 to 65: `tierWidth: () => options.tierSize()`, `besideBacklog: true`, `backlogSlot: 1`; `pytest-runners.ts` lines 79 to 83). Vitest's `tierWidth` and `slowWidth` read each project's `maxWorkers` from the loaded config (`src/runners/vitest/width.ts` lines 151 to 162): a per-project table, which a provider can declare once per environment. `lane` is the composite's mapping from project to runner name (`composite-runner.ts` line 123), which the core already knows.

The cost of one hint call in each binding is pending the timed turn (`sample.mjs` mode `hint`).

### 4. Containment

What the code shows; the runs (`contain.mjs`) are pending.

- The core bounds each awaited runner-part call with a timer: `RunnerPartBound.call` races the answer against a `setTimeout` (`src/core/scheduler/runner-work-bound.ts` lines 45 to 59; read in source code). A provider in the daemon's thread that blocks (a synchronous loop, `Atomics.wait`, a synchronous child process) holds that thread, so the timer cannot fire until the block ends. The bound protects against a call that never settles, not against one that blocks. 016-02's p1 showed this on Node 24.21.0: a synchronous loop in the host's thread stopped a 500 ms guard and a 200 ms heartbeat (verified by experiment there).
- An uncaught exception thrown from a provider's own timer or callback, outside any awaited call, ends the daemon's process when the provider is in its thread: no file under `src/` installs an `uncaughtException` or `unhandledRejection` handler (grep at `6f8a579a1`, read in source code), so Node's default applies. In a worker thread, the same throw ends the worker and emits `error` on the `Worker` object; in a child process, it ends the child (inferred from Node's documented defaults; the `throw-async` case will verify it).
- A worker thread can be stopped by `worker.terminate()`, a child process by `SIGKILL`; both free the provider's thread and its memory. A promise in the daemon's thread that never settles cannot be stopped: its work goes on (016-02 p1).
- The per-run command adds one more property: every run starts clean, so a provider that leaks or wedges affects only that run. The JSON-RPC process must be detected and restarted (its `exit` rejects every pending call in `bindings.mjs`).

## Recommendation for Squeal

Pending question 2. From questions 3 and 4 alone:

1. Keep the synchronous hints out of any process protocol. Make them declared data per environment (lane, tier width per project, slot size, beside-backlog), as the daemon already does for node:test and pytest. A process binding needs only the awaited calls: 4 per one-file edit, plus one `closure` per re-keyed file and one `run` per tier or slot.
2. Third-party code goes out of the daemon's thread: the core's own call bound is a timer, and a blocked thread stops it.

## Open questions

- The per-edit CPU and wall time of each binding, cold and warm (question 2), and the cost of one hint call (question 3): waiting for the timed turn.
- The `contain.mjs` runs (question 4): waiting for the timed turn, because they read heartbeat gaps.
- Memory per binding: the sampler records RSS; pending.

## Sources

- `src/core/types/runner.ts`, `src/core/scheduler/refinement.ts` (the per-revision calls), `src/core/scheduler/runner-work-bound.ts`, `src/core/daemon/escaped.ts`, `src/core/daemon/composite-runner.ts`, `src/core/daemon/node-test-runners.ts`, `src/core/daemon/pytest-runners.ts`, `src/runners/vitest/width.ts`, all at `6f8a579a1`.
- [check-protocol-judgment.md](check-protocol-judgment.md) divergence 4 and spec input 1; [plugin-mechanisms.md](plugin-mechanisms.md) question 5 and its p1 probe.
- ESLint 9.39.5, `bin/eslint.js` (installed from npm under `/tmp/bc34/tools`).
- Probe: [probes/binding-cost/](probes/binding-cost/README.md), results under `probes/binding-cost/results/`.
