# 020-07b notes: test files counted in the daemon

Worker 06529c62, 2026-11-10. For 020-07c, 020-10b and a reviewer.

## Seam map

- `pass/included.ts` `includedSet(complexity, ignored)`: the `testFiles` argument is gone. A test file is counted when `complexity.include` matches it and `complexity.exclude` does not.
- `crap/loaders.ts` `LoaderBuild.#read`: the line that skipped a test file's own path is gone. `assembleClosure` (`keys/closure.ts`) always puts the test file first in its closure, so every keyed test file is now its own loader. A node:test record holds its test file too (`test/runners/node-test/coverage.test.ts:270`), so node:test callbacks join their own record (the survey's open question 5, answered from that test, no new experiment).
- The 015-52 listing hold is removed:
  - `pass/listed.ts` is deleted.
  - `plan.ts` `workEntries(ctx, since, latest, due)` returns the entries; no held or waiting paths, no `deferred`.
  - `pass.ts`, `edit.ts`, `end.ts`, `stage-edit.ts`: no `held`, `listed` or `holdRemovals`. `committedOf` calls `committedPaths` directly.
  - `PassSource` lost `listing()` and `testFiles()`; `mainStoreSource` no longer reads `testFileKeys`.
  - `SchedulerOptions.onListed`, the `RunnerWork` host's `listed()`, `TierScheduler.#listed` and the daemon's `onListed` nudge are gone.
- The upgrade recount: `pass/cursor.ts` `COUNTING_RULES_VERSION = 2`, and `PassCursor.rules`. A cursor without it, or at another version, makes `recountReason` give `include`. The delivery's existing summary is `Complexity counted again, the included files changed: N functions over 20; squeal code lists them.` The recount is quiet, and the coverage step reseeds after it, so the newly judged `crap` and `uncovered` states of test callbacks get no transition.

## Decisions the spec did not settle

- **Ledger listing record kept.** `listingMetaKey` (written in `scheduler/ledger.ts`, typed in `types/scheduler.ts`, a `WORKTREE_META_ROWS` row) has no reader now. It stays, and so does `ledger.listingFailed`, which also makes the next runner part list again after one that threw. The coordinator files it for a quality scan (request 437a292a).
- **Old `listed:<worktreeId>` rows in code stores** stay. Nothing reads or deletes them.
- **The recount reason is `include`**, not a new reason, so the delivery text and `RecountReason` do not change. The cursor field is optional, so a stored cursor still parses.
- **Tests.** `test/code/pass/test-files.test.ts` replaces `unlisted.test.ts`. `unlisted-move.test.ts` and `listing-failed.test.ts` pinned the hold and are retired. `test/scheduler/on-listed.test.ts` became `listing-record.test.ts`; it keeps the record and list-again cases and drops the hook's. `FakeWorktree` lost `testFiles`, `listed` and `listings`. `staged-edit.test.ts` lost its held variant and the listed `src/n.ts`.
- **Policy reference** (coordinator's decision (a), request 437a292a): `complexity.include` now says test files are counted, in `plugins/claude-code`, `plugins/codex-runtime` and `plugins/pi`. `plugins/codex/seed` is unchanged.

## Behaviour a reviewer can check

- A new test file is counted in the pass of its revision, with no wait for a listing. Until its runner lists it, its coverage reads `unknown` with the cause `no-loader` (020-07a), then its own loader judges it.
- A test file with a skipped test reads its own callbacks `unknown (skipped)`, as any loader with a skip does (020-07a notes).
- In this repository `coverage.exclude` holds `test/**`, so test files get complexity states only. The survey counted +29,029 functions, 3 over CC 20 (`test/lint/oxlint/replay.test.ts` `replay` 33, `test/harness/latency.test.ts` `<describe>.<it>` 25, `test/presence/presence.test.ts` `<describe>.<anonymous>` 24), about 5 s of CPU once per repository.

## For 020-07c and 020-10b

- Nothing here touches `gate/`. The gate already counted test files (020 D2).
- 020-10b's "a test file whose observed set holds a path is also a loader of that path" goes in the same `LoaderBuild.#read` loop.
