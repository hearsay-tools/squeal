# W1 of wave 8: 013-03, 011-54, 011-56, worker notes (2026-10-21)

Brief W1 of `../wave-8.md`. Base `f5ae8567`. Commits in row order: `143adbca` (013-03), `52155bd3`, `6dbeb79b` and `f75494b8` (011-54), `3eccb80d` and `882a83e4` (011-56; the second is `daemon.ts` alone, so it can be redone on cand/0.1.238's version). The coordinator agreed every file outside the brief's ownership on 2026-10-21; each commit names it.

## 013-03: what the probe found

The lead was to stamp each module's start and end and compare with the diagnostic sum. On five probe files (a slow `beforeAll` with concurrent tests, a slow top-level `await`, a busy synchronous import, fake timers with `performance` faked, a slow `afterAll`), `moduleDuration`'s sum was within 1% of `onTestModuleQueued` to `onTestModuleEnd`. Vitest's file `result.duration` runs from before `beforeAll` to after `afterAll` and the file's fixture cleanup, and `collectDuration` holds the import. The sum does not understate.

Issue 62's 3.5 s was the file-level check's value: `recordsForFile` stored `max(0, fileMs − sum of test cases)` on it (review wave 4.5, N1), and 112.3 − 108.8 = 3.5. The fix is in `src/core/scheduler/records.ts` and `files.ts`, not the reporter; the coordinator dropped the reporter change (queued-to-end would count pool waits).

- The file-level check, pass and fail, every runner, records the whole file (`fileDurations`); none keeps 0.
- `durationOf` is `max(file-level check, sum of the tests)`: one count of the file, and a result an older daemon stored (the remainder) reads at least its tests' sum. It is the only per-file sum: `bootstrap.ts`, `ledger.ts`, `cli/warmup.ts` call it; `status/durations.ts`, `failures.ts`, `format-why.ts` show one check's values and needed no change.
- `test/keys/validity/cases/rows/golden.ts` still names its case "the time outside the tests"; the duration is wording there, so the alarm agrees. Its name and `why` are for the coordinator to reword.

## 011-54: seam map

- `src/core/types/runner.ts`: `RunOptions.fileEnded?(testFile)`. A runner calls it for each file whose module ended in a final state before any cancel. It stores nothing.
- `src/runners/vitest/reporter.ts`: `RunCollector`'s third constructor parameter `ended`, called from `moduleEnd` through `#tell`; `endedInTime(module)` is the one predicate, shared with `buildReport`'s `completedFiles`. `adapter.ts` passes `options.fileEnded`.
- `src/core/scheduler/tiers.ts`: `Tier.ended?: Set<string>` (file ids; `startTier` sets it); `executeTier`'s fifth parameter `onFileEnd`, called after the id is added.
- `src/core/scheduler/scheduler.ts`: `#fileEnded(tier)`. When the tier has changes (`Tier.changes`), it queues one `#cutTiers(null)` under the lock (`#endCheck` keeps it to one queued at a time). Errors go to `#backgroundError`.
- `src/core/scheduler/yields.ts`: `unfinished(tier)`. `superseded`, `remainder`, the new cut marks and the "a marked file" check read only it. A tier whose files have all ended is never superseded.
- The composite runner and `escaped.ts` spread the options, so `fileEnded` passes through. node:test and pytest never call it, and every file of theirs stays unfinished.

## 011-56: seam map

- `CancelCause` (`src/core/types/runner.ts`) is the `reason` of `RunOptions.signal`. `TierYields` aborts with `supersession`, `backlog` or `yield`. `Scheduler.close` aborts `#stop` with `SchedulerCloseOptions.cause`. `daemon.ts` passes `stop` from `onStop` and `step-down` from `onStepDown`.
- `src/runners/vitest/run.ts`: `CANCELLED` is now `"run cancelled"`; `cancelled(reason)` adds `: <cause>`, and gives `CANCELLED` alone for a reason it does not know. `execute` uses it for the report's failure, which is the run log's header line. It also writes a `squeal: run cancelled: …` note into the run log at the cancel.

## Decisions the spec did not settle

1. A yield marks only the unfinished files, and a tier yields unless one of its *unfinished* files is marked: an ended file's result lands, so cutting the tier no longer cuts it.
2. A file's end triggers a check only after a revision changed an input of its tier. With no changes, an end can only lower the remainder, so no new cancel can follow.
3. `cancelsBacklog` (`backlog.ts`, not in W1) is unchanged. A revision that changes only an ended file's input still cancels a backlog tier. That file's result is discarded by the stability check anyway, but the unfinished files' work goes too. This could be a later row.
4. The cause texts are: supersession "the revisions during it changed an input of every file that had not ended"; backlog "an edit arrived during a backlog tier" (the old text); yield "it yielded to an edit's work, a promoted file or a runner part waiting for it"; stop "squeal stop"; step-down "the daemon stepped down for newer hooks".
5. `fileEnded` throws: Vitest catches a reporter hook's throw as an "Unhandled Reporter Error". It reaches `onTestRunEnd` with no test file, and `buildReport` then ends the run `crashed` and stores nothing (reproduced: `file-ended.test.ts`, red before the guard). `#tell` catches the throw, writes `squeal: fileEnded of <file> threw: <error>` in the run log, and the run completes with its results. The scheduler's callback does not throw. `52155bd3` had no guard, since the alarm flagged its lines; `6dbeb79b` adds it back, with the validity case that runs it.

## Facts found on the way

- The key-format alarm requires every changed line of the Vitest bundle to run in an `adapter:vitest` case, and no case cancelled a run or passed `fileEnded`. `test/keys/validity/case.ts` now has `cancel` and `fileEndedThrows` on a run, and `harness/vitest.ts` applies them. `cases/adapter/vitest.ts` has one case for each. The compared outputs did not change: the failure text is wording. `adapters.test.ts` pins which cases differ when a skip reads as a pass, so the new cases run only files with no skipped test (`f75494b8`).
- One edit's tier takes two files only within `SHARE_RATIO` (4) of each other. A test that wants one tier of 100 s and 20 s files gets two tiers.
- `tier-ended-files.test.ts` wraps `CatchUpRunner.run` to report ends, so `catch-up-fixture.ts` is unchanged.

## Changed existing tests

- `test/scheduler/records.test.ts`, "puts the module's time outside its tests…": renamed, 300 → 305 (013-03).
- `backlog-cancel.test.ts`, `backlog-tiers.test.ts`: `toBe(CANCELLED)` → `toBe(cancelled("backlog"))`. `revision-lag.test.ts`: `toContain(CANCELLED)` → `cancelled("supersession")`. `tier-yields-vitest.test.ts`: → `cancelled("yield")` (011-56: each pins its cause). `run.test.ts`'s abort with no reason still reads `CANCELLED`, the neutral text.
- `test/daemon/stop-cancel.test.ts` and `step-down-lanes.test.ts` each gain one assertion: the cancelled Vitest run's report names the cause.
- No node:test or pytest test's expected duration moved.

## Open for later rows

- Spec text: 011 C4 step 5 and C15 "unfinished files", and the N1 sentence on the file-level check's duration (coordinator, at landing).
- `cancelsBacklog` over ended files (decision 3).
- The status side's `remainder` figure now reads only the unfinished files (W2 owns its text).
