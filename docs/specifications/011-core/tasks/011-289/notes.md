# 011-289 notes: retire the Vitest instance after an unattributed crash

Row 011-289 (`tasks/wave-64.md` W2, from `research/ci-crash-rekey-stall.md`). Worker run `2307f465`, 2026-10-31. Shape: repair.

## The change

- `src/runners/vitest/adapter.ts`, the retirement after `execute`: a run with any unhandled error no test file accounts for (`unattributedErrors`, the predicate `buildReport` already used to end a run `crashed`) is now one more reason to drop the instance under `hold.exclusive`. It comes last in the chain: hung, broken, rejected and unloaded coverage keep their own handling. The coverage of such a run is dropped, not collected, since the instance is emptied by then.
- `src/runners/vitest/broken.ts`, `retireCrashed`: awaits `closeEmptied` for at most `CRASH_CLOSE_MS` (5 s), then writes one run-log note: `the run crashed on an error outside any test file: the instance is closed; the next run starts a new one`, or, when the close has not settled, `... the instance's close did not settle within 5000 ms and is left to finish; ...`. A close that does not settle is left to finish. A failed close is noted too.
- `src/runners/vitest/run.ts`: `unattributedErrors` and `settleWithin` are exported. `buildReport` is unchanged in behaviour.
- The report of the crashed run is unchanged: `end: crashed`, no completed files, no results, the same failure text. No status note is added; the crash's own delivered line stays the only one.

## Decisions the brief did not settle

- **Which crashes retire.** Every unattributed error, not only a worker's exit. Telling a worker exit from another unattributed error would mean matching Vitest's message text (`[vitest-pool]: Worker forks emitted error`), which is internal to Vitest. Every such run is already a crash, and nothing in it is trusted. The cost is one instance start after a rare crash.
- **The bound.** 5 s, the same as `GRACE_AFTER_FORCE_MS`. When the bound runs out, the close continues in the background and `closeEmptied` empties the old instance once its close settles. The next instance shares none of the emptied objects (`closedTargets` leaves plugin objects alone).
- **The test's release point in the scheduler test.** The harness builds its adapter through `createVitestAdapter`, so the test cannot wrap `cancelCurrentRun`. It releases the child from the run's abort signal through `setImmediate`. The adapter's `execute` calls `cancelCurrentRun` in the microtasks that follow the abort, and Vitest's `Pool.cancel` takes the running task synchronously in that call (`ctx.onCancel(() => pool.cancel())`, Vitest 5.0.3 line 11693). So the release is written after the real cancel began. The adapter-level test wraps `cancelCurrentRun` itself, as the research probe did, and also counts instances.

## The key-format alarm

`test/keys/key-format.test.ts` failed after the first commit: `VITEST_ADAPTER_VERSION: changed lines no case runs`, every line of `retireCrashed` and `adapter.ts`'s call. Commit `0508a2507` answers it without a version raise, as rows 011-245 and 011-137 did:

- `test/keys/validity/cases/adapter/vitest.ts`, "a run whose worker dies outside any test file stores nothing, and the next run stores its outcomes (row 011-289)": `test/kill.test.ts` SIGKILLs its worker (`unwaited`), then `test/held.test.ts` runs. Both trees store nothing of the crash and the same pass of the next run: the last release on its kept instance, the candidate on a new one. Neither file holds a skip or a failure, so the mutation self-tests in `adapters.test.ts` do not list it.
- `retireCrashed` is written so that each statement is one line in esbuild's output: the failure callback is an expression arrow, and the two notes are one call with a conditional. A normal close then runs every emitted line, as 011-245's `failed` arrow in `execute` does. A block-bodied callback would emit a line that only a failing or hung close runs, which no validity case can make.
- The alarm passed at revision 11 (FAIL -> PASS); `adapters.test.ts`, `compare.test.ts`, `self-test.test.ts`, `reach.test.ts` and `coverage.test.ts` were current with no failure at revision 11.

## Why Vitest's close settles here

Read in Vitest 5.0.3 (`dist/chunks/index.DpLw24bj.js`): the crashed task leaves `Pool.activeTasks` when its resolver rejects (`onTaskError`), before the close. `Vitest.close` awaits `runningPromise`, which is already cleared, then `Pool.close`, whose `cancel` finds no active task. It does not await the pending `cancelPromise`. The bound covers a shape this reading did not foresee.

## Evidence

Red, at revision 5 on the unchanged adapter (Squeal's runs):

- `test/scheduler/crash-cancel.test.ts`: `squeal scheduler test stalled (row 011-281): idle [after the crashing file's batch] did not end within 99167 ms`. The open span is the re-run of `test/kill.test.ts`, started at +1035 ms and open for 99065 ms, the same shape as CI 41219271687.
- `test/runners/vitest/crash-cancel.test.ts`, first case: the first run ends `crashed` with both the supersession cancel and `Worker forks emitted error`; it then fails because the run log names no retirement.
- The bound case: `retireCrashed is not a function`.

Green after commit `2b9765ca0` (Squeal's runs at revisions 6 to 8): all three pass, FAIL -> PASS. `test/scheduler/runs.test.ts`, with the scenario moved to `crash-rekey-fixture.ts`, passed before the product change (revision 5) and after it (revision 12, commit `0508a2507`). The scheduler's held-child run took 1.6 to 2.0 s in Squeal's runs, against the 99 s stall before.

Affected checks at revision 12 (`squeal status --wait 60000` on the three product files and `runs.test.ts`): 478 test files selected, all current; 474 pass. The 4 failures are bundle drift, `cli/squeal.mjs differs from the build`, in `test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/codex/packaging/runtime.test.ts`: the bundles are the coordinator's to rebuild (no `pnpm run build` in this row). `pnpm run lint` and `pnpm run typecheck` pass. No full suite was run.

## For the next worker

- `test/scheduler/crash-rekey-fixture.ts` holds `crashRekey`, now with `{ held: true }`. The forced-stall probe in `runs.test.ts` still uses it in the default mode.
- The upstream repair (settle `_terminatePromise` on an unexpected exit) is still outside this row.
