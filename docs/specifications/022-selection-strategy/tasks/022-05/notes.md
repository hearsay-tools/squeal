# 022-05 notes: stop storing loaded lists; remove the reach estimate

## Removed

- The list write: `storeLoaded` in `src/core/scheduler/record-tier.ts`, and
  `writeLoadedModules`, `LOADED_MODULES_SQL`, `LoadedModule`,
  `LoadedModulesRecord` in `src/core/store/loaded-modules.ts`.
- The reach estimate (D4): `src/core/reach/narrowing.ts`, `read-loaded.ts`,
  `inputs.ts` (only the estimate used it), `src/cli/reach-narrowing.ts`; the
  `narrowing` field of the reach report and its text section; the `loaded`
  facts of `ReachTestFile` and `recordedAt` in `read.ts`; the
  `NoList*`, `Unproved`, `Narrowing*` report types.
- Tests: `test/reach/narrowing*.test.ts`; the stored-list cases of
  `test/store/loaded-modules.test.ts`, `prune-keyed.test.ts` (the race case
  "keeps a loaded list a result came to be stored at" has no meaning now)
  and `test/scheduler/loaded-modules.test.ts`.

## Changed

- `dropOrphanLoadedModules` is `emptyLoadedModules`: `deleteByKey` with
  search `1`, so every row goes, `DELETE_BATCH` keys per slice, keys read
  outside the write lock (row 021-33 shape). A store without the table is
  untouched and takes no slice.
- The empty table is not dropped. An older daemon sharing the store makes it
  again on its next write, and a `DROP TABLE` would take the write lock for
  no saving once the rows are gone.
- `test/store/loaded-lists.ts` (new) makes the old table and rows by SQL for
  the prune tests.
- The validity prune case "loaded lists beside expired and kept results"
  keeps its name and input; its `loadedLists` wording is now `[]` against an
  older release's kept lists. That is wording, never a failure.

## Kept

- `RunReport.loaded`, `PartFile.loaded`, the provider, `loadedLists`,
  `#withLoaded`, `src/core/ci/loaded-inputs.ts`: a run's list still joins its
  key and CI part (D2). No `KEY_FORMAT_VERSION` raise.

## Reach JSON `v`

Not bumped (`REACH_REPORT_VERSION` stays 1). The `narrowing` field is gone;
no reader in `src`, `test`, `evals`, `scripts` or the plugins reads it. A
reader that wanted it would get `undefined`, which the estimate already
gave without history.

## Left for the coordinator

- `bench/` `@lists` cells, `docs/` (spec, board), dist rebuild.
- The scheduler test file keeps its name `loaded-modules.test.ts`; it now
  holds only key cases.

## Benchmark (coordinator, 2026-11-21)

Paired `@lists` run, 0.1.587 vs 0.1.589 (the reviewed source of 0.1.591), 2 repeats, one Ryzen 7 9700X sandbox: `bench/results/2026-11-21-0.1.587-vs-0.1.589-default-AMD-Ryzen-7-9700X-8-Core-Processor/`. 15 of 16 cells ran; the run stopped at the start of `store-7g-lists1d@0.1.589-r2` (no cause in its log) and the scorecard was built from the 15 cells with `bench/summarize.mjs`. Correctness PASS in every cell. Cell scores: no drop (store-7g 55 vs 55, store-7g-wt3 57 vs 59, nolists 60 vs 63, lists1d 64 vs 66).

| Cell | Metric | 0.1.587 | 0.1.589 |
|---|---|---:|---:|
| store-7g | `squeal reach` | 75 s, 2,244 MiB | 0.4 s, 117 MiB |
| store-7g | Hook at session start (slowest) | 599 ms | 185 ms |
| store-7g | Hook after each batch (slowest 5%) | 214 ms | 860 ms |
| store-7g | Lock holds over 250 ms, total | 5.2 s (5) | 386 s (540) |
| store-7g-wt3 | Hook at session start (slowest) | 1,107 ms | 367 ms |
| store-7g-wt3 | Hook after each batch (slowest 5%) | 215 ms | 951 ms |
| store-7g-wt3 | Lock holds over 250 ms, total | 15 s (19) | 371 s (593) |
| store-7g-lists1d | Lock holds over 250 ms, total | 1.9 s | 0.8 s |

**Cause of the lock time.** Not the row deletes: 14 delete slices of 256 lists each held the lock over 250 ms (max 1.1 s). The rest is the prune's `incremental_vacuum` after them (`src/core/store/prune.ts` `vacuum`, `VACUUM_PAGES` 512 per slice): 493 to 554 slices per cell, 0.76 s average, up to 2.4 s, about 340 to 365 s in all, still running when each 13-minute cell ended. The store is `auto_vacuum = INCREMENTAL`, so emptying the lists does shrink the file (D3 said it does not; corrected). On a 7 GB store with 82% in lists that is about 1.5 million free pages, about 2,900 slices: on this machine roughly an hour, once per store, with the lock held about half the time in slices up to 2.4 s. Cells with 1 day of lists or none show no such cost.
