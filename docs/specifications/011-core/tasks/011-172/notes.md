# 011-172: quality 2026-10-24 slices 2, 7, 8, 9, 10 and 12

Wave 29 W4, `tasks/wave-29.md`, from main 897e3e357. Slice 6 went with 011-171 (W3). Each slice is one or two commits that name it. No behaviour or printed text changes; the key-format alarm (`test/keys/key-format.test.ts`) passes with no version moved.

## 1. What changed

- **Slice 10.** `newTier(context, ledger, first, files, kind)` in `src/core/scheduler/tiers.ts` builds the fields every tier has (run id, log folder, lane, `beginRun`, revision, checkpoint, snapshot, kind, start time, cancel, load) and adds its changes to `Ledger.tierChanges`. `startTier` adds `lease` and `slot`; `startFocusedTier` adds `focus`. The cancel rule (`backlog` always; any other but `slow` when the runner cancels) is stated once, in `newTier`.
- **Slice 2.** `focuses` (`src/core/scheduler/focused.ts`) calls `focusesFile(context.runner, ref)` from `src/core/daemon/composite-runner.ts`.
- **Slice 7.** Prune's run delete is one statement in one transaction again (`dropRuns`, `src/core/store/prune.ts`), with `keptRuns` read once inside it. `dropLiveWorktreeRuns` and `dropRemovedWorktreeRuns` are gone.
- **Slice 8.** The `StoredKeys` header says another worktree's unconfirmed fail is queued once for the local run (C4 step 3 as amended 2026-10-23, 011-159). Comment only.
- **Slice 9.** `waiting(until, lane, now)` beside `after` in `src/core/scheduler/quiet.ts`; `BacklogQuiet.waits` and `catchUpWaits` call it. `quiet.ts` is 313 lines, from 314.
- **Slice 12.** `ResultRepo.newestForTestFile`'s contract (`src/core/types/store.ts`) states the tie rule: the greater `rowid` names the key, as in `listForCheck` and prune. Review 0.1.279 N1's probe is a case in `test/store/newest-for-test-file.test.ts`.

## 2. Decisions the brief did not settle

1. **`newTier` takes `first` beside `files`.** The brief named `newTier(context, ledger, files, kind)`. The lane and the cancel come from the first file, and `noUncheckedIndexedAccess` makes `files[0]` possibly undefined. Both callers already hold the first file after their own empty check, so it is passed in. The other choices were a non-empty tuple type with a type guard (more code at both callers) or a throw on an empty list (a new path).
2. **The focused tier begins inside the focused row's transaction.** Before, `startFocusedTier` wrote the focused row first and then began the tier (`beginRun`, `tierChanges`). `newTier` gives the run id the row needs, so the order had to change. Both now run in one `store.transaction`, so `BEGIN IMMEDIATE` takes the store before `newTier` runs: a busy store's give-up (row 011-126's busy slice) still comes before the tier begins its run, as in `startTier`. Without this, each busy retry would leave one `beginRun` in flight and one change set in `Ledger.tierChanges`.
3. **`newTier` returns `Tier & { readonly startedAt: EpochMs }`.** `Tier.startedAt` is optional; the focused row needs the tier's own start time, so the focused row and the tier keep one time, as before. Local to `tiers.ts`; no exported interface changed.
4. **Slice 7's test is a new file, `test/store/prune-runs.test.ts`.** It pins each part of the run rule in a live and a removed worktree: ended before the cutoff, at the cutoff, after it, still running, named by a result, named by a kept replaced failure. It passed on the two-statement code before the change and passes after. With `end_state IS NOT NULL` dropped, or with the removed worktree's runs left out, it fails.

## 3. Type changes

- New export `newTier` in `src/core/scheduler/tiers.ts`.
- `src/core/types/store.ts`: doc comment of `ResultRepo.newestForTestFile` only.

## 4. For whoever continues

- `tasks/011-160/notes.md` section 3 says a different log rule for a removed worktree's runs would go in `dropRemovedWorktreeRuns`. That function is gone; such a rule would now split `dropRuns`' `WHERE` again, as 011-160 did.
- `cancels` stays exported: `scheduler.ts:928` uses it for a tier in flight.
- Mutation checks were run with `npx vitest run` on one file each, the source restored after: prune (two mutations) and `newestForTestFile` (tie order reversed).
