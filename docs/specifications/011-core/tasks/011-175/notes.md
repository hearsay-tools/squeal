# 011-175: the 011-137 validity case gives one output on every run

Worker e781447d, wave 30 W5, from main at 905a7ee76 (after 0.1.288), 2026-10-24. Shape: repair (test).

## 1. What CI saw

Main CI 40077710759, attempt 1, Node 22 (1/3): `adapters.test.ts:79` ("fails Vitest's when the errors it reads change a stored fingerprint") found the case "a step-down's cancel completes a module that ended whole in its grace (row 011-137)" among the differing cases. The log names only the differing cases, not each leg's output, so it does not say which leg lost the pass. The comparison took 6.2 s; the shard ran beside `scheduler/forced-requeue` and `watcher/storms` on the runner's 4 vCPUs.

## 2. Probe: which leg differs, and why

### Method

A scratch test, outside the repository, calls `compareTrees` as the fingerprint test does: the baseline is this checkout, the candidate is the checkout with the `results.ts` error-name mutation, the cases are `only("adapter:vitest")`. For each repetition it records, per leg, what the case stored and the case's run log (`vitest.log`). A "pinned" batch runs the scratch test and the load on the same 4 cores (`taskset -c 20-23`), as on a CI runner. The load is one or two loops of `npx vitest run test/runners/vitest --maxWorkers=3`. The host has 24 cores and runs other coordinators' tests. Batch 3 adds a temporary timeline to the harness (not committed): when the test's result reached the adapter's reporter, when the harness saw `$STARTED`, when it cancelled, and when the module ended.

| Batch | Code | Where | Repetitions | Legs that stored the pass | Case differed | Run ms (min / median / max) | Load (1 min) |
|---|---|---|---|---|---|---|---|
| 1 | main | 24 cores | 20 | 40 of 40 | 0 | 685 / 768 / 861 | 31 to 49 |
| 2 | main | 4 cores, 1 to 2 load loops | 20 | 40 of 40 | 0 | 814 / 987 / 1,432 | 33 to 55 |
| 3 | main, timeline, the case alone | 4 cores, 2 load loops | 40 | 80 of 80 | 0 | 763 / 955 / 1,483 | 26 to 57 |
| 4 | the fixture without its 500 ms delay, the case alone | 4 cores, 2 load loops | 10 | 0 of 20 | 0 (both stored nothing) | 273 / 523 / 924 | 29 to 39 |

*Read from the scratch test's records.*

Batch 3, 80 legs: the test's pass reached the reporter 386 to 438 ms (median 415) before the harness saw `$STARTED`. The module ended 4 to 35 ms (median 17) after the cancel, against a grace of 1,000 ms. Batch 4, 20 legs: the pass reached the reporter 6 to 26 ms after the harness saw `$STARTED`, at the module's end, and every run log prints the `PASS` line after the cancel note.

### Vitest's worker can hold a result until the module ends

The first repair (a wait for proof, section 3, without the suite end) hung in 2 of 20 runs of `cancel-grace.test.ts` (load 14 to 20) and once in Squeal's run at revision 29: the whole file's `afterAll` reached Vitest's 10 s hook timeout, so the pass never arrived while the hook waited. The cause is in Vitest 5.0.3's worker (`throttle`, `vitest/dist/chunks/run.BTlFXlnv.js:3782`). A task update is sent at once when more than 100 ms passed since the last send; otherwise a timer sends it later. When that timer fires and `now - last > 100` is still false, the timer is not set again (`pendingCall ??= ...` keeps the timer that has just fired), so the update waits for the worker's next task update. In these fixtures the next update is the module's end, after the cancel.

A scratch Vitest project (`createVitest` with a reporter that records `onTestCaseResult` and `onTestModuleEnd`; one test, then an `afterAll` that waits 1,000 ms), at host load 7 to 8:

| File | Runs | Result held until the module ended | Gap from result to module end, ms |
|---|---|---|---|
| `it("passes")`, then the `afterAll` | 60 | 4 | 1 when held, else 902 to 905 |
| the test in a `describe` whose `afterAll` waits 150 ms, then the file's `afterAll` | 40 | 0 | 1,002 to 1,056 |

*Read from the scratch probe.* In the second file the gap of 1,002 ms (2 of 40) is the held case: the suite's end, 150 ms after the test, sent the result.

### Findings

1. **The leg is not fixed.** Both legs run the same code: the mutation changes an error's name, and this case has no error. So either leg can lose the pass. In 160 legs on main neither lost it here, and the CI log does not name the leg. *read from the probe; the CI leg cannot be read.*
2. **The cause is a held result.** Under a step-down the case stores the pass only when the test's result reached the adapter's reporter before the cancel was asked (C9; `cutShort`, `src/runners/vitest/reporter.ts`). Vitest's worker sometimes holds that result until the module's end, which comes after the cancel; the module then reads as cut and the leg stores nothing. The fixture's 500 ms delay before `$STARTED` cannot help: a held result waits for the module's end, however long the delay. *the mechanism read from Vitest's code and the scratch probe; that CI's loss was a held result is inferred, since the case's rule admits no other way to store nothing.*
3. **A held result needs a punctual timer.** It is held only when the result is queued within about 1 ms of the last send and the timer fires on time. Under load timers fire late, so the 160 loaded legs held none (in batch 3 the result was queued about 18 ms after the last send). On the quiet host the plain file held 4 of 60. *read from the probes; the timing rule from the code.*
4. **The grace is not the cause.** The module ended within 35 ms of the cancel in 80 legs, against 1,000 ms. *read from the probe.*
5. **A loss at both trees passed unseen.** In batch 4 both legs stored nothing, so the outputs were equal and the comparison passed. No check required that the case store its pass.
6. **The product rule loses the same modules.** In a real step-down, a module whose last result the worker holds reads as cut, and its file runs again in the successor. It costs a run, never a wrong result. No `src/` file changed for it.

## 3. The repair

| Where | What |
|---|---|
| `test/keys/validity/harness/vitest.ts` | `witnessed(node, heard)`: the Vitest module the adapter is given, each instance with a reporter after the adapter's own that adds each test's full name to `heard` as its result arrives. `untilStarted(marker, heard)`: once `$STARTED` exists, it waits until `heard` holds each test the marker names, one per line. A marker with no names, as every other fixture writes, waits for nothing. |
| `test/keys/validity/cases/adapter/vitest.ts` | `WHOLE_IN_GRACE`: its test is in a `describe("ran")` whose `afterAll` waits 150 ms, so the suite's end sends the result (finding 2). The file's `afterAll` names `ran > passes` in `$STARTED`, written through a rename so the harness never reads it half written, then holds. The 500 ms delay is gone. The case's reason says a release before 0.1.287 stores nothing of it. |
| `test/keys/validity/adapters.test.ts` | The fingerprint test also requires the case to store its pass at both trees, so equal outputs cannot be two losses (finding 5). |

Why a name in `heard` proves the adapter has the result: Vitest calls its reporters in list order, in one synchronous pass (`Vitest.report`, `Promise.all(this.reporters.map(...))`). The witness is after the adapter's reporter, whose `onTestCaseResult` is synchronous. So when the witness hears a test, the collector has recorded it, and `cancelRequested` was still false. The adapter takes the Vitest module as its second constructor parameter, so no `src/` file changed.

Why the suite's end always sends the result: either the worker sent an update after the test's result was queued, and that update carried it; or it sent none, so the last send is older than the test, and the suite's end, 150 ms after the test, is more than 100 ms after it and is sent at once. The 150 ms is not the proof; the witness is.

### Checks

- Red, the race: batch 4, 0 of 20 legs stored the pass.
- Red, the held result: the wait without the suite end hung to the hook timeout in 2 of 20 `cancel-grace.test.ts` runs and at Squeal revision 29.
- Red, the new assertion: at Squeal revision 23, with a fixture that names no test, `adapters.test.ts:86` failed ("expected [ { runs: [ { …(4) } ] }, …(1) ] to match object …", `completed` and `results` empty). The differing-cases assertion passed in that run.
- Green, with the suite end, the comparison as the fingerprint test runs it (all `adapter:vitest` cases), 20 repetitions each:

  | Where | Load (1 min) | Case equal | Legs that stored the pass | Run ms (min / median / max) |
  |---|---|---|---|---|
  | quiet host | 4.3 to 7.5 | 20 of 20 | 40 of 40 | 307 / 322 / 352 |
  | 4 cores, 2 load loops | 3.7 to 26.1 | 20 of 20 | 40 of 40 | 352 / 544 / 1,040 |

  Before the suite end (the witness alone): 20 of 20 equal, 40 of 40 stored on 4 loaded cores (load 31 to 70). `adapters.test.ts` passed at Squeal revisions 22 and 24. *read from the scratch test's records.*

### Against the last release

The row's done-when asks that the case still store more than the last release. A scratch comparison of this case alone, with the same mutation so the Vitest alarm fires:

- Against 0.1.288, today's last release: both trees store the pass. The outputs are equal and nothing is reported, since 0.1.288 already has the 011-137 rule.
- Against 0.1.286: the release stores nothing and the candidate stores the pass, reported as "run 1, :test/whole.test.ts: absent at the last release, completed at the candidate (the candidate stores more)", with no raise.

So the case stores more than a release before 0.1.287, as designed. Against 0.1.288 it stores the same. *read from the scratch comparison, before the suite end was added.*

## 4. Upstream: the held result (for a later report; nothing filed)

- **Where.** Vitest 5.0.3, `node_modules/vitest/dist/chunks/run.BTlFXlnv.js:3782`, `throttle`, used by `sendTasksUpdateThrottled` (line 3798), which `updateTask` calls for each task event (lines 3799 to 3807).
- **What.** `call` sends at once when `now - last > ms` (100 ms). Otherwise it sets `pendingCall ??= setTimeout(call, ms)`. When that timer fires and `now - last > ms` is still false, `pendingCall` still holds the timer that has just fired, so `??=` sets no new one. The queued updates then wait for the next `updateTask` or for `finishSendTasksUpdate` at the module's end.
- **When.** The update is queued within about 1 ms of the last send, and the timer fires on time (`Date.now` has 1 ms steps). A fast test right after its suite starts is the usual case. Under load, late timers hide it.
- **Rate.** 4 of 60 runs of a file with one test and a 1 s `afterAll`, on a host at load 7 to 8 (section 2).
- **Effect in Vitest.** `onTestCaseResult` for that test arrives only with the suite's or the module's end; a live reporter lags by the length of the hooks after it.
- **Effect in Squeal.** A held result makes a whole module read as cut under a step-down (the 011-137 rule, `cutShort`), so its file runs again in the successor. It costs a run, never a wrong pass.
- **A likely fix.** Clear `pendingCall` when its timer fires, before the check, so the call sets a new timer.

## 5. Row 011-176: the runner's and the daemon's grace tests

Added by the coordinator during this row. CI for cand/0.1.289 (run 40080754326, Node 22 1/3) failed `test/runners/vitest/cancel-grace.test.ts` > "counts as completed under a step-down, its results kept; a cut module does not": `expected [] to deeply equal [ { project: '', …(1) } ]` (1,044 ms). The coordinator then added `test/daemon/step-down-keeps.test.ts`, the third grace fixture.

- **The leg and the cause.** In `cancel-grace` the whole file, `test/whole.test.ts`, completed nothing: its module ended in the grace and read as cut, because its pass reached the reporter after the cancel. The test took 1,044 ms in all, less than its run plus the 1 s grace before a forced cancel, so the module did end in the grace. Its shape is the one that holds a result (a fast test, then an `afterAll` that waits), so this is the held result of section 2. *inferred from the CI time, the rule and the fixture's shape.*
- **The daemon test.** No CI failure is known. It waited 1 s after its markers, and its `whole` file has the same shape, so a held result there would arrive after the step-down and the test would fail on `whole`.

### Red

- Squeal revision 4, `cancel-grace` with its 500 ms delay removed and no wait: FAIL with CI's message (`expected [] to deeply equal [ { project: '', …(1) } ]`, `cancel-grace.test.ts:157`).
- The witness without the suite end: 2 of 20 `cancel-grace` runs failed at load 14 to 20, and Squeal's run at revision 29 failed the same way. The whole file's `afterAll` reached Vitest's 10 s hook timeout, so the module failed before the cancel (`fileErrors` held "Hook timed out in 10000ms"; under the stop, `completedFiles` held the file).

### The repair

| Where | What |
|---|---|
| `test/runners/vitest/cancel-grace.test.ts` | `runOf` opens its fixture through `openFixture`'s `create` with a `VitestAdapter` over `witnessed(await loadVitest(root), heard)`, and cancels once each file waits and `heard` holds the tests `ran` names. The whole file's tests are in a `describe("ran")` whose `afterAll` waits 150 ms; its 500 ms delay is gone. The step-down and the stop runs name `ran > passes` (`WHOLE_RAN`), and the expected outcomes carry the suite's name. |
| `test/daemon/step-down-keeps.test.ts` | The fixture's `vitest.config.ts` gains `globalSetup: ["./witness.ts"]`. `witness.ts` pushes a reporter onto the daemon's Vitest instance (`project.vitest.reporters`, after Squeal's) that writes `whole-heard` on the result of `ran > passes` and `finished-heard` on the end of `test/finished.test.ts`. The test waits for both markers in place of its 1 s delay. `whole`'s test is in a `describe("ran")` whose `afterAll` waits 150 ms. |

`cancel-grace` now builds the base `VitestAdapter`, not `createVitestAdapter`'s `SizedVitestAdapter`: the subclass only answers width questions, which store nothing (row 011-40). `globalSetup` runs in Vitest's main process, in the daemon, and Vitest 5.0.3 passes it the `TestProject` (`globalSetupFile.setup?.(this)`); `reporters` is set once, when the instance starts, and read at each event.

### Green

| Test | Where | Load (1 min) | Runs passed |
|---|---|---|---|
| `cancel-grace.test.ts` | quiet host | 4.0 to 4.6 | 20 of 20 |
| `cancel-grace.test.ts` | 4 cores, 2 load loops | 21 to 36 | 20 of 20 |
| `step-down-keeps.test.ts` | host | 18 to 19 | 5 of 5 (5.9 to 6.6 s each) |

*read from the runs' summaries.*

## For whoever continues

- A grace fixture must cancel on proof, not on time: give the adapter `witnessed(await loadVitest(root), heard)` and wait for the names before the abort. Put the tests whose results must arrive in a `describe` whose `afterAll` waits more than 100 ms, or the worker can hold the last result until the module ends.
- `tasks/011-137/notes.md`, "wait at least about 300 ms after the file's last test", is replaced by the two rules above. All three grace fixtures now follow them.
- For a runner in another process, as the daemon's, the witness is a `globalSetup` that pushes a reporter onto `project.vitest.reporters` (section 5). A Vitest that rebuilds or freezes that list would make the wait time out after 60 s, never pass falsely.
- `witnessed` lives in the validity harness, and `cancel-grace.test.ts` imports it from there. A shared helper under `test/helpers/` would be a better home; no row owns one.
- The scratch scripts live in the worker's scratch directory, which goes with the worktree: `legs.repro.test.ts` (the comparison, repeated; `REPRO_N`, `REPRO_ONLY=1` for the case alone), `release.repro.test.ts`, `summary.cjs`, `load.sh`, and `throttle/probe.mjs`. Sections 2 and 5 describe them well enough to write them again.
