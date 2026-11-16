# 011-371: survey of `Scheduler.idle()` callers

Worker 25ee0ae9, wave 112 W2, 2026-11-16. Base: `8c9e04358` (0.1.523). Shape: survey with a small pilot. Changes no `src/` file and no file under `test/scheduler/`.

## Answer

- 258 test files reach `Scheduler.idle()`. 243 call it in their own text, and 15 reach it only through a fixture. 16 fixture files call it too. Under `test/scheduler/`: 211 test files and 13 fixtures.
- Measured class of each file (method below). **A**: at every call, `rest()` and `idle()` end at the same point, so `idle()` can become `rest()` with no other change. **B**: at one call or more, `rest()` ends while the runner's own work is in flight, and no timed wake is left. The wait depends on real time (a real Vitest or node:test run, or a fake run's real sleep), so a virtual clock does not help. **C**: at one call or more, `idle()` also waits through a timed wake that `rest()` names (a yield bound, a slow lane, a claims recheck, the pump, a merge hold). These files also need the virtual clock and a test that moves it.

  | Class | Files | Under `test/scheduler/` | Real Vitest/node:test harness | Catch-up family | Other builders |
  |---|---|---|---|---|---|
  | A | 32 (7 done in the pilot) | 25 | 13 | 15 | 4 |
  | B | 192 | 152 | 111 | 61 | 20 |
  | C | 34 | 34 | 16 | 16 | 2 |
  | All | 258 | 211 | 140 | 92 | 26 |

  By call: 1815 probed calls, 742 the same under `rest()`, 1002 with runner work set aside, 71 with a timed wake left.
- **A plain swap is not the main path.** `rest()` sets a runner's run aside (`GLOSSARY.md`, "Rest"; row 011-352), and `idle()` waits for it. So 192 of 258 files need a wait that also sees the runner's work. No such wait exists for the Vitest harness, and the catch-up `settle` sees only `CatchUpRunner.runs`. One helper row (H below) must come before the B and C sweeps.
- The 307 in the brief is `git grep -l '\.idle()' test`. 48 of those files call only another class's `idle()`: the lint pass (`pass.idle()`, 87 calls), the code pass (`code.idle()`, 63), the coverage writer (`writer.idle()`, `made.idle()`, 18), the shared reader (`reader.idle()`, 5) and `lint.idle()` (2). These calls are out of this row's scope. By directory: `test/lint` 22, `test/code` 21, `test/runners` 2, `test/shared` 2, `test/commit` 1. Three files call both kinds.
- **No `Scheduler.idle()` caller in `src/`, `evals/` or `scripts/`.** The plugin bundles under `plugins/*/dist` have none either. `src/` declares the method at `src/core/types/scheduler.ts:461` and implements it at `src/core/scheduler/scheduler.ts:883`. The other `idle()` methods in `src/` belong to other classes (`src/core/code/coverage/writer.ts`, `src/core/code/pass/index.ts`, `src/core/lint/pass/index.ts`, `src/core/shared/reader.ts`). In `test/`, only `test/scheduler/drive-fixture.ts:13` (`Pick<Scheduler, "idle">`) names the method in a type.

## Method

1. Inventory (`git grep`, a Node script): every `test/` file whose text calls `.idle()`, sorted by receiver. `scheduler.idle()` (also `x.scheduler.idle()`, `scheduler?.idle()`) is the Scheduler's. Every other receiver is one of the classes listed above.
2. A screen outside `test/scheduler/`: the 43 test files there had `scheduler.idle()` → `scheduler.rest()` applied with no other change, and Squeal's daemon ran them once (revision 8). 14 passed and 29 failed. The failures read results before the run that writes them had ended (for example `expected 0 to be greater than 0` on `h.runsOf(TEST).length`). Seven of the 14 that passed are class B: they passed because the run ended in time, not because the wait is the same. **A sweep must not take one pass as evidence.**
3. The call-level probe (appendix), in a private detached worktree with `node_modules` linked: each `scheduler.idle()` call site, in tests and fixtures, became `probeIdle(scheduler, "file:line")`. It awaits `rest()` (15 s guard), then checks whether `idle()` resolves within 3 `setImmediate` turns. It logs that, the real time `idle()` still took and the wakes `rest()` named, and then awaits `idle()` as before. So every test keeps its behaviour, and every call is measured. Classes per call: `same`; `timed` (a wake other than `runner-part-bound` was left); `aside` (otherwise: runner work in flight). A file is C with any `timed` call, else B with any `aside` call, else A. No call hung and no call threw.
4. Runs: `env -u PLUGIN_ROOT -u PLUGIN_DATA timeout 3000 node_modules/.bin/vitest run --maxWorkers=3`, four groups, 24 CPUs. Load is the one-minute load average at start and end:
   - Fake-runner direct callers: 108 files, 396 tests passed, 13:56 to 14:00 UTC, load 20 → 26.
   - Harness direct callers: 135 files, 444 passed, 8 skipped (`runs.test.ts`, the forced stalls), 14:00 to 14:08 UTC, load 27 → 18.
   - Files that import an `idle()`-calling fixture and call nothing themselves: 35 files, 185 passed, load 15 → 18. 15 of them reach a fixture's call. 20 never do and need no change.
   - Re-run after a fix to the rewriter, which had missed bare `scheduler.idle()` (no receiver before it): 7 files, 20 passed, load 15.

   The pilot's runs (below) ran beside the harness group.
5. Limits: one probed run per file, at load 15 to 30. A call that is `same` here can be `aside` on a slower host, when a run outlasts the 3 turns. The pilot's 3 of 3 supports class A for its 7 files only. Each A row still runs its files 3 times.

## Fixtures that call `idle()`

A fixture's call is swept in the fixture, once, and every test file that reaches it is covered. Columns: call sites; probed calls; their classes; test files that reached them.

| Fixture | Sites | Calls | Classes | Test files |
|---|---|---|---|---|
| `test/ci/export-harness.ts` | 1 | 3 | aside 3 | 2 |
| `test/integration/touched-repo.ts` | 2 | 18 | aside 18 | 3 |
| `test/scheduler/backlog-quiet-fixture.ts` | 1 | 4 | aside 1, same 3 | 1 |
| `test/scheduler/batch-fixture.ts` | 1 | 5 | aside 5 | 2 |
| `test/scheduler/crash-rekey-fixture.ts` | 3 | 6 | aside 4, same 2 | 2 |
| `test/scheduler/drive-fixture.ts` | 1 | 5 | timed 2, aside 1, same 2 | 2 |
| `test/scheduler/edit-cut-fixture.ts` | 1 | 18 | aside 18 | 3 |
| `test/scheduler/forced-requeue-fixture.ts` | 2 | 8 | aside 8 | 2 |
| `test/scheduler/group-lanes-fixture.ts` | 1 | 22 | same 22 | 6 |
| `test/scheduler/model-fixture.ts` | 1 | 138 | same 128, timed 10 | 1 |
| `test/scheduler/promoted-tier-fixture.ts` | 1 | 9 | aside 9 | 2 |
| `test/scheduler/quiet-clock.ts` | 2 | 49 | aside 39, timed 1, same 9 | 14 |
| `test/scheduler/retry-fixture.ts` | 2 | 41 | aside 32, same 9 | 6 |
| `test/scheduler/wall-fixture.ts` | 2 | 14 | same 14 | 1 |
| `test/scheduler/warm-up-repo.ts` | 1 | 6 | aside 5, same 1 | 2 |
| `test/shared/daemon-kit.ts` | 2 | 15 | aside 6, same 9 | 3 |

Note from row 011-368: `idle()` in a fixture hangs on a virtual clock with a wake armed. A fixture that moves to a virtual clock moves to the quiet point in the same change.

## Pilot

The 7 class-A files outside `test/scheduler/`, commit `2591da2be`. There are no more A files outside that folder, so the pilot is 7, not 10. Edit: `side.scheduler.idle()` → `side.rest()` (a catch-up side's own rest; it moves a virtual clock by 0 first and is the same on the host clock), and `loop.scheduler.idle()` → `loop.scheduler.rest()` in the daemon loop. Nothing else changed. `pnpm exec tsc --noEmit -p .` is clean.

| File | Calls | Round 1 (load) | Round 2 (load) | Round 3 (load) |
|---|---|---|---|---|
| `test/code/pass/daemon-loop.test.ts` | 1 site | 4.2 s (23.5 → 23.7) | 5.2 s (23.0 → 21.9) | 5.6 s (28.3 → 26.4) |
| `test/status/command-hold.test.ts` | 1 site | 5.7 s (23.7 → 23.8) | 7.6 s (21.9 → 24.3) | 5.0 s (26.4 → 25.3) |
| `test/delivery/hold-changes.test.ts` | 2 sites | 4.2 s (23.8 → 23.3) | 8.7 s (24.3 → 26.8) | 3.7 s (25.3 → 24.6) |
| `test/status/merge-hold.test.ts` | 2 sites | 4.0 s (23.3 → 23.6) | 6.4 s (26.8 → 29.4) | 4.8 s (24.6 → 24.9) |
| `test/cli/status-wait-focus-wide.test.ts` | 1 site | 3.4 s (23.6 → 22.7) | 6.4 s (29.4 → 29.8) | 6.8 s (24.9 → 25.6) |
| `test/cli/status-wait-focus-unqueued.test.ts` | 1 site | 2.9 s (22.7 → 22.0) | 6.6 s (29.8 → 29.4) | 5.4 s (25.6 → 25.9) |
| `test/cli/status-wait-group-readers.test.ts` | 1 site | 4.5 s (22.0 → 23.0) | 6.3 s (29.4 → 28.3) | 5.5 s (25.9 → 25.8) |

All 21 runs passed: one `vitest run` per file, `env -u PLUGIN_ROOT -u PLUGIN_DATA timeout 300 pnpm exec vitest run <file>`, 24 CPUs. The harness probe ran beside rounds 1 and 2. Sum of Vitest durations: 113 s. The work: the edit and typecheck took about 5 minutes and the 21 runs about 2 minutes. An A file is a one-line change plus its runs. A file's time does not change: at an A call, `idle()` and `rest()` end together.

## Proposed rows

Each row fits one worker in one sitting. Sizes come from the pilot (A), from the probe's per-file time (mean 6 s for a fake-runner file and 9.4 s for a harness file, so 3 runs of 30 files is about 10 to 15 minutes of runs), and from rows 011-363 (6 files) and 011-368 (8 files) for the virtual-clock moves (C). The rows cover 251 files; with the pilot's 7, that is all 258. The full lists follow.

| Row | Files | Needs | Work |
|---|---|---|---|
| A1 | 25 | wave 112 W1 landed (it edits `test/scheduler/`) | `x.scheduler.idle()` → `h.rest()` / `side.rest()` / `scheduler.rest()`; 3 of 3 per file |
| H | 16 fixtures, plus about 5 B files as its own pilot | — | The quiet point (below), and the 16 fixtures' own calls moved to it |
| B1 | 25 | H | Harness files outside `test/scheduler/` → the quiet point |
| B2–B4 | 29, 28, 29 | H | Harness files under `test/scheduler/` → the quiet point |
| B5, B6 | 31, 30 | H | Catch-up family files → `settle` or the quiet point |
| B7 | 20 | H | Other builders (`createScheduler` direct, `slots-fixture`, `preload-worktrees`, `forced-requeue-fixture`, `export-harness`, `crash-rekey-fixture`, the daemon loop): a quiet point per builder |
| C1, C2 | 8, 9 | H | Harness files: `clock: "virtual"`, the quiet point, and the clock moves each timed wake needs (as in 011-363 and 011-368) |
| C3, C4 | 8, 9 | H | Catch-up and other files: the same |
| D | — | all above | Drop `Scheduler.idle()` (`src/core/types/scheduler.ts:461`, `src/core/scheduler/scheduler.ts:883` and its `#idle` list) and `Pick<Scheduler, "idle">` in `drive-fixture.ts`; then `git grep -nE 'scheduler\??\.idle\('` finds nothing |

### Row H: the quiet point (a decision for the coordinator)

`idle()` is the Scheduler's "rest, and the runner's work ended" in one call. Without it, the test fixtures must supply the second half. Options:

1. **(Default)** A test-only quiet point in each scheduler builder. Wrap the `RunnerAdapter` handed to `createScheduler` in a counter of open calls (`run` and the runner-part calls: `affected`, `closure`, `environment`, `invalidate`, `testFiles`, `enumerate`). Then `quiet()` loops: `rest()`, and if no call is open and the runs mark is unchanged after one timer turn, it returns; otherwise it waits for the next call to end. Builders: `vitest-harness.ts` (its `schedulerRunner` wrapper already exists), `node-test-harness.ts`, `catch-up-fixture.ts` (then `settle` in `tier-yields-fixture.ts` reads the counter instead of `CatchUpRunner.runs`; `test/runner-host/remote/lane-setup.test.ts` replaces `runner.run` with a remote lane, and its run is invisible to `settle` today), and the other builders of row B7. No `src/` change.
2. A `rest()` option that also waits for runner work. This is a `src/` change and contradicts `GLOSSARY.md` "Rest" ("A test run that is still running does not end a rest").
3. Keep `idle()` as a test-only method. This defeats the row.

On a virtual clock, the quiet point does not move time, except for the `slot-gather` rule `settle` already has. A C file moves time itself.

### File lists

Calls are the probe's, with their classes. "via" names the fixtures whose calls the file reached.

A file marked "no call of its own" needs no edit: it is in the row whose class it has, so that the row runs it when its fixture's call moves. `group-lanes-fixture.ts` and `wall-fixture.ts` were `same` at every call, so row A1 can move them; row H moves the other 14 fixtures.

#### A1 (25 files)

- `test/scheduler/admission-runner-work.test.ts`: 2 calls (same 2); via group-lanes-fixture.ts
- `test/scheduler/backlog-wall.test.ts`: 18 calls (same 18); via wall-fixture.ts
- `test/scheduler/busy-hold.test.ts`: 2 calls (same 2)
- `test/scheduler/busy-requests.test.ts`: 1 call (same 1)
- `test/scheduler/claims-slow-slot.test.ts`: 1 call (same 1)
- `test/scheduler/fresh-worktree-durations.test.ts` (no call of its own): 2 calls (same 2); via drive-fixture.ts
- `test/scheduler/group-lanes-default.test.ts` (no call of its own): 3 calls (same 3); via group-lanes-fixture.ts
- `test/scheduler/group-lanes-integration.test.ts` (no call of its own): 7 calls (same 7); via group-lanes-fixture.ts
- `test/scheduler/group-lanes-limits.test.ts` (no call of its own): 7 calls (same 7); via group-lanes-fixture.ts
- `test/scheduler/group-lanes-moments.test.ts`: 4 calls (same 4); via group-lanes-fixture.ts
- `test/scheduler/group-lanes-width.test.ts`: 1 call (same 1)
- `test/scheduler/manual-groups.test.ts`: 9 calls (same 9); via group-lanes-fixture.ts
- `test/scheduler/narrow-run.test.ts`: 11 calls (same 11)
- `test/scheduler/rekeyed-wait.test.ts`: 1 call (same 1)
- `test/scheduler/resolved-wait.test.ts`: 1 call (same 1)
- `test/scheduler/runner-bound-retry.test.ts`: 3 calls (same 3)
- `test/scheduler/runtime-files-slow.test.ts` (no call of its own): 8 calls (same 8); via quiet-clock.ts
- `test/scheduler/slow-continuous.test.ts`: 4 calls (same 4)
- `test/scheduler/slow-nudge.test.ts`: 3 calls (same 3)
- `test/scheduler/slow-pool.test.ts`: 2 calls (same 2)
- `test/scheduler/slow-rank.test.ts`: 8 calls (same 8)
- `test/scheduler/slow-release-setup.test.ts`: 1 call (same 1)
- `test/scheduler/slow-request-join.test.ts`: 1 call (same 1)
- `test/scheduler/slow-request-load.test.ts`: 2 calls (same 2)
- `test/scheduler/sync-readers.test.ts`: 1 call (same 1)

#### B1 (25 files)

- `test/harness/stop-slow-scheduler.test.ts`: 4 calls (aside 2, same 2)
- `test/integration/fingerprint-two-worktrees.test.ts`: 2 calls (aside 2)
- `test/integration/optimizer-off.test.ts`: 15 calls (aside 12, same 3)
- `test/integration/project-config-stamps.test.ts`: 6 calls (aside 6)
- `test/integration/query-stamps.test.ts`: 6 calls (aside 6)
- `test/integration/slow-tier.test.ts`: 2 calls (same 1, aside 1)
- `test/integration/touched-caches.test.ts` (no call of its own): 8 calls (aside 8); via touched-repo.ts
- `test/integration/touched-in-flight.test.ts`: 5 calls (aside 5)
- `test/integration/touched-late.test.ts`: 6 calls (aside 4, same 2)
- `test/integration/touched-own-write.test.ts` (no call of its own): 4 calls (aside 4); via touched-repo.ts
- `test/integration/touched-restart.test.ts`: 6 calls (same 4, aside 2)
- `test/integration/touched-scope.test.ts`: 3 calls (aside 3)
- `test/integration/touched-stamped.test.ts`: 8 calls (aside 8); via touched-repo.ts
- `test/keys/install-inheritance.test.ts`: 8 calls (aside 7, same 1)
- `test/keys/install-refresh.test.ts`: 4 calls (same 3, aside 1)
- `test/keys/require-helper.test.ts`: 2 calls (aside 2)
- `test/runners/observe/absent-script.test.ts`: 2 calls (aside 2)
- `test/runners/pytest/spawned.test.ts`: 10 calls (aside 10)
- `test/runners/vitest/broken.test.ts`: 6 calls (aside 4, same 2)
- `test/runners/vitest/setup-failure.test.ts`: 6 calls (aside 6)
- `test/runners/vitest/setup-recovery.test.ts`: 4 calls (aside 4)
- `test/status/why-foreign-key.test.ts`: 2 calls (aside 2)
- `test/status/why-replaced.test.ts`: 3 calls (aside 2, same 1)
- `test/status/why-revert.test.ts`: 3 calls (aside 3)
- `test/store/prune-removed.test.ts`: 2 calls (aside 1, same 1)

#### B2 (29 files)

- `test/scheduler/admission-rewalk-lanes.test.ts`: 1 call (aside 1)
- `test/scheduler/admission-rewalk.test.ts`: 2 calls (aside 1, same 1)
- `test/scheduler/backlog-tiers.test.ts`: 8 calls (same 3, aside 5)
- `test/scheduler/backlog-wall-latency.test.ts`: 2 calls (aside 2)
- `test/scheduler/busy-merge.test.ts`: 8 calls (same 6, aside 2)
- `test/scheduler/busy-record.test.ts`: 5 calls (same 3, aside 2)
- `test/scheduler/busy-refinement.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/busy-released.test.ts`: 2 calls (aside 1, same 1)
- `test/scheduler/capacity-gate.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/checkpoint-lookup.test.ts`: 2 calls (aside 2)
- `test/scheduler/checkpoint-resume.test.ts`: 9 calls (aside 7, same 2)
- `test/scheduler/checkpoints.test.ts`: 13 calls (aside 7, same 6)
- `test/scheduler/declared-inputs.test.ts`: 8 calls (same 5, aside 3); via quiet-clock.ts
- `test/scheduler/discards.test.ts`: 6 calls (same 3, aside 3)
- `test/scheduler/environment-recheck.test.ts`: 9 calls (same 8, aside 1)
- `test/scheduler/error-causes.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/file-wall-time.test.ts`: 1 call (aside 1)
- `test/scheduler/first-commit-adoption.test.ts`: 4 calls (aside 2, same 2)
- `test/scheduler/first-observation.test.ts`: 10 calls (same 3, aside 7)
- `test/scheduler/flaky-inputs.test.ts` (no call of its own): 3 calls (aside 3); via quiet-clock.ts
- `test/scheduler/held-heal.test.ts`: 6 calls (aside 6)
- `test/scheduler/host-gate.test.ts`: 4 calls (aside 4)
- `test/scheduler/idle-lock.test.ts`: 4 calls (same 3, aside 1)
- `test/scheduler/idle-pass.test.ts`: 4 calls (aside 1, same 3)
- `test/scheduler/import-rewalk.test.ts`: 10 calls (aside 9, same 1)
- `test/scheduler/inherited-failure.test.ts`: 6 calls (aside 6)
- `test/scheduler/install-wait.test.ts`: 8 calls (same 5, aside 3)
- `test/scheduler/integration.test.ts`: 15 calls (aside 12, same 3)
- `test/scheduler/joined-retry.test.ts`: 10 calls (aside 6, same 4); via retry-fixture.ts

#### B3 (28 files)

- `test/scheduler/lanes.test.ts`: 6 calls (aside 6)
- `test/scheduler/later-discharge-wait.test.ts`: 19 calls (same 6, aside 13)
- `test/scheduler/list-again.test.ts`: 3 calls (same 1, aside 2)
- `test/scheduler/load-retry-bound.test.ts`: 10 calls (aside 7, same 3); via retry-fixture.ts
- `test/scheduler/loaded-modules.test.ts`: 5 calls (aside 5)
- `test/scheduler/moves-retention.test.ts`: 5 calls (same 3, aside 2)
- `test/scheduler/observed-inputs.test.ts`: 24 calls (aside 22, same 2)
- `test/scheduler/omitted-test-files.test.ts`: 4 calls (same 1, aside 3)
- `test/scheduler/ordering.test.ts`: 10 calls (same 2, aside 8); via quiet-clock.ts
- `test/scheduler/own-version.test.ts`: 4 calls (same 2, aside 2); via quiet-clock.ts
- `test/scheduler/policy-reload.test.ts`: 7 calls (same 3, aside 4); via quiet-clock.ts
- `test/scheduler/pytest-observed.test.ts`: 4 calls (aside 2, same 2)
- `test/scheduler/pytest-slots.test.ts`: 4 calls (aside 4)
- `test/scheduler/recursive-listing.test.ts`: 3 calls (aside 3)
- `test/scheduler/refinement-lock.test.ts`: 4 calls (same 2, aside 2)
- `test/scheduler/reinstall.test.ts`: 13 calls (same 10, aside 3)
- `test/scheduler/rekeyed-delivery.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/rekeyed.test.ts`: 8 calls (same 5, aside 3)
- `test/scheduler/replaced-failures.test.ts`: 5 calls (aside 4, same 1); via retry-fixture.ts
- `test/scheduler/request-progress-forced.test.ts`: 1 call (aside 1)
- `test/scheduler/request-progress-retry.test.ts`: 5 calls (aside 4, same 1); via retry-fixture.ts
- `test/scheduler/request-progress.test.ts`: 6 calls (aside 3, same 3)
- `test/scheduler/rerun-failure.test.ts`: 7 calls (aside 6, same 1)
- `test/scheduler/rerun-grown.test.ts`: 2 calls (aside 2)
- `test/scheduler/rerun-restart.test.ts`: 5 calls (aside 4, same 1)
- `test/scheduler/rerun-slow-teardown.test.ts`: 5 calls (aside 4, same 1)
- `test/scheduler/retry-delivery.test.ts`: 12 calls (aside 11, same 1); via retry-fixture.ts
- `test/scheduler/retry-no-result.test.ts`: 3 calls (aside 3)

#### B4 (29 files)

- `test/scheduler/retry.test.ts`: 19 calls (aside 15, same 4); via retry-fixture.ts
- `test/scheduler/revision-lag.test.ts`: 6 calls (aside 5, same 1)
- `test/scheduler/run-lanes.test.ts`: 7 calls (aside 5, same 2)
- `test/scheduler/runner-failure.test.ts`: 13 calls (aside 9, same 4)
- `test/scheduler/runner-part-bound.test.ts`: 3 calls (aside 2, same 1)
- `test/scheduler/runner-work.test.ts`: 7 calls (same 4, aside 3)
- `test/scheduler/runs.test.ts`: 14 calls (aside 13, same 1); via crash-rekey-fixture.ts
- `test/scheduler/runtime-files-lifecycle.test.ts`: 20 calls (aside 14, same 6); via quiet-clock.ts
- `test/scheduler/runtime-files-races.test.ts`: 6 calls (aside 6); via quiet-clock.ts
- `test/scheduler/runtime-files-rollback.test.ts`: 1 call (aside 1)
- `test/scheduler/runtime-files-shared-timer.test.ts`: 6 calls (aside 5, same 1); via quiet-clock.ts
- `test/scheduler/scratch-inputs.test.ts`: 24 calls (same 23, aside 1)
- `test/scheduler/slow-lane.test.ts`: 4 calls (aside 2, same 2)
- `test/scheduler/slow-off-line.test.ts`: 3 calls (same 1, aside 2)
- `test/scheduler/slow-parallel.test.ts`: 1 call (aside 1)
- `test/scheduler/step-install-refresh.test.ts`: 3 calls (same 2, aside 1)
- `test/scheduler/stored-affected-walk.test.ts`: 10 calls (same 3, aside 7)
- `test/scheduler/superseded-claim.test.ts`: 18 calls (same 3, aside 15)
- `test/scheduler/tier-ended-vitest.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/tier-holds.test.ts`: 2 calls (aside 2)
- `test/scheduler/tier-sharing.test.ts`: 2 calls (aside 2)
- `test/scheduler/tier-yields-vitest.test.ts`: 2 calls (aside 2)
- `test/scheduler/timed-out-tier.test.ts`: 2 calls (aside 2)
- `test/scheduler/touched.test.ts`: 13 calls (same 7, aside 6)
- `test/scheduler/unknown-run.test.ts`: 5 calls (aside 3, same 2)
- `test/scheduler/validity.test.ts`: 10 calls (aside 6, same 4)
- `test/scheduler/walk-freshness.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/withheld-retry.test.ts`: 9 calls (aside 8, same 1)
- `test/scheduler/withheld-touch.test.ts`: 7 calls (aside 5, same 2)

#### B5 (31 files)

- `test/cli/hold-wait.test.ts`: 13 calls (aside 6, same 7)
- `test/cli/import-rekey.test.ts`: 12 calls (aside 4, same 8)
- `test/cli/status-wait-ask-scheduler.test.ts`: 3 calls (aside 1, same 2)
- `test/cli/transfer.test.ts`: 10 calls (aside 6, same 4)
- `test/commit/stored-stall.test.ts`: 2 calls (aside 2)
- `test/delivery/hold-told.test.ts`: 6 calls (aside 1, same 5)
- `test/runner-host/remote/lane-setup.test.ts`: 1 call (aside 1)
- `test/scheduler/absent-paths.test.ts`: 5 calls (aside 3, same 2)
- `test/scheduler/adoption.test.ts`: 33 calls (same 23, aside 10)
- `test/scheduler/backlog-quiet-exempt.test.ts`: 6 calls (aside 1, same 5); via backlog-quiet-fixture.ts
- `test/scheduler/batch-beside.test.ts`: 8 calls (aside 8); via batch-fixture.ts
- `test/scheduler/catch-up-claims.test.ts`: 4 calls (aside 2, same 2)
- `test/scheduler/catch-up-classification.test.ts`: 19 calls (aside 17, same 2)
- `test/scheduler/catch-up.test.ts`: 8 calls (same 5, aside 3)
- `test/scheduler/check-runner.test.ts`: 5 calls (aside 3, same 2)
- `test/scheduler/claims-finished.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/claims-split.test.ts`: 5 calls (aside 5)
- `test/scheduler/command-hold-note.test.ts`: 1 call (aside 1)
- `test/scheduler/command-hold.test.ts`: 7 calls (same 5, aside 2)
- `test/scheduler/commit-lint.test.ts`: 28 calls (aside 7, same 21)
- `test/scheduler/commit-report.test.ts`: 29 calls (aside 28, same 1)
- `test/scheduler/edit-cut-new-source.test.ts` (no call of its own): 6 calls (aside 6); via edit-cut-fixture.ts, quiet-clock.ts
- `test/scheduler/edit-cut-readers.test.ts`: 3 calls (aside 3); via quiet-clock.ts
- `test/scheduler/edit-cut.test.ts` (no call of its own): 16 calls (aside 16); via edit-cut-fixture.ts, quiet-clock.ts
- `test/scheduler/focused-outcomes.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/formats-read-as-one.test.ts`: 3 calls (aside 1, same 2)
- `test/scheduler/handover-queued.test.ts`: 15 calls (aside 10, same 5)
- `test/scheduler/held-confirm.test.ts`: 9 calls (same 4, aside 5)
- `test/scheduler/ignored-listing.test.ts`: 20 calls (aside 9, same 11)
- `test/scheduler/listed-before-recheck-handover.test.ts`: 5 calls (aside 5)
- `test/scheduler/listed-before-recheck-restart.test.ts`: 10 calls (aside 8, same 2)

#### B6 (30 files)

- `test/scheduler/listed-before-recheck.test.ts`: 11 calls (aside 11)
- `test/scheduler/manual-lint.test.ts`: 4 calls (aside 1, same 3)
- `test/scheduler/merge-hold-heal.test.ts`: 6 calls (aside 4, same 2)
- `test/scheduler/merge-hold-operations.test.ts`: 10 calls (aside 5, same 5)
- `test/scheduler/merge-hold-setup.test.ts`: 8 calls (same 7, aside 1)
- `test/scheduler/merge-hold.test.ts`: 9 calls (same 6, aside 3)
- `test/scheduler/model-harness-clock.test.ts`: 1 call (aside 1)
- `test/scheduler/observed-direct.test.ts`: 17 calls (aside 14, same 3); via quiet-clock.ts
- `test/scheduler/one-write-path.test.ts`: 23 calls (aside 19, same 4)
- `test/scheduler/promoted-tier-expiry.test.ts`: 8 calls (aside 8); via promoted-tier-fixture.ts
- `test/scheduler/promotion-cut.test.ts`: 9 calls (aside 9)
- `test/scheduler/promotions-published.test.ts`: 1 call (aside 1)
- `test/scheduler/remote-lost.test.ts`: 1 call (aside 1)
- `test/scheduler/remote-permits.test.ts`: 1 call (aside 1)
- `test/scheduler/rest-resume.test.ts`: 8 calls (aside 7, same 1)
- `test/scheduler/runtime-gone-tier.test.ts`: 5 calls (aside 2, same 3)
- `test/scheduler/scheduler-rest.test.ts`: 4 calls (aside 4)
- `test/scheduler/stopping-crash.test.ts`: 9 calls (aside 5, same 4)
- `test/scheduler/tier-file-end.test.ts`: 8 calls (aside 8)
- `test/scheduler/tier-yields-clock.test.ts`: 3 calls (aside 3)
- `test/scheduler/tier-yields-ended-count.test.ts`: 2 calls (aside 2)
- `test/scheduler/tier-yields-ended.test.ts`: 4 calls (aside 4)
- `test/scheduler/tier-yields-first-tier.test.ts`: 2 calls (aside 2)
- `test/scheduler/tier-yields-named.test.ts`: 21 calls (aside 20, same 1)
- `test/scheduler/tier-yields-next-tier.test.ts`: 8 calls (aside 8)
- `test/shared/import-busy.test.ts`: 3 calls (aside 1, same 2); via daemon-kit.ts
- `test/shared/import-each-worktree.test.ts`: 12 calls (aside 4, same 8); via daemon-kit.ts
- `test/shared/import-rekey.test.ts`: 6 calls (aside 2, same 4); via daemon-kit.ts
- `test/status/retry-holds-live.test.ts`: 2 calls (aside 1, same 1)
- `test/store/transfer.test.ts`: 15 calls (aside 11, same 4)

#### B7 (20 files)

- `test/ci/export-loaded.test.ts` (no call of its own): 2 calls (aside 2); via export-harness.ts
- `test/ci/export.test.ts` (no call of its own): 1 call (aside 1); via export-harness.ts
- `test/runners/pytest/adapter-skip.test.ts`: 5 calls (aside 4, same 1)
- `test/scheduler/background-runs.test.ts`: 2 calls (aside 2); via batch-fixture.ts
- `test/scheduler/backlog-slots-overhead.test.ts`: 5 calls (same 1, aside 4)
- `test/scheduler/crash-cancel.test.ts` (no call of its own): 3 calls (aside 2, same 1); via crash-rekey-fixture.ts
- `test/scheduler/daemon-loop.test.ts`: 3 calls (aside 2, same 1)
- `test/scheduler/environment-growth-same-revision.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/environment-growth-siblings.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/environment-growth.test.ts`: 4 calls (aside 4)
- `test/scheduler/feed-delivered.test.ts`: 1 call (aside 1)
- `test/scheduler/forced-requeue.test.ts`: 6 calls (aside 5, same 1); via forced-requeue-fixture.ts
- `test/scheduler/full-suite-pass.test.ts`: 9 calls (aside 9)
- `test/scheduler/ignored-observed.test.ts`: 2 calls (aside 1, same 1)
- `test/scheduler/linked-start.test.ts`: 3 calls (same 2, aside 1)
- `test/scheduler/observed-growth.test.ts`: 14 calls (aside 11, same 3)
- `test/scheduler/preload-heal.test.ts`: 2 calls (aside 2)
- `test/scheduler/preload-refresh.test.ts`: 2 calls (same 1, aside 1)
- `test/scheduler/slots-backlog-turn.test.ts`: 1 call (aside 1)
- `test/scheduler/strict-lookup.test.ts`: 6 calls (aside 6); via forced-requeue-fixture.ts

#### C1 (8 files)

- `test/scheduler/backlog-cancel.test.ts`: 4 calls (aside 3, timed 1)
- `test/scheduler/backlog-quiet-vitest.test.ts`: 2 calls (aside 1, timed 1)
- `test/scheduler/backlog.test.ts`: 2 calls (aside 1, timed 1)
- `test/scheduler/busy-withhold.test.ts`: 9 calls (aside 4, timed 2, same 3)
- `test/scheduler/capacity-pool.test.ts` (no call of its own): 3 calls (timed 2, aside 1); via drive-fixture.ts
- `test/scheduler/edit-beside-backlog.test.ts`: 4 calls (aside 3, timed 1)
- `test/scheduler/focused-vitest.test.ts`: 4 calls (aside 2, timed 2)
- `test/scheduler/in-use.test.ts`: 5 calls (aside 4, timed 1)

#### C2 (9 files)

- `test/scheduler/rekeyed-duration.test.ts`: 5 calls (same 2, timed 3)
- `test/scheduler/slow-activity.test.ts`: 5 calls (timed 3, aside 2)
- `test/scheduler/slow-backlog.test.ts`: 6 calls (same 4, timed 1, aside 1)
- `test/scheduler/slow-node-test.test.ts`: 5 calls (aside 4, timed 1)
- `test/scheduler/slow-tier.test.ts`: 11 calls (aside 4, timed 1, same 6)
- `test/scheduler/slow-width.test.ts`: 1 call (timed 1)
- `test/scheduler/warm-up-in-flight.test.ts`: 10 calls (aside 4, timed 4, same 2); via warm-up-repo.ts
- `test/scheduler/warm-up.test.ts`: 11 calls (aside 5, timed 5, same 1); via warm-up-repo.ts
- `test/scheduler/model-scheduler.test.ts` (no call of its own): 138 calls (same 128, timed 10); via model-fixture.ts

#### C3 (8 files)

- `test/scheduler/catch-up-cancel.test.ts`: 4 calls (same 2, timed 1, aside 1)
- `test/scheduler/catch-up-order.test.ts`: 12 calls (same 4, aside 7, timed 1)
- `test/scheduler/catch-up-turn.test.ts`: 6 calls (same 2, aside 3, timed 1)
- `test/scheduler/claims-expiry.test.ts`: 5 calls (timed 4, same 1)
- `test/scheduler/claims.test.ts`: 10 calls (aside 7, same 2, timed 1)
- `test/scheduler/commit-group-after.test.ts`: 16 calls (same 14, timed 2)
- `test/scheduler/commit-groups.test.ts`: 22 calls (same 17, timed 5)
- `test/scheduler/edit-cut-route.test.ts`: 14 calls (aside 10, timed 3, same 1); via edit-cut-fixture.ts, quiet-clock.ts

#### C4 (9 files)

- `test/scheduler/focused-turn.test.ts`: 12 calls (aside 9, same 2, timed 1)
- `test/scheduler/focused.test.ts`: 11 calls (aside 8, timed 2, same 1)
- `test/scheduler/merge-hold-records.test.ts`: 20 calls (aside 5, same 14, timed 1)
- `test/scheduler/named-wait-settled.test.ts`: 10 calls (aside 5, timed 3, same 2)
- `test/scheduler/promoted-tier.test.ts`: 10 calls (aside 8, timed 2); via promoted-tier-fixture.ts
- `test/scheduler/promotion.test.ts`: 5 calls (aside 3, same 1, timed 1)
- `test/scheduler/tier-yields-text.test.ts`: 4 calls (aside 3, timed 1)
- `test/scheduler/tier-yields.test.ts`: 8 calls (aside 6, same 1, timed 1)
- `test/scheduler/backlog-slots.test.ts`: 3 calls (same 1, aside 1, timed 1)

## Appendix: the probe

`test/probe-idle.ts` in the private worktree. A Node script rewrote each `<receiver>scheduler.idle()` (and bare `scheduler.idle()`) to `probeIdle(<receiver>scheduler, "<file>:<line>")` and added the import. A sweep row can reuse it to check that its new wait ends where `idle()` did.

```ts
// Row 011-371 survey probe: what `rest()` gives at each `scheduler.idle()` call site.
import { appendFileSync } from "node:fs";
import { expect } from "vitest";

interface Probed {
  idle(): Promise<void>;
  rest(): Promise<{ next: { reason: string; at: number } | null; wakes: readonly { reason: string; at: number }[] }>;
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function probeIdle(scheduler: Probed | null | undefined, site: string): Promise<void> {
  if (scheduler == null) return;
  const t0 = performance.now();
  let row: Record<string, unknown>;
  try {
    let timer: NodeJS.Timeout | undefined;
    const rest = await Promise.race([
      scheduler.rest(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 15_000);
      }),
    ]);
    clearTimeout(timer);
    const restMs = performance.now() - t0;
    let done = false;
    const idle = scheduler.idle().then(() => {
      done = true;
    });
    for (let i = 0; i < 3 && !done; i++) await turn();
    const immediate = done;
    const t1 = performance.now();
    await idle;
    row = {
      hang: rest === null,
      immediate,
      restMs: Math.round(restMs),
      idleAfterMs: Math.round(performance.now() - t1),
      next: rest?.next ? { reason: rest.next.reason, inMs: Math.round(rest.next.at - Date.now()) } : null,
      wakes: rest?.wakes.map((w) => w.reason) ?? [],
    };
  } catch (error) {
    row = { error: String(error) };
    await scheduler.idle();
  }
  const testPath = expect.getState().testPath ?? "?";
  const test = expect.getState().currentTestName ?? "?";
  appendFileSync(process.env.PROBE_LOG ?? "/dev/null", `${JSON.stringify({ site, testPath, test, ...row })}\n`);
}
```
