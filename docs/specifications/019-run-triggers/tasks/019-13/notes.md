# 019-13 notes: commit report core (spec D5 steps 2 to 4)

Worker 6d055faa, 2026-11-03. Commits `bb73dacee` (meta row), `8fa02da21` (test files and the boundary sync), `fbd499d2f` (lint counts), and this notes commit.

## What exists now

- `src/core/commit/`: `report.ts` (the stored shape: `CommitReport` is counted or failed; `tests` always, `lint` optional), `store.ts` (one `commitReports` meta row per worktree: `seen`, the last `HEAD` looked at, and the newest 20 reports, newest first), `tree.ts` (`git ls-tree -r -z --full-tree`), `compute.ts` (`differingPaths`, `testCounts`, over a `CommitView`), `lint.ts` (`lintCounts`, `readLintCounts`), `text.ts` (`commitReportText`, pure), `boundary.ts` (`syncOnHeadMove`).
- `src/core/scheduler/head-move.ts`: `rememberHead` (first batch of a scheduler: the row's `seen`, else the `HEAD` the store knew) and `reportHeadMove` (every pass that is not a watch batch).
- `src/core/scheduler/batch.ts`: `rememberHead` at the top of `reconcileBatch`; `reportHeadMove` after both non-watch exits.
- `src/harness/shared/deliver.ts`: a boundary that may edit, with the daemon `fresh`, calls `syncOnHeadMove` before the delta.

## Seam map

- Report trigger: only passes that are not watch batches (`interval`, `dropped-events`, and the `sync` request's pass, which is an `interval` pass through `Daemon.#requestSync` -> `loop.reconcile()`). The daemon's start (`WorktreeKeys.bootstrap`, trigger `start`) does not go through `reconcileBatch`; `rememberHead` covers it: the first batch remembers the store's `HEAD`, so a commit made before it is still a move.
- A watch batch whose revision records a new `HEAD` (a checkout, a rebase's files) reports nothing; the boundary sees `HEAD` differ from the row's `seen` and asks for a `sync`, whose pass reports once.
- Boundary rule: `readGitHead` (no spawn) against the row's `seen`; with no row yet (an older daemon), against `readRevisionCommit(...).head`. An older daemon's `sync` pass records the head move, so the comparison stops differing: no sync per tool call.
- Equality, not key recomputation: a test file's committed key equals its current key exactly when no closure path and no environment input differs between the stat cache and the commit's tree. Paths the commit lacks that git ignores are no difference (`checkIgnored`); paths the stat cache does not track are left out (a closure with one has no key).
- Counts per test file: `failures` counts current failing checks (as `Known failures`); `notDetermined` files; `running` files with no current result and a pending phase; `unknown` files with no current result and nothing queued, or no key.
- Lint: the lint store's `lint-program:<scope>` record (`readProgram`) names the whole-program files per tool. The lint store is opened read-only with `openForReading` from the scheduler's own policy.

## Decisions the spec did not settle (my choices)

1. Text units. The spec's example says "3 checks still running". The text says "3 test files still running": the report counts files there, and `Known failures` counts checks. Lint parts read `lint 2 findings, 1 file not determined, 1 file still running`. Test files with no result say `N test files unknown`.
2. A move back to a commit already reported (A to B to A) recomputes nothing; A's stored report becomes the newest again, so status's "newest commit" is the current `HEAD`'s.
3. A git error reading the tree is stored as a failed report (`Commit abc1234: no report (<reason>)`), and `seen` advances, so a failing commit does not make every boundary send a `sync`.
4. Lint whole-program checks: the coordinator's rule makes them not determined; I count them when nothing at all differs (then the program is the commit's, exactly). Any differing path makes them not determined.
5. A differing environment input makes every keyed test file not determined, across projects. `WorktreeKeys` exposes `isEnvironmentInput` only, not the projects reading a path.

## Known limits

- A lint config file left unstaged is not seen: the lint store does not record the config files a lint key read. Fix in the lint pass: record them beside `lint-program`.
- A test file the commit holds but the working tree deleted is not counted (the daemon no longer lists it).
- No refresh. The report is computed once; "when the commit groups finish, a change delivery updates it once" (D5 step 3) needs either the waiting keys stored with the report or a recount. The row keeps counts only.
- `syncOnHeadMove` waits for the socket answer up to 100 ms (`DAEMON_SOCKET_TIMEOUT_MS`); the pass itself is not awaited, so the report reaches the agent at the next boundary.

## Next

- D5 step 1 (commit groups) after 019-10's `requestGroup`: `reportHeadMove` is the place to queue a group at `commit` for the files the move changed (`git diff --name-only <seen> <head>`).
- 019-16 prints `commitReportText(newestCommitReport(store.meta, worktreeId))` in status and once per new report in the delivery.
- Bundles: the committed plugin bundles drift from the source (the Pi and OpenCode package tests fail; others may) until `pnpm run build:plugin`; expected, the row does not own the bundles.
