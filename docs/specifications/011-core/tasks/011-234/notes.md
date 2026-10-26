# 011-234: a source path selects the readers from this worktree's own closures

Worker 95e58f1f, wave 49 W1, 2026-10-26. Baseline `89f458320`. Brief `tasks/wave-49.md` W1; research `research/source-path-selection.md` (findings 1 and 3).

## Cause

A named wait's source path selected the test files whose stored closure holds it, and it used a stored closure only while the last writer's current key for the file equals this worktree's (`validClosures`, `src/cli/named-selection.ts`). Every worktree overwrites the one record per test file, so a reader dropped out after this worktree's own edit (S1), another worktree's edit (S3), another worktree's commit move (S6b) or its prune (S7b). A wait on `src/cli/start.ts` then exited 0 with `start-spawned.test.ts` failing or queued.

## Change

The coordinator decided the shape on 2026-10-26 (request e9500385, option A): extend `sync`, additive only, no `PAYLOAD_SCHEMA_VERSION` change.

- `SyncRequest.paths?`: the named paths that are not listed test files, relative to the root (`sourcePaths`, `named-selection.ts`). The CLI sends them only while the request line fits `MAX_LINE_BYTES` (64 KiB); otherwise it sends a plain sync and the store rule stays (`syncRequest`, `status-sync.ts`).
- `SyncAnswer.readers?` and `SyncResponse.readers?` (`SyncReaders`, a record from path to `TestFileRef[]`): `Scheduler.readers(paths)` reads `keys.index.reverse.referencing([path])` for each path, from memory, under the scheduler lock, with the revision it returns. `Daemon.#requestSync(paths)` calls it after `reconcile()`. A path no closure holds gets `[]`.
- The handler keeps the readers with the request and answers them on `sync-status` once the revision is set. The front desk posts the paths to the main thread (`FromDesk` `sync.paths?`); `DeskEvents.requestSync` and `HandlerContext.requestSync` take `paths?`.
- `SyncState` `synced` gains `readers?` as a `Map` (no `Object.prototype` keys). `syncedReaders(state)` gives them only when synced.
- `selectNamedFiles(..., readers?)`: a path the answer names selects the listed test files among its readers, in listing order; a path it does not name reads the stored closures, as before. `waitForNamed` and `readNamedSnapshot` read `sync.current()` once per store read and pass its readers, so the selection and the readiness check see one sync state.

No printed line, JSON field or exit code changed. "it selects the N test files that read it" stays true: N is the count of the new selection.

## Type changes (all additive)

`SyncRequest.paths?`, `SyncAnswer.readers?`, `SyncResponse.readers?`, new `SyncReaders` (`src/core/types/daemon.ts`); `Scheduler.readers?` (`src/core/types/scheduler.ts`); `FromDesk` `sync` `paths?`; `DeskEvents.requestSync` and `HandlerContext.requestSync` take `paths?`; `SyncState` `synced` `readers?`; `NamedWaitOptions.sync` and `NamedSnapshotOptions.sync` take a third argument `paths` (stubs with two parameters still fit).

## Answer size (coordinator's point 5)

Only a request line has a bound (`MAX_LINE_BYTES`, enforced by `serve` in `server.ts`). An answer has none; the CLI reads up to the newline within `CLI_SOCKET_TIMEOUT_MS` (2 s). Measured from this repository's 1,324 test file paths (`git ls-files '*.test.ts' '*.test.mts'`, mean 63 bytes per reference): 900 readers are about 58 KB, all 1,324 about 84 KB. `test/daemon/sync-readers.test.ts` sends 900 longer references through the front desk in both thread modes (more than 60 KB) and reads them back.

## Lock wait

`Scheduler.readers` waits for the lock. A batch and a runner part's apply hold it while they write the store; the runner part's fetch does not hold it (`runner-work.ts`). So the answer waits at most for one batch or one apply, as `promote` already does.

## Evidence

- `test/cli/source-path-readers.test.ts`: the research steps S1, S3, S6b and S7b select 13 of 13 readers with the daemon's answer and 0 by the store rule; a path the answer does not name reads the store rule, and an unknown path is unmatched; a wait on `start.ts` with `start-spawned` failing exits 1 and asks readers of `start.ts` only; with it queued the wait holds until its result lands (exit 0, 13 files); an older daemon's answer and no daemon select 12 and exit 0, as before; the snapshot selects 13 and gives 1; `syncRequest` drops paths that do not fit.
- `test/daemon/sync-readers.test.ts`: parse; the handler's answer with and without paths; the front desk in the worker thread and on the main thread.
- `test/scheduler/sync-readers.test.ts`: `Scheduler.readers` before the start (revision only), after it (direct and helper readers, `[]` for an unknown path), and after an edit of the path (the same readers, the later revision).

## Checks run (2026-10-26)

- `npm run lint`: "Checked 2227 files ... No fixes applied." `npm run typecheck`: no errors.
- `squeal status --wait 600000 <the 17 changed paths>` at revision 16: no verdict after 600.6 s, 50 test files still queued behind a running tier (one-minute load 17 on 24 CPUs); 396 current passes, 1 current failure (`test/ps/proc-live.test.ts`, below). The installed Squeal (0.1.333, without this row) selected 1 test file for each changed CLI module: the defect of this row.
- So, as the brief asks, the 75 test files that import a changed module directly, or through `status-wait-fixture.ts` and the other wait fixtures, were named by their own paths: `squeal status --wait 300000 <75 files>` gave "no known failures; 75 test files, each with a current result, after 49.0 s" at revision 16 (commit `18540bfe7`, clean).
- `test/cli/status-wait-round-trip.test.ts`, `selection-paths.test.ts`, `next-step-rows.test.ts` (the named-path lines and the round trip): current passes at revision 16. No line changed, so the evals parser gate has nothing new to round-trip.
- Known failures not from this row: `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts` ("cli/front-desk.mjs differs from the build"): the bundles, not this row's to rebuild. `test/ps/proc-live.test.ts` "ss -xle ties a listening socket file to its inode" fails also when run directly (`npx vitest run test/ps/proc-live.test.ts`, 1 failed, 4 passed); it reads the host's `ss` listing and only the type modules of this row; row 014-48 (in review as cand/0.1.334) is about the same listener lookup.

## Commits

- `6e77e0332` feat(011-234): a named wait's source path selects its readers from the daemon's key index
- `18540bfe7` test(011-234): the research steps select all 13 readers with the daemon's answer
- this notes file

## For the next worker or the integration

- 005 D2's amendment ("There is no daemon request") and the board status line are the coordinator's (reply to e9500385).
- `plugins/*/dist` bundles must be rebuilt at integration: `front-desk.mjs` and the CLI bundle change.
- The readers come from the one sync the wait asks at its start. A closure that grows during the wait (a run that observes a new read, or an edit made after the sync) is not in the answer, since the wait asks no second sync; the store rule read the records at every poll. Such a reader is selected by the next wait.
- Row 011-238 (quality slices, `named-selection.ts`) waits for this row; `NamedSelection` is unchanged here.
