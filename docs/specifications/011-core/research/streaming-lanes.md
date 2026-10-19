# 011-21: per-worker streaming lanes instead of tier barriers

Researcher R2 of 011 wave 3, 2026-10-19. Brief: `tasks/wave-3.md` R2, plus question 4 the human added through the coordinator the same day. Read: `docs/vision.md`, `docs/styleguide.md`, board rows 011-21 and 001-381, spec 011 C4 (steps 4 and 5, the stability check, the completion barrier), C7 claims, C9, C10 Capacity, `status.md` through 2026-10-19, and `research/backlog-wall-budget.md` (R1).

Versions: Squeal `53932ce8` (0.1.222; `src/` as at `fb6d3164`), Vitest 5.0.3 and 4.1.10 (npm tarballs), Node v24.21.0, 24 CPUs. The live arms ran a scratch clone of `53932ce8` with `probes/streaming-lanes/prototype.patch` applied and built. The today and W1 arms ran a first build, without the cancel, beside and per-run-mark changes; the rest ran the full patch, which with its variables unset runs today's code. Every arm used HOME, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` under `/tmp/r2sl/s-<arm>` and each fixture's store in its own `.git/squeal`. No real pool, store or session was touched. Each arm started only below a one-minute load of 8 on 24 CPUs. Other work then pushed the load as high as 80 during some arms. The fixture's files sleep, so their times barely move with load, but the load is given beside every number.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | node:test and pytest: what replaces the tier; an edit's wait mid-backlog | A slot is a one-file tier (for pytest, a one-batch tier), with W of them in flight per lane. The stability snapshot, completion barrier, claim, lease, record and checkpoint progress then each work per file, and a departure waits for at most one file. One shared mechanism breaks: the leftover-process sweep after a run is scoped to the lane's mark, so it killed the other slots' live tests. A per-run mark fixes it. With an edit 100 s into a heavy backlog, the edit's file was current after 58.8 s today, 58.9 s under W1, 16.9 s with slots and 0.27 s with an edit slot beside them | verified by experiment, read in source code |
| 2 | Vitest | One instance cannot stream. `runFiles` waits for the run before it, a custom pool is only a worker transport fed by that run, and two calls made in the same tick overlap wrongly (shared pool, `globalSetup` run twice). A second instance works: +84 MiB on 8 of Squeal's own files, with its own `globalSetup`. Two instances alternating would cut cezar's modelled Vitest backlog from 735 s to 615 s, against 560 s for slots | verified by experiment, read in source code, verified by replay |
| 3 | The gain over W1 on cezar | node:test lane (54 files): W1 takes 170 s, today and slots 117 s. An edit's mean wait is 43 s under W1, 11 s at the next free slot and 0 s with an edit slot beside the others. Vitest backlog at 23 workers: 735 s under W1, 560 s with slots (tail only: 507 s against 462 s) | verified by replay |
| 4 | An edit never waits for the barrier, per runner | node:test and pytest: run the edit's tier beside the backlog tier (b). Live, the edit was current after 0.23 s, nothing was thrown away, and the extra processes are the ones C10 already allows an edit. A drain (a) still waits for the tier's longest running file (58.6 s live, no better than today). A kill (a) answers in 0.29 s but threw away 50 worker-seconds live, and 46 to 208 per edit in the model. Slots (c) answered in 16.9 s. Vitest: keep the cancel (a). Its wait is already at most about 6 s, and the work it throws away grows under W1 from about 130 to 379–534 worker-seconds per edit on cezar. A second instance (b) could avoid that, but it runs the project's `globalSetup` twice | verified by experiment, verified by replay, read in source code |

## Findings

### 1. node:test and pytest: slots

**What Squeal already has per file.** node:test runs one process per file (`src/runners/node-test/run/run.ts`, `runNodeTest`), and a file is completed when its process exits with a whole event stream. A one-file tier is therefore a whole run: D12's rule that nothing in a crashed run is trusted applies per file. The reason C4 gives for not storing per file (Vitest's end-of-run checks and run-wide crash trust) does not hold here. pytest's unit is a batch process of up to 5 files (`runPytest`, `DEFAULT_BATCH_SIZE`; 007 D6: the 0.7 to 1.5 s start is amortised), and its files are known completed only when the batch exits, so a pytest slot is one batch. *read in source code.*

**The prototype** (`prototype.patch`, `SQUEAL_PROTO=stream`). A node:test or pytest lane holds up to `runner.tierSize` tiers in flight (`#busyLanes`), and `selectTier` stops at one file in such a lane. Every other code path is today's, run per one-file tier:

- **Stability snapshot.** It is taken at the slot's start for its file's inputs (`startTier`, `snapshotInputs`), and a revision during the run lands in that slot's `Tier.changes`. `WorktreeKeys.beginRun` clears its first-hashed map only when no run is in flight. During an unbroken stream that map is never cleared and grows to at most one entry per path. The comparison (`>= run`) stays correct. *read in source code.*
- **Completion barrier** (001-168, 007-30). `unstableInputs` and the withholds run per slot at its end. *read in source code; ran in every slot of the arms.*
- **Claims.** A key is `running` only while its slot runs, so a claim ends when the file records, not when its tier does. Another worktree that waits on a 1 s file inside a 300 s tier today waits the whole tier. Each daemon claims only W keys at a time, so worktrees on one commit share at file grain without `Claims.backlogSize`'s split. *read in source code; inferred for the sharing.*
- **Pool lease.** Each slot takes `take(1)` at its start and returns it at its end, and one slot holds the free worker. Every slot boundary is a fairness point, so C10's "waits at most one of its backlog tiers" becomes "at most until the holder's next slot ends". A lane-wide lease that grows and shrinks would never be preempted (C10: "a running tier is never preempted") and would hold the share for the whole backlog. Today the grant is ignored by node:test and pytest (both run `runner.tierSize` wide); slots honour it exactly. *read in source code, inferred.*
- **Checkpoint progress and results** move per file. *verified by experiment (the runs rows).*
- **Departure (C9).** No slot starts once the pump closes, and the slots in flight record. The wait is at most the longest file in flight, against a whole tier today. *read in source code.*
- **Timeout split (001-179)** is not needed: a slot that times out is one file, `unknown`. **The composite** today runs a tier's node:test projects one after another (`composite-runner.ts`, "the parts do too"). With slots, files of different projects run side by side. *read in source code.*
- **The sweep breaks.** After each run, `EscapedChildren.afterRun` stops every process that carries the lane's mark and started since that run began (`src/core/daemon/escaped.ts`, task 003-38). Its comment assumes nothing else of the lane runs meanwhile. In the first slot arm, every slot's end killed the slots started after it ("stopped 6 processes a test left running after its tier"; 45 of 64 runs (baseline included) `crashed`; the backlog took 713 s instead of about 248 s). A per-run mark (`envFor(lane#runId)`) fixed it. *verified by experiment (`results/heavy-stream-lane-mark.json`).*

**Measured** on the heavy fixture: 16 node:test files idling 20 to 90 s plus a quick file, W = 4, an edit of the quick file's import 100 s into `run --all --force` (`results/*.json`, `summarize.mjs`):

| Arm (load at start; range during) | Backlog | Runs | Edit: started after | current after |
|---|---|---|---|---|
| today, serial 300 s (7.71; 2.78 to 10.44) | 334.2 s | 5 tiers | 58.7 s | 58.8 s |
| W1, one round then 120 s (7.59; 6.34 to 26.62) | 249.2 s | 4 tiers | 58.8 s | 58.9 s |
| slots, next free slot (7.88; 7.41 to 32) | 249.0 s | 18 slots | 16.7 s | 16.9 s |
| slots, an edit's slot beside (7.96; 3.49 to 45.58) | 249.1 s | 18 slots | 0.14 s | 0.27 s |
| W1, edit's cancel drains the tier (7.55; 1.79 to 16.3) | 248.8 s | 4 tiers | 58.5 s | 58.6 s |
| W1, edit's cancel kills the tier (3.80; 2 to 10.36) | 261.8 s | 5 tiers | 0.15 s | 0.29 s |
| W1, edit's tier beside the backlog tier (7.32; 3.29 to 7.23) | 249.0 s | 4 tiers | 0.12 s | 0.23 s |

The model (`model.mjs`) predicted 333, 248, 248 and 248 s for the backlogs and 58, 58, 16 and 0 s for the waits; the live numbers add the edit's own run of about 0.1 s. *verified by experiment.*

**Per-file overhead.** On 300 light files (about 50 ms of CPU each), the backlog took 13.2 s today (a tier of 200, then 101; load 7.77 at start, 8.11 to 8.83) and 15.6 s with slots, 1.18 times (301 one-file runs; load 7.65 at start, 8.00 to 9.62). Each slot costs one selection transaction, one record transaction, one pool acquisition and one `node` start; node:test pays the start in either case. The record is the dear part on a large store. Each `ledger.commit` makes one state-sink call per checkpoint, and each call lists every known state of the worktree (`ledger.ts`, `mergeApplied`). The comment there measured 11 to 17 s for 198 calls at 4,982 states and 59 to 67 s at 15,468, on cezar's store: 55 to 340 ms of write lock per call. One call per slot would hold that for every file. A lane should record what completed since its last record in one commit: every slot that ends while a record holds the lock joins the next. *verified by experiment (fixture); read in source code (cezar figures).*

### 2. Vitest

- **One run per instance.** `runFiles` awaits `this.runningPromise` before it starts a run, in 5.0.3 (`dist/chunks/index.DpLw24bj.js:21114`) and 4.1.10 (`cli-api.BK8pd4xc.js:13576`). A second call 300 ms into the first waited for it (results 10.4 s, 11.6 s). Two calls in the same tick both passed the await before either set it. They ran in the one pool at once, finished in swapped order with their files mixed between the two promises, and ran `globalSetup` twice. Concurrent runs on one instance are therefore unsupported, not merely serialized. *verified by experiment (`results/vitest-instances.json`), read in source code.*
- **A custom pool cannot be fed.** `pool: PoolRunnerInitializer` supplies `createPoolWorker`, a transport for one worker that Vitest's internal `Pool` builds per task (`Pool.getPoolRunner`). The tasks come only from the `specs` of `pool.runTests` inside a run, and the run ends when they settle. `vitest.pool` is `private` in the types. Streaming files into a running run would need Vitest internals that are not covered by semver. *read in source code.*
- **Per-file results inside a run exist.** In a run of a 3 s and a 5 s file, `onTestModuleEnd` reported the 3 s file 2.0 s before the run ended. C4 still keeps the tier as the unit because the adapter's checks (001-146, 001-159) run at the run's end. *verified by experiment, read in source code.*
- **Several instances.** A second `createVitest` beside a first started in 18 ms against 75 ms, since the code was already loaded. On a scratch clone of Squeal running 8 of its unit files, the first instance took this process from 124 to 351 MiB RSS and the second added 6 MiB at creation and 84 MiB after its run (load 8.8 to 11.4). Runs on two instances overlap as intended (2.18 s for a 1 s and a 2 s tier at once). `globalSetup` runs once per instance per project (`_initializeGlobalSetup` caches per project object). Two instances therefore run it twice at once, and a project's setup that binds a fixed port, seeds one database or owns one directory would collide. Squeal's own (`test/global-teardown.ts`) gives each setup a fresh directory, so it would not. Each instance writes the shared results cache (`node_modules/.vite/vitest/<hash>/results.json`) at its run's end, last writer wins; that file only orders the sequencer. Every `invalidate` must reach every instance. *verified by experiment, read in source code.*
- **Two instances alternating.** A tier of three 1 s files and one 6 s file, then three 2 s files: 7.29 s one after another on one instance, 5.14 s when the second tier started on the second instance once only the straggler ran. *verified by experiment.* On cezar's Vitest backlog (735 files) at 23 workers, alternation gives 615 s against 735 s under W1 and 560 s with slots; at 6 workers, 1,215 s against 1,393 and 1,196 s. On the tail it gains nothing at 23 workers (507 s), because its 409 s file decides it. *verified by replay (`alternate.mjs`).*

### 3. The gain over W1 on cezar

Replayed on R1's `cezar-701f50.json` (per-file sums of check durations, which omit process start and collection, so every total is low; `cezar.mjs`, `results/cezar-replay.txt`). The mean and longest are an edit's wait at a uniformly random moment for its file to start, in a lane that runs to the end:

| Lane, W | today | W1 | slots | an edit's slot beside |
|---|---|---|---|---|
| node:test, 54 files, 4 | 117 s; mean 58, longest 117 | 170 s; 43, 93 | 117 s; 11, 40 | 117 s; 0 |
| Vitest whole backlog, 735 files, 23 | 2,141 s | 735 s | 560 s | 560 s |
| Vitest whole backlog, 6 | 2,428 s | 1,393 s | 1,196 s | 1,196 s |
| Vitest tail, 47 files, 23 | 2,092 s | 507 s | 462 s | 462 s |
| Vitest tail, 6 | 2,157 s | 951 s | 867 s | 867 s |

W1 makes cezar's node:test lane slower. Its first tier takes 53 files (76 s), and the 93 s file runs alone after it: 170 s, against 117 s for today's single tier of 54, which starts that file 24 s in. The measured tier took 168 s. Slots keep today's 117 s, and the mean edit wait falls from 43 s to 11 s. For Vitest, slots would save 9 to 24 % over W1, but Vitest cannot run them (finding 2). *verified by replay.*

### 4. An edit never waits for the barrier

**(a) node:test and pytest honour the cancel.** Neither adapter passes the edit's `signal` today, only `stop` (`adapter-project.ts`; `pytest/adapter-run.ts`). The prototype adds two modes. `drain` starts no further file and lets the running files end; the unstarted files are re-queued uncounted, as for Vitest. `kill` stops the running processes as `squeal stop` does: SIGTERM, then SIGKILL after 2 s. Live on the heavy fixture with W1's tiers and the edit at 100 s, all four files of the running tier were in flight. The drain then saved nothing: current after 58.6 s, backlog 248.8 s (load 7.55 at start, 1.79 to 16.3). The kill's edit was current after 0.29 s, but its four files were killed 12.6 s into their runs (50 worker-seconds) and ran again, and the backlog took 261.8 s (load 3.80, 2 to 10.36). In the model, a drain saves little because the tier's longest running file bounds the wait. An edit at a random moment waits on average 36 s against 42 s on the fixture, and 37 against 43 s on cezar's node:test lane. A kill waits about 0 s (plus a grace of up to 2 s) but throws away 46 s (cezar's lane) to 208 s (30 files of 80 to 145 s) of worker time per edit, and those files run again. For pytest, a kill loses a whole batch of up to 5 files. *verified by experiment, verified by replay (`options.mjs`), read in source code.*

**(b) The edit runs beside the backlog tier.** An edit's tier already runs at `runner.tierSize` without a permit, and the host may run that many extra processes per editing daemon (C10). The prototype (`SQUEAL_PROTO_BESIDE=1`) lets it start in a lane whose only tier in flight is a backlog tier. Live, with W1's tiers and the edit at 100 s: the edit's file started 0.12 s after the edit and was current after 0.23 s, beside the running tier of 4. The backlog took 249.0 s, as without the edit, and every run completed (load 7.32 at start, 3.29 to 7.23). In this fixture the edit re-keyed no backlog file, so the discard below was not exercised. The costs:

- **Pool fairness: unchanged.** The extra processes are the edit's, which C10 already allows outside the pool.
- **The stability check holds per tier.** Each tier keeps its own snapshot and revisions. A backlog file whose inputs the edit changed runs to its end and is discarded at record, where the cancel would have stopped it. The edit re-queues it either way, so the waste is that file's run. Files the edit did not reach store normally.
- **The sweep.** The edit's tier and the backlog tier overlap in one lane, so the per-run mark of finding 1 is needed here too.
- **Memory for node:test and pytest:** one process per extra file, as for any tier.
- **Vitest needs a second instance.** That costs +84 MiB in the probe, a second `globalSetup` running at once (the correctness limit of finding 2), and an `invalidate` to both instances.

*verified by experiment (wait, backlog), read in source code (the rest).*

**(c) Slots.** The edit takes the next free slot. Live: current 16.9 s after an edit at 100 s; the model's mean is 10 s on the fixture, 11 s on cezar's node:test lane and 35 s on 30 files of 80 to 145 s. With an edit's slot beside the slots, which is (b) applied per slot, the wait is 0: live, 0.27 s. *verified by experiment, verified by replay.*

**The work a Vitest cancel throws away under W1.** These are worker-seconds that ran in files that started and had not ended, averaged over an edit at a random moment (`meanCancelLoss`). Cezar's tail at 23 workers: 130 today, 534 under W1. The whole backlog at 23: 130 and 379. At 6 workers: tail 125 and 285, whole backlog 115 and 200. R1 measured it live: a 17-file tier cancelled at 100 s threw away 9 files in flight, and the lane took 251 s instead of 150 s. *verified by replay; verified by experiment in R1.*

## Recommendation for Squeal

Per runner, one answer to question 4 and one backlog shape. The deciding tradeoff: for node:test and pytest, an edit's tier beside the backlog removes the wait for the cost of processes C10 already grants an edit. For Vitest, the same thing costs a second instance and a second concurrent `globalSetup` that Squeal cannot prove safe (C10 Fidelity), while the cancel already returns an edit within about 6 s.

- **node:test and pytest: (b), an edit's tier beside the backlog tier,** a lane of its own for edits in effect, with a per-run process mark. **Then slots as the backlog shape:** one file per slot (pytest: one batch, packed to about `batchSize` light files, a heavy file alone), W = the grant, at most `runner.tierSize`, one `take(1)` lease per slot, and records batched per lane commit. Slots fix W1's regression on cezar's node:test lane (170 s back to 117 s), bound a departure and a claim by one file, and make an edit's slot beside them the same rule. Not a drain, which saves 6 s on average. Not a kill, which saves the rest of the wait but throws away 46 to 208 worker-seconds per edit.
- **Vitest: (a), the cancel as today, with W1's tiers.** Two instances alternating (615 s against 735 s on cezar) or an edit's instance are possible later, behind a project's opt-in, once a `globalSetup` that is safe twice can be stated. Slots are not possible in one instance.

**C4 sentences it would change** (step 5 as amended 2026-10-19, and the lanes paragraph):

- "A runner that cannot cancel (node:test, spec 003) runs its part of the tier to the end." becomes: "A runner that cannot cancel (node:test, pytest) runs its part of the backlog tier to the end, and an edit's tier of its lane starts beside it, with no permit (C10); a backlog file the edit re-keyed is discarded when its tier records."
- "Tiers run one at a time per **lane**" becomes: "Tiers run one at a time per **lane**, except that an edit's tier of a node:test or pytest lane starts beside that lane's backlog tier; each run's processes carry a mark of their own run, so the sweep after it stops only its own leftovers (D12)."
- With slots, step 5's "runs them in tiers of a configurable size" gains, for node:test and pytest: "in slots: up to W one-file runs (pytest: one batch) in flight per lane, each taking the next queued file as it frees and storing its file's results when it ends; W is the lane's grant, at most `runner.tierSize`; each slot holds one permit; what completes while a record holds the lock is recorded with the next." The departure sentence becomes "a departure waits for the files in flight". C10's "at most one of its backlog tiers" becomes "at most one of its files" for these lanes.

**Slice done-when, as tests** (`test/scheduler/`, the real node:test runner on scaled sleeps, an injected pool):

1. A node:test backlog tier of 8 files of 2 to 6 s is running and an edit reaches a quick node:test file: its result is current within its own run plus 1 s, before the backlog tier ends, and the tier's files all store.
2. With an edit's tier beside the backlog tier, a backlog file whose input the edit changed is discarded and re-queued; the others store under their keys.
3. Two runs of one node:test lane overlap through the daemon's run wrapper (`escaped.ts`) and the first ends: the second's processes are alive and its files complete (red on main: the first run's sweep stops them).
4. Slots: 16 files of 1 to 5 s at W = 4 finish within 5 % of the list-scheduling makespan, with no idle slot while files are queued, and checkpoint progress moves per file.
5. Slots: a departure during the backlog exits after the files in flight record, no new file starts, and the rest stay queued.
6. Slots: 300 files of about 50 ms run in at most 1.2 times today's single-tier time, with fewer record commits than files.
7. Slots: another daemon's waiter gets its share within one slot's file of the holder, not one tier.

## Open questions

- Slots for pytest were not run. Batch packing (how many light files per process) needs a measurement on a real pytest project.
- Slots on cezar's store: the batched record is designed from the 001-161 figures, not measured with slots.
- A Vitest edit's instance: which projects' `globalSetup` tolerates a second concurrent run is not determined. No source says, and Squeal cannot observe it.
- 001-381 (an edit splits a running backlog tier) is answered for node:test and pytest by (b). For Vitest it is the cancel already in place.

## Sources

- Squeal `53932ce8`: `src/core/scheduler/{tiers,scheduler,capacity,keying,ledger,backlog}.ts`, `src/core/capacity/pool.ts`, `src/core/daemon/{escaped,daemon,composite-runner,node-test-runners,pytest-runners}.ts`, `src/runners/node-test/{adapter-project.ts,run/run.ts}`, `src/runners/pytest/{adapter-run.ts,run/run.ts}`, `src/runners/vitest/{run,adapter,gate}.ts`, `src/core/types/runner.ts`; spec 011 C4, C7, C9, C10; 007 D6; R1's findings and `cezar-701f50.json`.
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js` (`runFiles`, `Pool`, `createPool`, `_initializeGlobalSetup`), `dist/chunks/plugin.d.BsjqSb4-.d.ts` (`PoolRunnerInitializer`, `PoolWorker`, `private pool`); Vitest 4.1.10 `dist/chunks/cli-api.BK8pd4xc.js`, `reporters.d.DtoKVV2s.d.ts`; npm tarballs, https://registry.npmjs.org/vitest/-/vitest-5.0.3.tgz and https://registry.npmjs.org/vitest/-/vitest-4.1.10.tgz.
- Probe: `probes/streaming-lanes/` (README, `prototype.patch`, `make-fixture.mjs`, `drive.mjs`, `run-arms.sh`, `run-variants.sh`, `summarize.mjs`, `model.mjs`, `options.mjs`, `cezar.mjs`, `alternate.mjs`, `vitest-instances.mjs`, `vitest-memory.mjs`, `results/`).
