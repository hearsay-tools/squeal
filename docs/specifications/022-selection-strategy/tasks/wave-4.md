# Wave 4: short shrink steps (row 022-08)

Approved by the human, 2026-11-21, on the 022-05 benchmark card: "Shrink: A: Shorter shrink steps". Evidence: `tasks/022-05/notes.md`, "Benchmark".

## 022-08 each prune vacuum step and list-delete step holds the store lock briefly

**Outcome.** On a store whose prune frees gigabytes (0.1.591 emptying `loaded_modules`), no prune slice holds the write lock much over 100 ms, so hooks and other worktrees barely wait; the total work stays about the same.

**Read.** `tasks/022-05/notes.md` "Benchmark"; the `@lists` cells' daemon logs under `bench/results/2026-11-21-0.1.587-vs-0.1.589-default-AMD-Ryzen-7-9700X-8-Core-Processor/cells/store-7g@0.1.589-r1/logs/` ("long write" lines: `incremental_vacuum(512)` slices 0.76 s average, up to 2.4 s; list deletes of 256 rows up to 1.1 s); `src/core/daemon/sliced-prune.ts` (the slice driver and its pauses).

**Shape.** Slice.

**Starting seam and leads.**
- `src/core/store/prune.ts` `vacuum`: first edit. Make one slice a time-bounded step: inside one write transaction, run `PRAGMA incremental_vacuum(<small n>)` repeatedly until about 100 ms passed or the freelist stops shrinking. One named budget constant beside `VACUUM_PAGES` in `prune-rules.ts`; a clock the tests can replace. Pick `n` from a measurement and say how in the notes.
- `src/core/code/store/prune.ts` `vacuum`: the same rule, shared, not copied.
- `src/core/store/loaded-modules.ts` `emptyLoadedModules`: a smaller `batch` (`deleteByKey` takes one) so a slice of about 50 KB lists stays near the same budget.
- No change to what is deleted or when prune runs.

**Owns.** Those files, `prune-rules.ts`, and their tests under `test/store/` and `test/code/` (prune and vacuum tests).

**Leave alone.** `src/core/daemon/sliced-prune.ts` unless the budget needs its clock (ask first), `bench/`, `docs/`, `plugins/*/dist` (no `pnpm run build`), `package.json` version.

**Done when.**
- A test with a fake clock: a vacuum slice stops at the budget and the next slice continues; a store without `auto_vacuum` still stops at once.
- A test on a real store with many freed pages: every vacuum slice's transaction stays under a generous bound (for example 300 ms on CI), and the freelist reaches zero.
- `emptyLoadedModules` test still empties 3 batches' worth over several slices with the new batch.
- Key-format and version-sensitive tests pass; lint, typecheck, `squeal status --wait 60000 <changed paths>` clean. `tasks/022-08/notes.md` with the measured step cost.

Use /worker.

## 022-09 review of `cand/0.1.593` (row 022-08)

Pinned to `cand/0.1.593` at `93524ae1c9bdc7bcee076233d6a55a8b28700774`; base main 0.1.591. Commits: the row's change and notes (cherry-picked from worker 53a099a3's `70d4e3b6a`, `cbb197515`) and the bundles with the version. Read the brief above, `tasks/022-08/notes.md` (with the benchmark comparison), and `tasks/022-05/notes.md` "Benchmark".

Check:
1. Each vacuum slice is one write transaction bounded by `VACUUM_SLICE_MS` plus one step; the prune still reaches an empty freelist and still stops at once on a store without `auto_vacuum`; both stores use the one shared rule.
2. Nothing else in prune changed: what is deleted, when prune runs, the slice driver.
3. `emptyLoadedModules` with `LIST_DELETE_BATCH` still empties the table; the extra read steps stay outside the write lock.
4. The benchmark pair in the notes supports the claim (no vacuum hold far over the budget).

Write `reviews/0.1.593.md` with PASS or FAIL; a FAIL names a proven break. Run tests through `squeal status --wait` or explicit vitest paths; no full suite.

Use /reviewer.
