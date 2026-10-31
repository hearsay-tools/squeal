# Row 011-281: trace the crash/re-key test's stalled phase

Worker 85cb47e8, wave 62 W2, coordinator dd7baf7f, 2026-10-31. Shape: survey, then repair only on proof. Repository tests only. No `src/` file changed.

## Result

The stall is not reproduced: the test passed 5 of 5 runs alone. The next CI stall of `test/scheduler/runs.test.ts` "runs a file again when a batch during its crashed run gave it a new key" now fails at 100 s, before Vitest's 120 s timeout. The failure names the wait that ran out and the spans still open in it. No trace and no code reading proves a stall in `src/` or in Vitest, so this row repairs nothing there.

## Files

- `test/scheduler/phase-trace.ts` (new; the coordinator accepted it on 2026-10-31, option (a)): `PhaseTrace`, `StallError`, `PHASES`, `processState`.
- `test/scheduler/helpers.ts`: `HarnessOptions.trace` (optional, default none), `traceRepo`, `cleanUp`. A traced harness marks every recording-runner call and bounds its close. Without a trace, every importer behaves as before.
- `test/scheduler/runs.test.ts`: the test is now `crashRekey(repo, trace)`, plus the opt-in forced-stall probe.

## Phases and bounds

Each phase is a span with queued, start and end marks, in ms since the test began.

| Phase | Span | Bound |
| --- | --- | --- |
| `baseline` | open the harness; start and the first idle | the test budget left |
| `batch` | `h.batch` of the crashing file; the fix's batch | budget left; 60 s cap for the background fix batch |
| `refinement` | each runner-part call: `invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment` | inside the wait that holds it |
| `runner.run` | each run, with its files, run id and end | inside the wait that holds it |
| `child rewrite` | from the crashing run's `beforeRun` until the file holds the fix | 60 s cap (as before), or budget left |
| `child exit` | from the rewrite until the child's pid is reaped; a mark when `/proc` shows it exited but not reaped (`Z`) | 60 s cap, or budget left |
| `idle` | both `scheduler.idle()` waits after the baseline | budget left |
| `cleanup` | `scheduler.close`, then on run-out `scheduler.close({ cancel: true })`, then `runner.close` | 30 s each |

- Test budget: 100 s from the trace's creation (`TRACE_BUDGET_MS`). That leaves 20 s of Vitest's 120 s for the report. A run that took 100 to 120 s passed before and now fails. The CI passes of this test took 1,054 ms and 618 ms.
- Cleanup: three 30 s steps (`TRACE_CLEANUP_MS`) fit in the 120 s hook timeout. A close that runs out is retried with cancellation. The adapter's forced cancel settles a stuck run within about 6.5 s (1 s grace, 0.5 s `beforeForce`, 5 s after the forced cancel). Then the runner still closes. A close that took 30 to 120 s passed before and now fails; this test's close ends with no tier in flight.
- The child polls get their bound plus 2 s, so the trace's bound always runs out first, and a poll stops soon after its span ends.
- The child writes its `process.pid` to `<tmp>/kill.pid`, outside the worktree, before it writes the fix. Batch timing does not change: the fix batch is still sent as soon as the rewrite is seen.

## The failure report

A `StallError` message (and, for any other failure of a traced test, a `console.error` in `afterEach`) holds:

1. A headline: the phase and detail that ran out, and the bound.
2. The open spans, oldest first, with queued and start times. A held span is marked `(held: forced stall)`.
3. The last 80 marks.
4. Harness state: revision, `queued()`, `inUse()`, `owedWork()`, header counts, each recorded run with its end in the store, and scheduler errors.
5. This process's child processes from `/proc/self/task/*/children`, with state letter and command. These are the inner Vitest's fork workers.
6. The kept tmp dir, its `store.sqlite` and `runs/`, with the end line of each run's `vitest.log`.

The tmp dir is kept after a stall or a failed traced test (`PhaseTrace.keeps`). CI does not upload `test/fixtures/scheduler/.tmp`, so in CI only the inline report survives. Uploading it on failure would be a `.github/workflows/ci.yml` change; this row does not own that file.

How to read the next CI stall:

- `runner.run` open with no end: the run never settled. Look at the child exit span. If the child was reaped and the run is still open, the Vitest adapter or Vitest's fork pool did not settle the run after a worker died. The harness keeps the default 600 s run timeout, so nothing cuts that run within 120 s.
- A `refinement` call queued but not started while a run is open: it waits behind the run in the recorder's queue. That is expected. Find the open run.
- A `refinement` call started and not ended, with no run open: the runner part itself is stuck in the adapter.
- No span open, and `idle` ran out: the scheduler did not report idle. The harness lines show what it still holds.
- `cleanup [scheduler.close]` ran out after an `idle` stall: something that `close` awaits is stuck (see the next section).

## What the trace shows locally

From the forced-stall probe of 2026-10-31, at load about 15 on 24 CPUs (`child exit` case, ms since the test began):

- Baseline: 5 test files in 3 runs, about 1 s including Vitest startup.
- Crashing run of `test/kill.test.ts` started at +766. Rewrite seen at +949. Run ended `crashed` at +960. The fix batch ran from +949 to +964. Rerun from +976 to +1154, `completed`.
- In the `cleanup` case: rewrite seen at +925, the child already exited but not reaped at +925, run ended `crashed` at +941, child reaped by +948.
- At each report, `/proc` showed no live child process: the inner Vitest kept no fork worker between runs.

So the fix batch starts during the crashed run. It can end just after the run ends, as it did here. Both orders are covered by the test's assertions.

## Code reading (inferred, not proven)

CI 40853153243 timed out the test at 120 s and then its cleanup at 120 s. `Scheduler.close` (`src/core/scheduler/scheduler.ts`, `#close`) sets `closed`, calls `#notify()`, awaits `#pumping`, takes the lock, and resolves every idle waiter. Every wait inside the pump loop (`#nextEvent`, `#eventOrAfter` for the 20 s and 120 s quiet waits and the capacity recheck, `#claimWake`) ends on `#notify`. So:

- A lost `idle()` wakeup, or a quiet, claim or capacity wait, explains the test timeout but not the cleanup timeout: `close` would end those within milliseconds.
- The cleanup timeout needs a wait that `#notify` does not end. These remain: a tier in flight that never settles (the pump's `finally` awaits every flight), the runner-work drain (`#draining`, whose calls the recording runner queues behind the run), a pump step such as the install or hold check, the scheduler lock, or `runner.close()` (Vitest close).
- The passing crash-only test (846 ms in the same CI run) has no second run and no runner part on the same Vitest instance after the dead worker. The re-key test has both. That is the only scenario difference. It points, without proof, at the Vitest adapter or Vitest's pool after a SIGKILLed fork. The next CI report separates these cases.

## Forced stalls (test-only hook)

`TraceOptions.stall` holds the first span of the named phase after the baseline (for `baseline`, the baseline's first run) until a bound runs out. Then every hold is released, so cleanup can close. Run by hand, below the CPU count in load:

```sh
env -u PLUGIN_ROOT -u PLUGIN_DATA SQUEAL_STALL_PROBE=1 pnpm exec vitest run test/scheduler/runs.test.ts -t "forced stall" --maxWorkers=1
```

Each case uses a 20 s budget and 5 s cleanup steps. It asserts: a `StallError` whose phase or open spans include the forced phase, a held mark, the kept dir named in the message, a wait no longer than its bound plus 1 s, the whole case under 35 s, a clean rest of cleanup, and the store on disk.

## Verification, 2026-10-31

- Probe, all 8 phases, one invocation at load about 17: `Tests 8 passed | 7 skipped (15)`, 151.29 s.
- Probe, `runner.run`, `child exit` and `cleanup` with reports printed, at load about 15: 3 passed; 20.2 s, 20.1 s and 6.3 s.
- The test alone, 5 runs, `--maxWorkers=1 -t 'runs a file again when a batch during its crashed run gave it a new key'`: 5 of 5 passed in 1516, 1337, 1430, 1288 and 1224 ms, at one-minute loads 23.66, 23.29, 22.23, 21.89 and 21.82 on 24 CPUs.
- `pnpm run lint`: `Checked 2586 files ... No fixes applied.` `pnpm run typecheck`: no output, exit 0.
- Squeal: see the worker's final message for the affected results at the final revision.

## Decisions the brief did not settle

- New file `test/scheduler/phase-trace.ts` instead of growing `helpers.ts` (436 lines before this row); the coordinator accepted it.
- Default budget 100 s and cleanup steps of 30 s: lower than Vitest's 120 s, so the report wins the race. No timeout was raised.
- `afterEach` now calls `cleanUp()`, which pops one cleanup at a time. `afterEach` still drops the rest after the first throw, as before. `cleanUp()` lets the probe run cleanup inside a test.
- The probe is opt-in (`SQUEAL_STALL_PROBE=1`): 8 real Vitest instances and about 150 s are too much for every CI run.
- A held runner call waits before `beforeRun`, so a held crashing run never starts its child.

## Type changes

All additive and test-only: `HarnessOptions.trace?: PhaseTrace`; new exports `cleanUp` and `traceRepo` from `test/scheduler/helpers.ts`. The internal `serial` and `guarded` of the recording runner take a span detail.

## For the next worker

- When CI stalls again, read the report and use the reading guide above. A `runner.run` span open after the child was reaped points at `src/runners/vitest/` or Vitest's pool: report it, as the brief says. This row does not own those files.
- Other tests can opt in with `traceRepo(repo)` and `HarnessOptions.trace`. Only `runs.test.ts:118` does now.
