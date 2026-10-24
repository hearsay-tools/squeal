# R2 notes: repair of review 0.1.293 B1 to B3 and S1

Worker fa075c16, 2026-10-24. From `int/015c-r1` at df8f7a079 (013-07 and 015-18 on main, without the 0.1.293 build commit). Brief: `tasks/wave-1c.md`, "R2: repair of review 0.1.293". No bundle was built and the version was not raised.

## The repairs

| Item | Seam | Regression |
|---|---|---|
| B1 | `FailedCount.quiet` and `failedAgain` in `src/core/code/pass/failed.ts`; `seeds` in `runPass` (`pass.ts`); `quiet(check)` in `judge.ts` | `test/code/pass/retry-quiet.test.ts` |
| B2 | `nextWake` and the `loop` in `createCodePass` (`src/core/code/pass/index.ts`) | two tests in `test/code/pass/retry-daemon.test.ts` |
| B3 | `pythonParserReady` and `loadPythonParser` in `src/runners/pytest/graph/parse.ts`; the doc of `counterReady` in `src/core/code/count/parser.ts` | `test/code/count/ready-runtime.test.ts`, `ready-python.test.ts`, `ready.test.ts` |
| S1 | `codeStatusLines` in `src/core/status/code-status.ts` | one test in `test/code/delivery/uncountable.test.ts` |

Every new test failed before its fix and passes after it. For B1 I also removed only the `quiet` flag from `runPass`'s `after` list: the three quiet-seed tests failed again, and the two control tests stayed green.

## The rules as built

- **B1, the origin.** A failed count's record has `quiet: true` when the pass that failed was a first count or a policy recount (`reason !== null`). `failedAgain` keeps the origin of the first failure while the blob stays the same. A new blob takes the origin of the pass that fails on it. `restartRetries` keeps it, as it spreads the record.
- **B1, the seed.** After `countMissing`, and before the judged paths lose their records, `runPass` marks each `count` entry whose record has `quiet` at the entry's blob. This covers a retry and also a count that another worktree stored (adoption): both still have their record at that point. `judge` handles a marked path as a quiet pass does. It makes no move to or from it, no transition, no `removed`, and no edit. Other paths in the same pass get normal transitions.
- **B1, delivery.** Delivery and `wentOverSince` read transitions only. With none recorded, the delivery planner writes the failing function into the view by count, and Stop's `complexity.blocking` check does not count it. The states take the pass's revision for `countedAt` and `changedAt`, as a first count's do.
- **B2.** `loop` calls `retryLater(nextWake())` after every pass, also after one that threw. `nextWake` returns the earliest `retryAt`. After `aborted` passes in a row that threw, it returns no time before `now + RETRY_AFTER_MS[min(aborted, 2) - 1]`: 5 s after the first, then 60 s. A pass that succeeds sets `aborted` back to 0. With no store open (policy off) or no record, no timer is set. An error from the meta read itself goes to `onError`.
- **B2, the budget.** Attempts move only in `fail`, after `countOne` called the counter. A pass that throws before `countMissing` leaves the record unchanged. The test holds a real `BEGIN IMMEDIATE` on `code.sqlite`, so the pass's first write fails after the 1 s busy timeout.
- **B3.** `pythonParserReady` returns at once when the parser is made. Otherwise it starts `loadPythonParser`, or shares the load already running, and a `.finally` clears that load when it settles. So the next call after a failure loads again. `runtimeReady` is set after a `Parser.init` that succeeded, and the next load then skips `Parser.init`. So only the stage that failed is made again. `counterReady` already reset its own promise, and it awaits `pythonParserReady` again, which returns at once when that loaded.
- **B3 and the key-format alarm.** `parse.ts` is on the pytest component's validity path, so `test/keys/key-format.test.ts` requires each changed line to run in a validity case. My first fix used `.catch` handlers that reset the promises. They run only when a load fails, no case makes a load fail, and the alarm named their six lines. The rewrite above has no line that runs only on failure: the `.finally` and the `runtimeReady` lines also run on a load that succeeds, which every pytest case makes. The alarm then passed with no version raise. The keys and outputs are unchanged on the success path.
- **S1.** The early return for "counting with none over" now ends with the uncountable suffix: `Complexity: counting, 1 of 2 files; 1 file could not be counted.`

## Decisions the spec did not settle

- **The field name.** The brief says to "record the origin". I stored only what the judge needs, as `quiet?: true`, and not the recount reason. It is absent for an edit's count. So the 015-18 records (`toEqual` in `retry.test.ts`) and any record written before this change read as an edit's.
- **The backoff.** I used `RETRY_AFTER_MS` (5 s, then 60 s) for the wait after a pass that threw. I did not add a second constant. The wait does not stop after three passes. A lock that stays costs one pass per minute. Each such pass blocks for up to the 1 s busy timeout.
- **The suffix.** S1 adds only the uncountable suffix to the early return. The parse-error suffix stays out of it, as before.

## Type changes

All additive except one internal signature:

- `FailedCount.quiet?: true` (`src/core/code/pass/failed.ts`).
- `FileAfter.quiet?: boolean` (`src/core/code/pass/judge.ts`).
- `failedAgain(previous, blob, error, { now, quiet })`: the last parameter was `now: EpochMs`. Its only caller is `fail` in `blobs.ts`.
- `countMissing(ctx, entries, failed, attempt: Attempt)`: the last parameter was `now: EpochMs`. `Attempt` is `{ now, quiet }` and is exported from `blobs.ts`. Its only caller is `runPass`.
- New export `seedsQuietly` from `failed.ts`.

## Residue for the next worker

- **A recount that holds an edit's failure.** A record from an edit pass whose retry is not due yet is held by a policy recount. It keeps no `quiet`. Its later retry compares the new count with states judged at the old threshold, so a crossing that only the threshold made is told as a transition. The other choice would hide the edit's own crossing. I kept the record's origin as it was.
- **An attempt with no record.** If the counter ran and then the slice's write transaction is locked, nothing records the attempt. The next pass calls the counter again. The budget never moves without an attempt. But under a lock that stays, the counter can run more than three times, one pass per minute.
- **A partial `Parser.init`.** web-tree-sitter sets its module only when the binding loads. If `_ts_init` threw after that, `runtimeReady` stays false, and the next `Parser.init` reuses the module and calls `_ts_init` again. I did not reproduce that case.
- **One process per test file.** The three B3 tests are three files because web-tree-sitter's runtime lives for the whole process. Each test spies on `Parser.init` and `Language.load`.
