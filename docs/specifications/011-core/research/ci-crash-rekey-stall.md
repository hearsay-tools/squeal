# Retire the Vitest instance after an unattributed worker crash

2026-10-31. Wave 64 R1, row 011-281. Diagnosis only; no product repair.

**Verdict:** a crash during cancellation can leave Vitest's cancellation promise pending after the run has reported its crash. The next run waits for that promise **before it spawns a worker**. The controlled probe proves this mechanism. It closely matches CI 41219271687 attempt 1, but that CI trace did not capture Vitest's internal promise, so attribution of the historical stall remains **inferred**.

Examined: Squeal `4e66b4b52`, package 0.1.385; Vitest 5.0.3; local Node 22.19.0, matching CI's Node version. The named scheduler, fixture and adapter files have no diff from failing candidate `fa02d697cc9ef33134838175aa18faa819be2486`. [Probe, source extracts and outputs](probes/ci-crash-rekey-stall/README.md).

## Questions answered

The brief's question is split into its five requested parts. Versions are those above.

| Question | Answer and evidence tag |
| --- | --- |
| 1. Did the re-run spawn, or lose its own child's end? | **verified by experiment**, Vitest 5.0.3/Squeal `4e66b4b52`: the forced re-run enters `runTestSpecifications`, but its worker count stays at one, the previous child is gone, and its cancellation promise remains the same pending promise. No second worker spawns. **inferred** for CI run `414c9364`. |
| 2. What does it await? | **read in source code**, Vitest 5.0.3: `runFiles` awaits `cancelPromise`. `Pool.cancel` awaits `cancelTask`, which awaits `PoolRunner.waitForTerminated()`. An unexpected exit sets `STOPPED` but does not resolve `_terminatePromise`. This is a missing settlement for the previous worker, not a run-log or PID-file wait. |
| 3. Why does crash plus re-key reach it? | **read in source code**, Squeal `4e66b4b52`: the edit supersedes the one unfinished file, aborts its run, and queues its new key. The crash report returns while cancellation remains pending; the adapter retains the instance. The scheduler starts the queued file on it. |
| 4. Smallest supported repair? | **inferred**, Squeal `4e66b4b52`: retire and recreate the instance when an unattributed runner error makes its report `crashed`. **verified by experiment**: closing and reopening the public adapter after this forced crash makes the fixed file complete. |
| 5. Regression that forces the path? | **verified by experiment**, Node 22.19.0/Vitest 5.0.3: let the child rewrite its file, hold it until parent cancellation captures its active task, then let it SIGKILL itself. Require the new-key run and cleanup to finish; preserve the crash's empty results. The probe provides the barrier. |

## 1. The stalled promise belongs to the previous child

**read in source code**, Vitest 5.0.3 (`dist/chunks/index.DpLw24bj.js`, preserved excerpts):

- `PoolRunner.emitUnexpectedExit`, lines 11001–11007, sets `_state = STOPPED` and emits the worker error. It never resolves `_terminatePromise`.
- Normal `stop` resolves that promise in its `finally` at line 10979. But `stop` returns early for a runner already `STOPPED` at line 10922.
- `Pool.schedule`'s `cancelTask` awaits `runner.waitForTerminated()` at line 11517. `Pool.cancel` captures active tasks and awaits their cancellation at line 11578.
- `Vitest.cancelCurrentRun` stores the listeners' `Promise.all` in `cancelPromise` at line 21278. `runFiles` awaits it at line 21113, before global setup or `pool.runTests`.

Thus cancellation can capture a running task, then its child exits unexpectedly. Its task error ends the run, but the captured termination waiter never settles. The worker's OS exit was observed; the defect is the missing settlement of Vitest's termination promise. No file is awaited here.

**verified by experiment**, the unchanged Squeal adapter and installed Vitest 5.0.3: the controlled child blocks with `Atomics.wait` between writing the fixed test and SIGKILL. The wrapper releases it only after the real `cancelCurrentRun` begins. The first report is `crashed`, with both supersession cancellation and `Worker forks emitted error`. The adapter created only one instance. On the next call, `runTestSpecifications` is called a second time, but after a 500 ms observation the original child is gone, workers spawned remains `1`, the same cancellation promise is pending, and no second log exists. Explicit stop then exercises Squeal's existing bounded escape and cleanup completes. A separate control closes and reopens the adapter after the first crash; the fixed file completes on instance two.

## 2. How Squeal reaches the wait

**read in source code**, Squeal `4e66b4b52`:

1. `crashRekey` in `test/scheduler/runs.test.ts:226` makes the child rewrite itself, then SIGKILL itself. The poll reports the rewrite as a batch. `helpers.ts:190` serializes adapter calls, but content keying can happen while the adapter run is in flight.
2. `TierYields.#decide` (`yields.ts:281`) selects `supersession` when all unfinished files' inputs changed. Its check aborts the tier at line 205. `executeTier` (`tiers.ts:656`) passes that signal to `runner.run`.
3. `src/runners/vitest/run.ts:122` calls `cancelCurrentRun` without awaiting it. If the run resolves in the first grace, `execute` returns immediately. Vitest catches pool errors in `runFiles`; they become unhandled reporter errors rather than a rejected `runTestSpecifications` promise.
4. `adapter.ts:618` retires instances for a hung execution, module-loader failure, rejected run or unloaded coverage. This worker crash meets none of those conditions. Later `buildReport` (`run.ts:208`) turns unattributed errors into `end: crashed`, with no completed files. The instance remains available for reuse.
5. `recordTier` records the crash. `Ledger.markUnknown` (`ledger.ts:545`) removes queued work only when the crashed key is still the file's key. The new-key work remains queued and gets the next `executeTier` call.
6. The next `execute` enters Vitest's pending `cancelPromise` wait. The scheduler's in-flight task awaits `executeTier` (`scheduler.ts:1048`), `idle` waits for it, and ordinary `close` awaits the pump (`scheduler.ts:858`). No scheduler exception is required.

**inferred**, from the fetched CI trace: this path explains the first run's log beginning `run cancelled: the revisions during it changed an input of every file that had not ended`, the completed refinement after that crash, and the re-run open with zero children. The missing re-run log alone proves no spawn fact: `writeRunLog` writes only after a report is built. Its 600,000 ms runner budget also exceeds the trace's 100 s idle budget and 30 s first close budget. The historical trace cannot exclude another internal wait with the same visible state.

## 3. Recommendation and repair boundary

**inferred**, Squeal `4e66b4b52`: extend the existing instance retirement path to the unattributed worker errors that make the final report a crash. Keep the crash report and its empty results. Close/drop that instance under the adapter's gate before another run can use it, then create the next instance through the existing path. Keep teardown bounded if it fails to settle. The public close/open control supports replacement for this exact case; it does not prove every crash can close promptly. The cost is losing a warm instance after a crash. Reusing a potentially broken pool is the worse tradeoff.

Do not merely await cancellation without a bound, raise the test timeout, or re-run the shard. Do not change scheduler keying or retry policy. The smallest upstream repair is to settle the termination promise on unexpected exit, with an upstream test for cancellation already awaiting it. That is a separate upstream change, not an approved part of this task.

Proposed regression: use the probe's blocking child barrier in the existing real scheduler scenario. Release the child only after the adapter's real cancel call begins. Require `crashed`, then `completed`; no old-key results; the fixed check current at its new key; a new instance/worker for the re-run; and bounded idle and cleanup. A test that lets the child service graceful-cancel IPC can miss this ordering, as the preliminary control did.

## Sources, verification and open questions

- [CI attempt 1](https://github.com/hearsay-tools/squeal/actions/runs/41219271687/attempts/1), fetched with `gh run view 41219271687 --attempt 1 --log-failed`; [preserved excerpt](probes/ci-crash-rekey-stall/ci-excerpt.txt).
- [Examined Squeal source](https://github.com/hearsay-tools/squeal/tree/4e66b4b52), paths and functions above; prior [research section 3](ci-intermittent.md#3-the-schedulers-240-seconds-are-two-distinct-timeouts).
- [Vitest 5.0.3 package](https://www.npmjs.com/package/vitest/v/5.0.3), installed runtime source, [exact excerpts and SHA-256](probes/ci-crash-rekey-stall/vitest-source.txt). No API claim comes from recall or unfetched documentation.
- The original named scheduler test passed **1/1** isolated invocation. Two final controlled probe modes passed. One preliminary control failed to force a crash because it allowed graceful cancellation; its output is retained. No full suite, build or product changes were requested. Commands and the pnpm automatic-install side effect are recorded in the probe README. The final scoped Squeal read returned no verdict for the research files, zero known failures and 349/1349 test files not current; this is no full-suite pass.
- Open: the exact internal state of CI run `414c9364` was not retained; attribution is inferred. This investigation proves no frequency under shard contention. The proposed repair still needs implementation, a deterministic scheduler regression, and review. Support across other installed Vitest versions was not examined.
