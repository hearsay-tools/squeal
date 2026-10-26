# 016-34: the per-edit cost of three ways to connect a check provider

Researcher: Opus 5.5, 2026-10-26, HEAD `6f8a579a1`, Node v24.21.0, ESLint 9.39.5, 24 CPUs. Brief: [binding-cost-brief.md](binding-cost-brief.md). Probe: [probes/binding-cost/](probes/binding-cost/README.md), results under [probes/binding-cost/results/](probes/binding-cost/results/summary.md).

Timed turn: 10:32 to 10:38 UTC, on the coordinator's go. 625 timed samples and 16 containment cases. Every sample started below a one-minute load of 24 and recorded it: 17.1 to 23.7. The gate held three samples (135 s, 15 s, 15 s) while the load stood at 24 or more. Other sessions ran beside the probe, a code reviewer's targeted tests among them, so every figure is "beside the host's real load". Bindings were interleaved round by round, so they shared conditions within a mode. Everything ran at `nice -n 10`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Harness | One provider module behind six bindings. Three are the brief's: in-thread, stdio JSON-RPC and a command per run. Three are added: a worker thread, a command with Node's compile cache, and ESLint's own CLI per run. Two checks: a trivial one, and ESLint on one 236-line file. Every binding makes the same selection and the same four calls per edit. | verified by experiment |
| 2 | Cost per edit (medians, n = 25) | Warm, trivial check: CPU 0.20 ms in-thread, 0.79 worker, 1.80 RPC, 46 command. Warm, ESLint: 48 ms in-thread, 51 worker, 60 RPC, 420 command. Cold, ESLint: 358 to 441 ms for every binding, because loading ESLint dominates. A persistent binding pays the tool's load once; a command pays it on every edit. | verified by experiment |
| 3 | Scheduler calls | A one-file edit makes 4 awaited calls and 9 synchronous hints. A 60-file edit makes 64 to 119 awaited calls and 755 to 1,289 hints. One hint costs under 0.03 µs in-thread, 44 µs of CPU in a worker and 91 µs over RPC. Over RPC, the hints of a 60-file edit would hold the scheduler's lock for 69 to 117 ms of CPU. | verified by experiment; read in source code (the lock) |
| 4 | Containment | In-thread: a 3 s block stopped the host's timers for 3,002 ms, and the core's own call bound never saw it. A throw from the provider's timer ended the host (exit 1). Worker, RPC and command: all four faults contained. The heartbeat gap stayed at 62 ms or less, the guard fired, a kill freed the provider and a fresh one ran. | verified by experiment; read in source code |

## Findings

### 1. Harness

`provider.mjs` holds all the logic. `invalidate` drops cached file text. `affected` and `closure` read imports by a regex. `tierWidth` answers from local state. `run` either reads the check file (`trivial`) or lints it with ESLint's Node API (`eslint`). ESLint loads on the first run and stays loaded. The bindings are in `bindings.mjs`:

- `inproc` imports the module into the host's thread.
- `worker` runs it in a `worker_threads` worker, with structured-clone messages.
- `rpc` runs it in a persistent child process. It uses JSON-RPC 2.0 with `Content-Length` framing over stdio, the framing that the 016-08 judgment chose.
- `command` starts a fresh `node command.mjs` per run, which writes a JSON report file. The host selects with the same provider code, as a core would select from a manifest's declared scope.
- `command-cc` adds `NODE_COMPILE_CACHE`.
- `command-cli` runs `eslint -f json -o <report>`, the command a manifest tier would really run.

All six return the same verified result. The trivial check returns one pass. ESLint returns one fail with one `no-unused-vars` message.

The timed span starts after the edit is written and ends at the verified result. A cold sample is a fresh host process, timed from `open()`: module load, process start, ESLint load, framing and encoding all count. A warm sample follows three untimed edits on an open binding.

CPU is the host's `process.cpuUsage()` (all threads, so a worker counts) plus the provider process's own. The RPC server reports its CPU before and after each sample, outside the span. Each command reports its CPU from fork to exit through a preload. The command figures read about 10 ms low: the host's `/proc/self/stat` child ticks were a median 10 ms higher, ranging from −13 to +37 ms over 250 samples. They have 10 ms resolution and include the exit.

The span does not include the watcher, revisions, keys or the store.

ESLint's CLI turns on Node's compile cache in `TMPDIR` by itself: `bin/eslint.js` line 15, `mod.enableCompileCache?.()` (read in source code, 9.39.5). So each cold sample got a fresh `TMPDIR`.

### 2. Cost per edit

Medians, with p10 to p90 in brackets. CPU is the host plus the provider process. From [results/summary.md](probes/binding-cost/results/summary.md); verified by experiment.

| Check, state | in-thread | worker | RPC | command | command, compile cache | ESLint CLI |
|---|---|---|---|---|---|---|
| trivial, warm: wall ms | 0.17 [0.11–0.52] | 1.06 [0.64–3.4] | 1.64 [0.91–7.0] | 60 [51–112] | 62 [53–112] | – |
| trivial, warm: CPU ms | 0.20 [0.12–0.53] | 0.79 [0.65–1.3] | 1.80 [1.35–2.8] | 46 [41–56] | 51 [42–55] | – |
| trivial, cold: wall ms | 1.9 [1.5–2.8] | 42 [37–60] | 41 [33–50] | 42 [37–49] | 41 [36–53] | – |
| trivial, cold: CPU ms | 2.5 [2.1–2.9] | 48 [42–60] | 48 [40–56] | 41 [36–47] | 41 [36–50] | – |
| ESLint, warm: wall ms | 36 [28–73] | 42 [21–77] | 42 [26–101] | 376 [290–632] | 360 [268–481] | 364 [289–586] |
| ESLint, warm: CPU ms | 48 [31–72] | 51 [29–99] | 60 [39–94] | 420 [379–491] | 404 [352–432] | 436 [384–512] |
| ESLint, cold: wall ms | 255 [230–305] | 277 [254–328] | 291 [262–319] | 300 [274–361] | 339 [304–408] | 363 [309–424] |
| ESLint, cold: CPU ms | 358 [324–411] | 391 [353–444] | 392 [359–423] | 388 [357–433] | 416 [372–472] | 441 [386–500] |

What the numbers say:

- **Transport per one-file edit** (warm trivial, minus in-thread): 0.6 ms of CPU in a worker and 1.6 ms over RPC. Per awaited call that is about 0.15 ms and 0.40 ms (inferred: the four calls of the edit share it evenly).
- **Starting the provider once** costs about 40 ms of CPU for a worker or a process with a trivial provider, and about 2 ms in-thread. With ESLint, its own load (about 310 ms of CPU) is larger than any binding's share.
- **Warm ESLint:** worker and RPC are within the spread of in-thread. The medians are 3 and 12 ms of CPU higher, and the p10 to p90 ranges overlap almost fully, so the difference is not confirmed at n = 25.
- **The command pays the tool's load on every edit:** 420 ms of CPU against 48 ms warm in-thread. That is 8.8 times, or 372 ms more per edit. Its wall time is 10 times as long. Even a trivial command costs 41 to 46 ms of CPU for each run: the floor of starting Node.
- **Node's compile cache saved nothing measurable** (`command-cc` against `command`: warm 404 against 420, cold 416 against 388, within the spread). The cache directory held 262 entries, so it was written. Why it gave no saving is not determined.
- **Memory** (median RSS):
  - An RPC provider process stays resident at 49 MB (trivial) or 124 MB (ESLint, warm; p10 to p90 97 to 163) for its whole life.
  - A command peaks at 47 MB (trivial) or 87 to 95 MB (ESLint) per run, then exits.
  - In the daemon, cold ESLint grows the host by 37.5 MB in-thread and by 52 MB in a worker. A trivial worker adds 15.6 MB.
- **Load confounds warm against cold.** Warm ESLint ran at load 22.2 to 23.7 and cold at 17.1 to 23.2. A command does the same work either way, yet its CPU read 420 ms warm and 388 ms cold. So compare across rows within a mode only.

### 3. Scheduler calls

Counts come from the real `createScheduler` at `6f8a579a1`, with a counting runner that defines every hint and the 016-18 probe's virtual clock (`count.probe.ts`, `results/count-*.jsonl`; verified by experiment). The daemon's `afterEachRun` wrapper defines every hint for every adapter in the same way (`src/core/daemon/escaped.ts` lines 397 to 409). Three repeats gave the same counts, except for a drift of one or two `backlogSlot` calls in the 60-file slots shape. The load was 25.2 before these runs; they count calls, so it does not change them.

| Edit | Shape | Awaited calls | Synchronous hints | Runs (files) |
|---|---|---|---|---|
| a module one test file imports | either, 6 or 60 files | 4: `invalidate`, `affected`, `closure`, `run` | 9: `lane` 5, `backlogSlot` 3, `tierWidth` 1 | 1 (1) |
| a module every file reaches, 6 files | Vitest (tiers) | 10 | 53 | 2 (4, 2) |
| same | node:test (slots) | 11 | 43 | 3 (4, 1, 1) |
| same, 60 files | Vitest (tiers) | 64: `closure` 60, `run` 2 | 755: `lane` 408, `tierWidth` 172, `backlogSlot` 119, `tierPart` 56 | 2 (4, 56) |
| same, 60 files | node:test (slots) | 119: `closure` 60, `run` 57 | 1,287 to 1,289: `lane` 980, `backlogSlot` 303 to 305 | 57 |

How the counts grow:

- Awaited calls grow with the affected files: one `closure` per re-keyed file, and one `run` per tier or slot.
- Hints grow faster than the files. From 6 to 60 files, `lane` grows 13 times in the tiers shape and 43 times in the slots shape. Inferred from `tiers.ts` line 124: `lane` is asked per queued file at each selection, and each slot that ends starts a selection.

The hints are synchronous by contract: "selection holds the scheduler's lock" (`src/core/types/runner.ts`; read in source code).

**What one hint call costs** (n = 25 batches; load 18.3 to 22.0; verified by experiment):

| Binding | Wall per call | CPU per call |
|---|---|---|
| in-thread | under 0.03 µs | under 0.03 µs |
| worker | 54 µs [44–76] | 44 µs [31–57] |
| RPC | 97 µs [73–126] | 91 µs [59–127] |

Even if a hint could be awaited, the 60-file edit's 755 to 1,289 hints over RPC would cost 69 to 117 ms of CPU and 73 to 125 ms of wall time with the lock held. In a worker they would cost 33 to 57 ms. In-thread they cost under 0.04 ms (inferred: the count times the per-call cost).

A process cannot answer a synchronous call at all without blocking the daemon's thread until the reply arrives. The daemon already answers node:test's and pytest's hints as constants from options (`src/core/daemon/node-test-runners.ts` lines 61 to 65, `pytest-runners.ts` lines 79 to 83). Vitest's widths are a per-project table taken from `maxWorkers` (`src/runners/vitest/width.ts` lines 151 to 162). `lane` maps a project to its runner's name (`composite-runner.ts` line 123). All of these can be declared data.

The awaited calls of a 60-file edit over RPC would cost about 26 ms of CPU in the tiers shape and 48 ms in the slots shape (inferred: 64 or 119 calls at 0.40 ms; `closure` payloads may be larger than the probe's).

With a command per run, the slots shape would start 57 processes for one edit. At the 41 ms floor that is about 2.3 s of CPU before any tool work, and about 23 s with ESLint's per-run cost (inferred).

### 4. Containment

From [results/contain.jsonl](probes/binding-cost/results/contain.jsonl); verified by experiment. Each binding faced four faults:

- **throw:** `run` rejects.
- **throw-async:** a timer throws.
- **block:** the provider's thread sleeps 3 s in `Atomics.wait`, with no CPU burnt.
- **hang:** `run` never settles.

The host had a 50 ms heartbeat and a 1 s guard. It killed the provider when the guard fired, then ran a fresh one.

| Binding | throw | throw-async | block 3 s | hang |
|---|---|---|---|---|
| in-thread | rejected; gap 58 ms | **host process exited 1** | **heartbeat gap 3,002 ms; guard never fired**; the call then resolved | guard at 1,002 ms; cannot kill; the promise stays pending |
| worker | rejected | rejected ("worker error"); gap 53 ms | guard at 1,034 ms; `terminate()`; call rejected | same as block |
| RPC | JSON-RPC error | rejected ("provider process exited 1") | guard at 1,006 ms; `SIGKILL`; call rejected | same as block |
| command | exit 1 | exit 1 | guard at 1,004 ms; `SIGKILL` | Node itself exited 13 (unsettled top-level await) |

Outside in-thread, the largest heartbeat gap was 62 ms. A fresh provider ran correctly after every case that the host survived.

The in-thread block reproduces what the core does. `RunnerPartBound.call` starts the call first and its `setTimeout` second (`src/core/scheduler/runner-work-bound.ts` lines 47 and 52; read in source code). A provider that blocks synchronously therefore finishes or fails before the bound's timer even exists.

The in-thread `throw-async` ended the host because no file under `src/` installs an `uncaughtException` or `unhandledRejection` handler (grep at `6f8a579a1`; read in source code).

These results extend 016-02's p1 (a busy loop) to a sleeping block and to an asynchronous throw.

## Recommendation for Squeal

1. **Hints are data, never calls** (questions 3 and 2). A provider declares its lane, tier width per project, slot size and beside-backlog once per environment. Over RPC, the hints of one 60-file edit would hold the lock for 69 to 117 ms of CPU, and a synchronous answer from another process is not possible without blocking. A process binding carries only the awaited calls: 4 for a one-file edit, plus one `closure` per re-keyed file and one `run` per tier.
2. **A persistent binding for any tool with a real start-up cost** (question 2). Warm ESLint costs 48 to 60 ms of CPU in-thread, in a worker or over RPC. Per run it costs 404 to 436 ms. The transport itself is 0.6 ms (worker) or 1.6 ms (RPC) per one-file edit. That is small against any real check, but the RPC process holds 49 to 124 MB for its whole life.
3. **The command tier fits tools that start cheaply or edits that come rarely, and it runs one process per run, never one per file slot** (questions 2 and 3). Its floor is about 41 ms of CPU per run. With the slots shape, a 60-file edit would pay that floor 57 times. Do not count on Node's compile cache to close the gap (no saving measured).
4. **Third-party code goes out of the daemon's thread** (question 4). In-thread, one sleeping block stopped every timer for 3 s, and the core's own bound could not see it. One asynchronous throw ended the daemon. A worker thread contained all four faults at the lowest transport cost (0.15 ms per call, about 40 ms to start once). A child process contained them too and is the binding for other languages. Keep in-thread for first-party adapters only.

Limits:
- One tool (ESLint 9.39.5) and one synthetic 236-line file.
- Only Node providers: a Python provider's start-up cost is not measured.
- The figures were taken beside the host's real load (17 to 23.7). Absolute values can move with load; the comparison between bindings is interleaved.
- The command's CPU reads about 10 ms low.

## Open questions

- Why `NODE_COMPILE_CACHE` gave no measurable saving for a 400 ms ESLint start: not determined. A run at a lower load, or with a larger n, would show whether it is noise.
- The cost for a provider in another language (pytest's start, a Go or Rust tool): not measured. The 40 ms Node floor is Node's.
- Whether a large `closure` or `run` report changes the per-call RPC cost: the probe's payloads were small (one file, one message).
- How many hints a real Vitest or composite daemon makes per edit on squeal's own 591 test files: the counts here come from 6 and 60 files only. Growth was faster than linear.

## Sources

- Source at `6f8a579a1`:
  - `src/core/types/runner.ts`
  - `src/core/scheduler/refinement.ts` (the per-revision calls)
  - `src/core/scheduler/tiers.ts`
  - `src/core/scheduler/runner-work-bound.ts`
  - `src/core/daemon/escaped.ts`
  - `src/core/daemon/composite-runner.ts`
  - `src/core/daemon/node-test-runners.ts`
  - `src/core/daemon/pytest-runners.ts`
  - `src/runners/vitest/width.ts`
- [check-protocol-judgment.md](check-protocol-judgment.md), divergence 4 and spec input 1. [plugin-mechanisms.md](plugin-mechanisms.md), question 5, with its p1 probe.
- ESLint 9.39.5 and `@eslint/js` 9.39.5 from npm, installed under `/tmp/bc34/tools`: `bin/eslint.js`.
- Probe and raw data: [probes/binding-cost/](probes/binding-cost/README.md). The data files are `results/samples.jsonl` (625 samples, each with its load), `summary.md`, `contain.jsonl`, `count-*.jsonl`, `measure-log.txt`, `contain-log.txt`, and `check-n1.jsonl` (the one-sample check run before the 25-sample run, at load 15.9 to 16.8).
