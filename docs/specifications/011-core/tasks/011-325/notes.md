# Row 011-325 notes: the intake records each request's covered files

Worker 2498379c, 2026-11-13. Brief: `tasks/wave-81.md`, W2. Design: `research/request-intake.md`, "Covered files (011-325)", with card 3's five conditions. Rebased on `origin/main` at `371cc8f8c`.

## For card 3 (row 011-328): what to read

- **The reader:** `readCoveredFiles(store, id): CoveredFiles | null` in `src/core/store/covered-files.ts`. `null` when the store holds no record under the id (an older daemon wrote none, or it was pruned) or the store was not opened by `openStore`/`createStore`. It works on a read-only store the CLI opens (`createStore(new Connection(openReadOnly(...)))`): it checks that the table exists before it reads.
- **The record:** `CoveredFiles { id, worktreeId, revision, recordedAt, files }`; each of `files` is a `CoveredFile`: `{ testFile, state: "queued" }`, `{ testFile, state: "current" }` or `{ testFile, state: "not-queued", reason }`. The revision is the worktree's when the scheduler took the request.
- **The three answer paths that carry the id** (one optional field each, set once the scheduler took the request):
  - `run-all`: `RunAllResponse.coveredId`, beside `owner`, never inside `checkpoint` (`checkpoint` stays a `CheckpointRecord`).
  - `run-slow`: `RunSlowResponse.requested.coveredId`.
  - `run-group` (also a narrow run, `run-group-paths`): `RunGroupResponse.requested.coveredId`. `requested` is the new named type `RequestTaken`.
- **No id** in the answer: a daemon before this row, or a lint group (it covers no test file; the release answers before any record). Then the wait keeps today's guess (condition 4).
- A narrow run's not-queued files and their reasons in the record are the same words as its answer's `narrow.notRun`: both come from `coveredOf` (`src/core/scheduler/covered-files.ts`).

## How the five conditions hold

1. **One transaction.** `RequestIntake.#stage` calls `recordCovered` inside `#transact`, after the stage returned and before the commit; the progress record (`host.record`) follows the commit, as the review of 0.1.470 asked. Test: "is written in the transaction that queues the files: one it cannot write queues none" (a record that fails rolls the queued file back).
2. **One reader under `src/core`:** `readCoveredFiles`, above. No CLI file reads the table.
3. **Kept while any of its files is queued or running, and 10 minutes after.** At each new record's write, in the same transaction, the worktree's older records are pruned: one whose files the ledger shows neither queued nor running gets `idle_since = now` once; one idle for `COVERED_FILES_KEPT_MS` (10 minutes) is deleted. "Any of its files" is literal: any file of the record, whatever its decided state. `idle_since` is set once and never cleared, so a file queued again later by an edit does not keep the record (that run is not the request's, as `RequestProgress` judges). The 10 minutes count from the first write that found the record idle, so a record can live longer than 10 minutes after its last end, never shorter. Test: "is pruned only once none of its files is queued or running and 10 minutes passed".
4. **An answer without the id keeps the guess.** Today's CLI ignores the field: `test/cli/covered-id-ignored.test.ts` (`run --all --wait`, `run --slow`, `run tests` print and exit the same with and without it).
5. **Survives a daemon handoff.** The record is in the store. Test: "survives a daemon handoff: the next daemon reads it, and keeps it while a file is queued" (a second store connection and a new ledger over the same store read it, and their write 20 minutes later keeps it while `B` is queued).

## The store table (no schema step)

`request_covered_files` (`id` primary key, `worktree_id`, `revision`, `recorded_at`, `idle_since`, `files` as JSON) and an index on `(worktree_id, idle_since)`. An additive table made by the first write, inside that write's transaction, with **no `user_version` raise**, the pattern of `IMPORT_TABLES` and `ENVIRONMENT_TABLES`:

- an older daemon sharing the store opens it as before (a raise makes it refuse the store, `newer-schema`) and never reads the table;
- it lives outside `schema.ts`, which the key-format alarm bundles; no key reads it;
- `test/store/table-columns.test.ts` lists the tables made at open only, so it needs no line.

A rule for later rows: spec 011 C7 forbids adding a column to this table under an unchanged `user_version`; a new field needs a new table or a raise.

## The decided states

`coveredOf(file, waiting)` reads the ledger after the stage, inside the transaction: `current` when a result stands at its key; `queued` when it is queued or running and no install wait applies; else `not-queued` with the reason: the install wait's reason, else "its runner failed: <first line>", "Squeal cannot key it", or "it has no result at its key and was not queued". This was the narrow run's private `notRunOf`; it moved to `covered-files.ts`, and `notRunOf` reads it, so the answer and the record cannot drift.

## Requests, covered files, as the table shows them (`test/scheduler/request-covered.test.ts`)

| Request | Covered files | Row |
|---|---|---|
| `run <group>` | the group's files, each queued, current or not queued with the reason | "run <group>: the group's files ..." |
| `run --slow` | the slow group's files only | "run --slow: the slow group's files only" |
| `run <group> <path>` | its selection of the group; the not-queued ones as its answer's `notRun` | "run <group> <path>: its selection ..." |
| `retry` | the files it claimed, queued; its answer carries no id | "retry: the files it claimed, queued" |
| `run --all` | its checkpoint's files and the lane's files already current | "run --all: its checkpoint's files and its files already current" |
| `run --all --fast` joined to a baseline | its own lane's files only, never the baseline's slow ones (wave 3.6 B1) | "run --all --fast joined to a baseline ..." |
| install wait (`run --all` reinstalled, `run <group>` and `run <group> <path>` awaiting an install) | every non-current file not queued, with the reason; current ones current; no progress record | "the install wait" rows |

Not recorded: promote and focus (`covers: { skip }`, they queue no file), an import's refresh (`NowRequest`, W1's), a lint group's release (`store.outside`), a `retry` answered at once while an install is awaited (`atOnce`, no lock, no write), a stage that throws, and a `null` plan answer (a narrow run's unknown group).

## Decisions the design did not settle, and my choice

1. **The id is the intake's**: one `randomUUID()` per request at the start of `#locked`, the same on each busy try, passed to the stage and the install-wait answer as a last argument (`RequestId`); each declaration puts it in its answer as `coveredId`. Not the daemon's socket `requestId` (the scheduler never sees it) and not the checkpoint id (only `run --all` has one).
2. **`run --all` adds what its checkpoint lacks**: its covered files are the checkpoint's `testFiles` plus the lane's listed files already current. Those are current, so their phase is `null` and the progress record (`RequestProgress.ask` keeps queued or running ones only) is unchanged.
3. **`run --all` while waiting** records its lane's files (all listed files without `--fast`/`--slow`), not the abandoned checkpoint's (every listed file, whatever the lane): the request's own files, as in the joined case.
4. **The install-wait answers record too** (`InstallWaitRule.stage` and `.answer` return `Staged<A>`). The narrow run's install-wait answer wrote nothing before; it now writes its record in one busy-retried transaction under the lock it already holds. Its answer is unchanged; on a busy store it now waits for the store like any request.
5. **Every taken stage writes a record**, also one with no files (an unknown group, a `retry` that claimed nothing): the rule stays one line in the intake, and such a record is idle at once and pruned 10 minutes later.
6. **The prune reads the ledger** (`ledger.file(ref)?.phase`), not the store's `test_file_keys.pending`, through a predicate `writeCoveredFiles` takes, so the store module stays free of the scheduler.
7. **The run-all id beside `owner`** needed a two-line edit of the bridge file `handlers.ts` (`runAll`): agreed with the coordinator, request `e0083705`, option A, in its own commit.
8. **The probe moved** from `request-intake.test.ts` to `test/scheduler/request-intake-probe.ts`, shared by the intake's table and the covered-files table, which keeps both test files near 300 lines. Its `record` now also feeds the real `RequestProgress` (the ledger's `ends`), and its clock is `state.now`, fixed unless a row moves it.

## Review 0.1.470 S1, folded in

The intake fixture uses the real `RequestProgress` (and keeps a log line per record for the order rows). Two rows replay the deleted end-count scenarios with the real declarations:

- "records the real group request's files: a running one counts once it ended" (was `request-progress.test.ts:98`): `B` running when `run tests` is taken; its end counts 1; `A`, not queued, counts nothing.
- "records the real run --all request's files: a slow one counts once it ended" (was `request-progress.test.ts:111`): `B` slow and queued; its end under the checkpoint counts 1.

## Type changes

All additive except the intake's own declaration types:

- New `src/core/store/covered-files.ts`: `CoveredFile`, `CoveredFiles`, `COVERED_FILES_TABLE`, `COVERED_FILES_KEPT_MS`, `writeCoveredFiles`, `readCoveredFiles`.
- New `src/core/scheduler/covered-files.ts`: `coveredOf`, `recordCovered`.
- `request-intake-types.ts`: new `RequestId`; `StageRule.stage` takes a fourth argument `id`; `InstallWaitRule`'s `stage` takes `id` and returns `Staged<A>` (was `A`), its `answer` takes `id` last and returns `Staged<A>` (was `A`). `Staged`'s doc now says the covered files include current and not-queued ones.
- `types/scheduler.ts`: `FullSuiteCheckpoint.coveredId?` and `SlowSuiteRequest.coveredId?` (so `NarrowRunRequest` too).
- `types/daemon.ts`: `RunAllResponse.coveredId?`; new `RequestTaken { revision, queued, coveredId? }`, now the type of `RunSlowResponse.requested` and `RunGroupResponse.requested` (the same shape as before plus the optional field; `SlowSuiteRequested` follows).

## For W1 (row 011-323) and the coordinator

- `request-intake.ts`: `#locked` makes the id; `#perTry(request, store, id)` and `#stage(request, store, plan, id, reason, recovered, deferWhenPending)` take it. `#now`, `take`'s first overload, `WakeRule` and `#wake` are untouched.
- `retries.ts`: only `retryRequest`'s doc comment changed; its `wake` is W1's.
- `test/scheduler/request-intake.test.ts`: the fixture moved to `request-intake-probe.ts`; W1's row edits (the retry row's log, a new host method) go there or in the row as before. The probe's host is in `probeHost`.

## Files

`src/core/store/covered-files.ts` (new), `src/core/scheduler/covered-files.ts` (new), `request-intake.ts`, `request-intake-types.ts`, `checkpoint-requests.ts`, `request-intake-requests.ts`, `narrow-run.ts`, `retries.ts` (doc only), `src/core/types/scheduler.ts`, `src/core/types/daemon.ts`, `src/core/daemon/run-group.ts`, `src/core/daemon/handlers.ts` (by agreement); tests `test/scheduler/request-intake-probe.ts` (new, moved), `request-intake.test.ts`, `request-covered.test.ts` (new), `test/daemon/covered-id.test.ts` (new), `test/cli/covered-id-ignored.test.ts` (new).

## Checks

See the final section, written after the affected results.
