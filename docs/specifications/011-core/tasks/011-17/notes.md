# 011-17 worker notes

Seam map for the edited-file rank (gh-31, C4 step 4 as amended 2026-10-18).

- `Priority` in `src/core/scheduler/queue.ts` gains `edited` (1) between `failing` and `direct`; the
  later classes renumber (direct 2, transitive 3, neverRun 4). Nothing persists or compares the numbers
  outside `queue.ts`; every caller passes `Priority.*` or `priorityOf`.
- `priorityOf` returns `edited` when `changed` holds the test file's own path (added or edited by the
  revision), before the direct-importer check. Callers that pass `changed`: `Ledger.settle`
  (`ledger.ts:235`), `bootstrap.ts:185` and `slow-skip.ts:206`. Every other caller passes
  `NOTHING_CHANGED`; `RunQueue.add` keeps the lowest class, so a re-queue never loses `edited` while
  the entry waits.
- Unknown duration: `sorted` maps a missing duration to 0 for `edited` entries only (`unknownDuration`),
  matching `joinSpan`'s 0; other classes keep `+Infinity`.
- Known gap left for 004-70: `Ledger.hold`'s rollback (`ledger.ts:567`) re-adds an entry at
  `priorityOf(file, NOTHING_CHANGED)`, so a rolled-back `edited` entry returns as `direct` or lower, as a
  `direct` one already returns `transitive`. 004-70's `RunQueue` snapshot/restore fixes both.
- `why` no-match: `readWhy`'s `resolve` (`src/core/status/why.ts`) counts `test_file_keys` rows of the
  worktree with `pending` set and no check at their key (`results.checksForKey`), as
  `WhyNoMatch.queuedWithoutResult` (optional, additive). `formatWhy` prints it only when no candidate
  matched and the count is above 0.
- Tests: `test/scheduler/queue-edited.test.ts` (scenario F and failing-first), `ordering.test.ts`'s
  added-file case over real Vitest (`barrel` fixture), `test/status/why-queued.test.ts`.
