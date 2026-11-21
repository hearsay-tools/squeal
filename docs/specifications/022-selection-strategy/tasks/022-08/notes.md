# Row 022-08: short shrink steps (worker notes, 2026-11-21)

## What changed

- `src/core/store/prune-vacuum.ts` (new): the one vacuum both prunes use. A slice is one write transaction that runs `PRAGMA incremental_vacuum(VACUUM_PAGES)` again until `VACUUM_SLICE_MS` passed, no page is free, or a step freed nothing. The next slice continues. The prune stops when a whole slice freed nothing (a store without `auto_vacuum`). The clock is a parameter (`VacuumClock`, default `performance.now`), so tests replace it. The daemon's `sliced-prune.ts` is unchanged: the budget is inside the slice.
- `src/core/store/prune-rules.ts`: `VACUUM_PAGES` 512 → 16, new `VACUUM_SLICE_MS = 100`, new `LIST_DELETE_BATCH = 32`.
- `src/core/store/prune.ts` and `src/core/code/store/prune.ts`: their own `vacuum` copies removed; both call the shared one. The code store's private `VACUUM_PAGES` is gone.
- `src/core/store/loaded-modules.ts`: `emptyLoadedModules` deletes `LIST_DELETE_BATCH` (32) lists per slice instead of `DELETE_BATCH` (256).
- No change to what is deleted or when a prune runs.

## Step cost and the choice of n

From the 022-05 bench (`store-7g@0.1.589-r1` daemon log, Ryzen 7 9700X): `incremental_vacuum(512)` held the lock 0.76 s on average, up to 2.4 s. That is about 1.5 ms a page on average and 4.7 ms a page at worst on a 7 GB store whose freed pages sit between live ones (each freed page moves a page from the end of the file).

Local measurement of the fixed cost per step (this host, under its normal load, a 60 MB WAL store with `auto_vacuum = INCREMENTAL` and 20,000 freed 3 KB rows between kept rows; one `BEGIN IMMEDIATE`/`COMMIT` per step):

| n | average per step | per page |
|---:|---:|---:|
| 8 | 0.13 ms | 0.016 ms |
| 16 | 0.18 ms | 0.011 ms |
| 32 | 0.25 ms | 0.008 ms |
| 64 | 0.53 ms | 0.008 ms |
| 128 | 0.99 ms | 0.008 ms |

So a step's own cost is about 0.1 ms, and pages cost the rest. Inside one transaction (as now) the commit cost is paid once per slice, so it is less. n = 16 keeps the overshoot past the 100 ms budget at about 16 × 1.5 = 24 ms on average and 16 × 4.7 = 75 ms at worst on the bench store, while the extra step cost is at most about 0.1 ms per 16 pages: under 1% of the work on the bench store, where pages cost 1.5 ms each. The script was a throwaway in the task's scratch directory (create the store, `DELETE` one table, time `incremental_vacuum(n)` steps).

List deletes: 256 lists held the lock up to 1.1 s (0.43 to 1.1 s in the log), about 2 to 4 ms a list. 32 lists is about 70 to 140 ms, near the budget. Each delete slice has its own read slice before it, so the number of read transactions grows 8×; each is a short keyed read outside the write lock.

## Not measured here

The bound on a large store is the bench's job: `store-7g` and `store-7g-wt3`, 0.1.591 vs this candidate (board row's done-when). Expected: vacuum slices about 100 to 175 ms, no long-write line over 250 ms from the vacuum, total vacuum time about the same as before.
