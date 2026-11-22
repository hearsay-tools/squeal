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

## Benchmark (coordinator, 2026-11-22)

Paired run, 0.1.591 vs `cand/0.1.593` (`93524ae1c`), cells `store-7g` and `store-7g-wt3`, 1 repeat, one Ryzen 7 9700X sandbox: `bench/results/2026-11-22-0.1.591-vs-0.1.593-default-AMD-Ryzen-7-9700X-8-Core-Processor/`. Correctness PASS. Cell scores 54 vs 54 and 58 vs 55 (Commands −13, one metric moving a band).

| Cell | Metric | 0.1.591 | 0.1.593 |
|---|---|---:|---:|
| store-7g | Lock holds over 250 ms, count and total | 601, 371 s | 38, 18 s |
| store-7g | Longest lock hold | 2,108 ms | 1,649 ms |
| store-7g | Hook after each batch (slowest 5%) | 881 ms | 255 ms |
| store-7g | Hook at session start (slowest) | 211 ms | 100 ms |
| store-7g-wt3 | Lock holds over 250 ms, count and total | 517, 417 s | 60, 29 s |
| store-7g-wt3 | Longest lock hold | 4,156 ms | 1,754 ms |
| store-7g-wt3 | Hook after each batch (slowest 5%) | 1,118 ms | 393 ms |
| store-7g-wt3 | Hook at session start (slowest) | 203 ms | 140 ms |

Prune slices still over 250 ms in 0.1.593: 15 and 23 list deletes of 32 rows, 14 and 16 vacuum slices; the longest prune slice 883 and 1,095 ms. The rest of the long holds are result writes (`#record`) present in both versions. The tail looks like disk stalls on single steps; the bulk of the cost is gone.

## Repair 022-08r (worker, 2026-11-22)

Review 0.1.593 B1: the bench logged prune transactions up to 883 ms (vacuum) and 1,095 ms (32-list delete) against the 100 ms outcome. This section splits those holds into their parts, names the cause, and gives the repair and its measured result.

### Where the time goes

Probe: `research/probes/vacuum-tail/` (README there). It builds a store shaped like the bench's aged store (326 rounds, 163,000 lists of 46 KB between small result rows, `auto_vacuum = INCREMENTAL`, 8.6 GB), drops the page cache, and runs the real `emptyLoadedModules` and then the real `vacuum` on a traced connection. Per write transaction it times each `DELETE` or `incremental_vacuum` step, the work before `COMMIT`, and the `COMMIT`, and reads the wal-index header to see whether SQLite ran a WAL checkpoint inside the commit. A second process writes one small row every 20 ms and records how long it waits for the lock. Each run: one boat.dev sandbox, 4 vCPU Ryzen 7 9700X (the bench's CPU), Node 24.22.1; the list phase to its end, the vacuum phase 8 minutes (of about 45). Raw records: `research/probes/vacuum-tail/runs-2026-11-22.tgz`.

Cause: **the long holds are WAL checkpoints that SQLite runs inside `COMMIT`.** With `wal_autocheckpoint` at its default of 1,000 pages, a commit that leaves the WAL above that copies the WAL into the database file and syncs it before `COMMIT` returns. SQLite does this after it has released the write lock, so other writers go on; but the daemon's thread is blocked for the whole copy, and the long-write log, which measures from `BEGIN IMMEDIATE` to the return of `COMMIT`, counts it as lock time.

First run (0.1.593's code, slices back to back with no pause):

| Slices | Work before `COMMIT`: p99, max | `COMMIT` with a checkpoint: p50, max | Longest whole transaction |
|---|---:|---:|---:|
| 32-list delete (5,094) | 22, 246 ms | 41, 803 ms | 807 ms |
| vacuum, 16-page steps (3,473) | 138, 190 ms | 42, 930 ms | 1,031 ms |

During the 807 ms list-delete transaction the other writer completed 37 transactions and waited at most 8 ms: the checkpoint did not keep it out. Its waits over 100 ms (p95 129 ms) match the vacuum slices' real work, the budget plus one step.

This run had no pauses between slices, unlike the daemon (`turnGapMs`). Without them the WAL never restarted and grew to 2.0 GB (498,000 frames). With the daemon's pauses (all runs below) it restarts every few seconds (212 to 275 restarts in 13 minutes) and stays under 28 MB, well inside the 64 MB limit of spec 021 D4.

### The repair

1. `src/core/store/prune-checkpoint.ts` (new), `checkpointAfterWrites`: a list-delete or vacuum slice commits with the connection's automatic checkpoint off (`PRAGMA wal_autocheckpoint = 0`, restored after the slice, also when it throws), and a slice that wrote is followed by a slice that runs `PRAGMA wal_checkpoint(PASSIVE)`, what SQLite's automatic checkpoint runs. A slice wrote when `total_changes()` or the page count moved. A passive checkpoint takes no write lock and never waits. As its own slice, the driver's pause follows it. `emptyLoadedModules` and `vacuum` (both stores) wrap their slices in it. `open.ts` is unchanged: the setting is per slice, not per connection.
2. `VACUUM_PAGES` 16 → 8. On the cold store a 16-page step took up to 269 ms (p99 63 ms); an 8-page step up to 52 ms (p99 27 ms).

Not changed: `sliced-prune.ts`, the delete predicates, `LIST_DELETE_BATCH` (32: the delete's own work is 4 to 5 ms at p50, 17 to 25 ms at p99), the other prune rules (their commits still checkpoint as before).

### Measured on the probe, with the daemon's pauses

All times in ms. "Write transaction" is `BEGIN IMMEDIATE` to the return of `COMMIT`, what the long-write log measures.

| Slices | Run | Write transaction: p50, p99, max | Over 150 | Over 250 | Checkpoint slice: p50, p99, max |
|---|---|---:|---:|---:|---:|
| 32-list delete (5,094) | 0.1.593 | 6, 86, 368 | 22 | 6 | (inside `COMMIT`) |
| | repair, 16 pages | 5, 23, 111 | 0 | 0 | 17, 118, 341 |
| | repair, 8 pages (head) | 6, 36, 205 | 1 | 0 | 17, 84, 517 |
| vacuum | 0.1.593 (2,045 in 8 min) | 112, 162, 242 | 57 | 0 | (inside `COMMIT`) |
| | repair, 16 pages (1,474) | 112, 151, 270 | 17 | 1 | 30, 356, 1,011 |
| | repair, 8 pages (head, 1,664) | 105, 123, 198 | 1 | 0 | 20, 347, 996 |

At the head, the work before `COMMIT` is at most 133 ms for a list delete and 132 ms for a vacuum slice (vacuum p99 123 ms). The two transactions over 150 ms (205 and 198 ms) are commits that wrote while the other process ran its own checkpoint: their `COMMIT` took 199 and 87 ms with this connection's checkpoint off, which looks like waiting on the same disk.

Other writer, the hook's view (waits for the lock and its own commits, ms):

| Run | Wait p99, max | Own commit p99, max | Own commits over 100 ms |
|---|---:|---:|---:|
| 0.1.593 | 131, 332 | 74, 363 | 70 of 18,200 |
| repair, 16 pages | 129, 330 | 58, 568 | 59 of 26,200 |
| repair, 8 pages (head) | 129, 230 | 61, 399 | 53 of 26,600 |

The other writer's waits are the vacuum slices' real hold (budget plus one step), not the checkpoints. Its own slow commits are checkpoints it runs itself when the WAL passed 1,000 pages; there are somewhat fewer once the prune's checkpoint follows its write at once.

### What it costs, and what stays

- **The checkpoint is not shorter, only out of the write transaction.** A checkpoint slice takes up to 1 s on this store during the vacuum (p99 about 350 ms). It holds no write lock, but the daemon's thread is blocked for it, as it was inside `COMMIT` before. Copying the pages a vacuum slice moved into an 8 GB file with a cold cache costs that much; a smaller slice would make fewer pages per checkpoint but more slices and pauses.
- **The prune takes longer by the clock.** Every checkpoint slice gets a pause of at least 10 ms. The list phase took 331 to 352 s against 233 s; in 8 minutes the vacuum freed 142,000 (16 pages) and 158,000 (8 pages) pages against 196,000. The work is the same; the pauses are more.
- **The WAL limit holds**: the largest WAL before a write was 28 MB (repair) against 19 MB (0.1.593).

### Bench pairs (store-7g, store-7g-wt3)

`bench/boat-run.sh --ref squeal--v0.1.591 --ref . --cells store-7g,store-7g-wt3 --repeat 1`, each pair in one 4 vCPU Ryzen 7 9700X sandbox. `.` is the worktree's plugin, built for the run and not committed (this row leaves `plugins/*/dist` alone), so the scorecards name it 0.1.593, the package version:

- `-2`: `ce9a0ec41`, checkpoint slices with 16-page steps.
- `-3`: the head, checkpoint slices with 8-page steps.

Both pairs pass correctness. The long-write log names only transactions over 250 ms, so the bench cannot show a prune slice between 100 and 250 ms; the probe above does.

| Cell | Run | Score | Lock holds over 250 ms, count and total | Hook after each batch (slowest 5%) |
|---|---|---:|---:|---:|
| store-7g | 0.1.591 (`-3`) | 54 | 615, 364 s | 682 ms |
| store-7g | `cand/0.1.593` (first bench) | 54 | 38, 18 s | 255 ms |
| store-7g | 16-page repair (`-2`) | 56 | 17, 7.8 s | 295 ms |
| store-7g | head (`-3`) | 61 | 5, 3.6 s | 227 ms |
| store-7g-wt3 | 0.1.591 (`-3`) | 58 | 595, 370 s | 895 ms |
| store-7g-wt3 | `cand/0.1.593` (first bench) | 55 | 60, 29 s | 393 ms |
| store-7g-wt3 | 16-page repair (`-2`) | 50 | 77, 39 s | 509 ms |
| store-7g-wt3 | head (`-3`) | 67 | 11, 6.2 s | 170 ms |

Prune slices over 250 ms, longest per kind:

| Cell | Run | Vacuum | 32-list delete | Other prune rules |
|---|---|---:|---:|---:|
| store-7g | `cand/0.1.593` | 14, longest 883 ms | 15, longest 596 ms | |
| store-7g | 16-page repair | 0 | 14, longest 818 ms | 0 |
| store-7g | head | 0 | 1, 253 ms | 1, 251 ms (`dropPrunable`, 256 results) |
| store-7g-wt3 | `cand/0.1.593` | 16, longest 623 ms | 23, longest 1,095 ms | |
| store-7g-wt3 | 16-page repair | 0 | 48, longest 798 ms | 0 |
| store-7g-wt3 | head | 0 | 0 | 0 |

The remaining long holds at the head are result writes (`#record`, 6,003 rows, up to 1,890 ms) and `reconcileBatch`, present in 0.1.591 as well and not prune.

**Vacuum** stays under 250 ms in both repair runs. **List deletes** do not show one picture. The two repair runs have the same list code, yet the first logged 14 and 48 deletes over 250 ms (about 1% of 5,100) and the second 1 and 0. In the first run the long deletes came in the sandbox's busiest seconds. At them the machine was 64% busy (`store-7g`) and 44% (`store-7g-wt3`) at the median, against 9% and 24% over the list phase (`samples.json`). Their checkpoint was off. In the quiet probe the same deletes never took over 205 ms. So the list-delete tail is most likely the daemon held up by test runs inside its transaction (CPU, disk or a GC pause), and not SQLite work the prune could split. It is not proven: the long-write line gives only the total of a transaction.

### For the coordinator

- On the bench store a prune slice's write transaction now stays near the budget: vacuum at most 132 ms in the probe and none over 250 ms in either bench pair. List deletes are at most 133 ms of work in the probe.
- The bench still shows list deletes over 250 ms in one of two runs (14 and 48, up to 818 ms), at the sandbox's busiest moments. A smaller `LIST_DELETE_BATCH` would not help much against a stall of the whole process. Splitting the cause further needs the long-write log to time the parts of a transaction; this row does not own it.
- The checkpoints still block the daemon's thread, outside the lock, for up to about 1 s each during the vacuum. That cannot be split further by the prune: one `wal_checkpoint` call copies every page the WAL holds, and SQLite gives it no page limit.
