# The gate for one daemon per clone (row 021-17, spec D16)

Researcher cf35a6b6, 2026-11-19. Repeats `store-contention.md` Q3 (lock watch) and `daemon-model.md` Q1 (main-thread sampling) one week after Parts 1 to 4 shipped (0.1.436, 0.1.442), and reads the daemon logs of row 021-32 (0.1.488 and later). Every live daemon sampled ran 0.1.563 (`squeal ps`). Source read at `a45e88372`; bundles from the plugin cache, 0.1.488 to 0.1.565. Probes and outputs: `probes/one-daemon-gate/` (throwaway).

**Status: draft with window 1 only. Window 2 (10:00Z to 13:00Z, the coordinator's choice) is pending; the verdicts below may change with it.**

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Lock watch, 25 min | Window 1, 08:03Z to 08:28Z, load 6.2 to 23.5: cezar `store.sqlite` held 11.5% (was 24%), cezar `code.sqlite` 29.6% (was 43%), squeal `store.sqlite` 10.4% (was 17.4%), squeal `code.sqlite` 46.5% (not measured on 2026-11-11). Hooks now hold the store lock 0.1 to 0.3% (was 4.5% on cezar). **[exp]** |
| 2 | Main-thread sampling | cezar: 2.0% of samples in the busy wait (was 21.1%), 14.0% running. squeal: 8.8% busy wait (was about 1%), almost all of it while another daemon held `code.sqlite`. **[exp, inf]** |
| 3 | Daemon logs, last week | 67,427 long writes on cezar's store (p50 0.5 s, p90 1.3 s, max 29 s), 11,216 on cezar's code store (p50 1.7 s; 89% of their time wrote no row: the code-store prune), 15,604 and 2,554 on squeal's. Holders: tier records, revision apply's closures, ledger commits, prune slices. **[exp]** |
| 4 | D16 applied | Window 1: only squeal `code.sqlite` passes a threshold (busy wait 8.8% > 5%); the prune explains 0.9 points of it. The logs: cezar `store.sqlite` passed 50% held in 3 of 192 windows after 2026-11-16 with prune holds removed (evenings). Per store below. **[exp]** |
| 5 | Recommendation | Pending window 2. Draft: the prune is a targeted fix that alone does not settle the gate; the remaining holders are the daemons' own result writes. |

## Findings

### Q1. Lock watch

`../store-contention/lock-watch.mjs 1500 20` on cezar's `store.sqlite`, `code.sqlite`, `lint.sqlite` and squeal's `store.sqlite`, `code.sqlite`, 2026-11-19 08:03:03Z to 08:28:03Z, one-minute load 6.2 to 23.5 (`out/window-1.txt`, raw `out/lockwatch-1.jsonl.gz`) **[verified by experiment]**. Workload (`out/ps-window-1.txt`): cezar 3 to 5 daemons, 1 or 2 of them running tiers; squeal 6 daemons, 14 after 08:20Z when eight new worktrees started. A hold is clipped to the window and to each 5-minute bucket (2026-11-11 counted it in the bucket it started in). Split: (a) prune holds the daemon logs name (`long-writes.mjs`; prune holds of 250 ms or less are not logged, so (a) is a lower bound), (b) everything else.

| Store | Held | Daemons / hooks | Holds ≥1 s, ≥2 s, ≥5 s, max | Per 5 min | (a) prune / (b) rest | 2026-11-11 |
|---|---|---|---|---|---|---|
| cezar `store.sqlite` | 11.5% | 11.2% / 0.3% | 11, 6, 2, 7.0 s | 15, 15, 7, 7, 15% | 1.5% / 10.0% | 24% (19.4% / 4.5%), max 3.4 s |
| cezar `code.sqlite` | 29.6% | 29.6% / 0.0% | 4, 1, 1, 7.8 s | 41, 36, 28, 24, 20% | 0.8% / 28.8% | 43%, holds to 116 s |
| squeal `store.sqlite` | 10.4% | 10.2% / 0.1% | 34, 6, 0, 3.0 s | 5, 2, 9, 16, 21% | 1.0% / 9.4% | 17.4% (half hooks), max 2.1 s |
| squeal `code.sqlite` | 46.5% | 46.3% / 0.1% | 4, 1, 0, 3.7 s | 23, 23, 51, 65, 70% | 1.3% / 45.1% | not watched |
| cezar `lint.sqlite` | 0.0% | | 0, 0, 0, 40 ms | | | not watched |

Three changes since 2026-11-11. First, hooks almost left the lock: D15 sends their writes through the serving daemon (busy notes name "a hook's or command's writes", 3,912 times on cezar). Second, no hold of minutes: the longest is 7.8 s, against 116 s on cezar's code store then. Third, the busiest lock is now squeal's code store: 13,839 daemon holds, nearly all under 250 ms, rising from 23% to 70% per 5 minutes as eight new worktrees started. Their operations are not logged (under D3's 250 ms); the code store's writers are the complexity pass, the CRAP step and coverage records (`src/core/code/pass/`, `crap/`, `store/coverage.ts`, `store/parts.ts`) **[read in source code]**.

### Q2. Main-thread sampling

`wchan-watch.mjs`: every second, every live daemon's main-thread state and `wchan` from `/proc`, 08:05:31Z to 08:28:12Z (`out/wchan-1.txt.gz`). It finds daemons again every 5 s, since they came and went within minutes; 15 short-lived pids titled `main` and `repo` are test fixtures and are left out **[verified by experiment]**. `hrtimer_nanosleep` is SQLite's busy handler: the daemon's other synchronous waits are `Atomics.wait` (a futex wait) and `execFileSync` (`src/core/store/open.ts:172`, `src/core/commit/at-keys-side.ts:201`) **[inferred, read in source code]**. Each sleep sample is matched with the lock watch: which other process held the project's stores in that second, and whether it was inside a logged prune hold.

| Project | Daemons, samples | Running | Busy wait | (a) prune / (b) rest | Store held by another: only store / only code / both | Idle (`ep_poll`) |
|---|---|---|---|---|---|---|
| cezar | 7 pids (3 to 5 at a time), 5,717 | 14.0% | 2.0% | 0.6% / 1.4% | 0.2% / 0.8% / 1.0% | 82.3% |
| squeal | 14 pids, 12,409 | 12.4% | **8.8%** | 0.9% / **7.9%** | 0.1% / 4.2% / 4.5% | 77.8% |
| 2026-11-11 cezar | 8, 857 (load 52 to 68) | 72.5% | 21.1% | | | 4.9% |
| 2026-11-11 squeal | 9, 1,080 | 14.0% | about 1% | | | 80.9% |

Normalized to active samples (running or waiting), cezar waited in 12% of them (was 23%) and squeal in 42% (was 7%). Per squeal daemon the busy wait ran from 2% (an idle one) to 19% (the new ones). By the matching, at most 0.1 to 4.6% of squeal's samples waited on `store.sqlite` (only-store to only-store plus both) and at least 4.2% on `code.sqlite`. Window 2 samples at millisecond times to narrow the "both" share.

### Q3. The daemon logs, 2026-11-14 16:04Z to 2026-11-19 08:04Z

`logs-summary.mjs` over 596 cezar and 286 squeal log files (`out/logs-summary.json`). A gone worktree's log is deleted by `squeal remove`, so counts are lower bounds **[verified by experiment]**.

| Store | Long writes | p50, p90, max | ≥1 s, ≥2 s, ≥5 s | Time held | Main holders (time) |
|---|---|---|---|---|---|
| cezar `store.sqlite` | 67,427 | 498 ms, 1.3 s, 29.1 s | 10,356, 3,575, 786 | 51,901 s; 9,192 to 13,883 s a day | tier records `#write < #record` 14,800 s; revision apply's closures `storeClosures < applyRunnerPart` 10,539 s (p50 1.3 s, max 29 s); ledger commits 9,041 s; reconciliation 4,513 s; tier starts 3,277 s; prune slices 2,497 s |
| cezar `code.sqlite` | 11,216 | 1.7 s, 2.6 s, 61.9 s | 10,007, 2,706, 459 | 23,958 s | prune: unsliced `pruneCodeStore` 14,536 s (8,001 holds, all before 2026-11-15 05Z, releases before 0.1.511), sliced 9,014 s; 21,228 s of holds wrote 0 rows |
| squeal `store.sqlite` | 15,604 | 476 ms, 1.4 s, 32.0 s | 2,651, 661, 96 | 11,172 s | tier records 5,318 s; closures 3,468 s; reconciliation 1,339 s |
| squeal `code.sqlite` | 2,554 | 460 ms, 1.9 s, 14.4 s | 348, 252, 67 | 2,223 s | prune slices, 1,452 s of 0-row holds |

Busy notes (D2's retried path): cezar 74,673 episodes (p50 0.7 s, p90 7 s, p99 64 s), squeal 10,586 (p50 0.5 s, p90 2.4 s). Most waited: the next tier, the heartbeat, consumer expiry, hooks' writes. Writes that still failed with "database is locked": `complexity:` 4,692 on cezar and 646 on squeal (logged, the next pass counts again), plus 139 others (shutdown marks, optimizer and merge-hold notes, `setDaemon`), 101 of them on 2026-11-15 and 14 since 2026-11-17.

**The prune [read in source code, exp].** Every daemon prunes the shared store and then the code store 60 s after start and every hour (`src/core/daemon/lifecycle.ts:261,471`), so a clone with N daemons prunes N times an hour, plus once per daemon start. Each slice is `DELETE ... WHERE (key) IN (SELECT key ... WHERE <condition> LIMIT 256)` inside the write transaction (`src/core/code/store/prune.ts:223`). `explain-prune.mts` (`out/explain-prune.txt`, query plans on an empty database with the code store's schema, so without statistics): the `views`, `counts`, `coverage` and `checks` conditions each scan a whole table, `checks` three more. A slice that finds nothing still scans, under the lock: the 0-row holds of 1.5 to 2 s.

**25-minute windows from the logs** (`log-windows.mjs`, `out/log-windows.txt`). Logged holds on one store never overlap, so their sum per window is a lower bound on the share held; in window 1 the logged holds were about three quarters of cezar's store hold time.

| Store | Since 2026-11-14 16:15Z: windows over 50% (max) | Same without prune | Since 2026-11-16: over 50% (max) | Same without prune |
|---|---|---|---|---|
| cezar `store.sqlite` | 11 of 268 (101%) | 10 (93%) | 4 of 192 (92%) | 3 (91%): 2026-11-16 00:00Z, 2026-11-18 22:50Z and 23:15Z |
| cezar `code.sqlite` | 12 (99%), all 2026-11-15 00:35Z to 03:30Z | 0 (2%) | 0 (14%) | 0 (1%) |
| squeal `store.sqlite` | 0 (22%) | 0 (20%) | 0 (20%) | 0 (18%) |
| squeal `code.sqlite` | 0 (4%) | 0 (2%) | 0 (4%) | 0 (2%) |

By hour of day (UTC, averaged over 2026-11-15 to 11-18), cezar's store is busiest 20Z to 00Z (20 to 52% held by long holds alone; one evening, 2026-11-15, weighs most) and 09Z to 14Z (9 to 12%).

### Q4. D16 applied

D16: propose one daemon per clone if daemons wait on each other's lock in more than 5% of main-thread samples, or the lock is busy more than half of a 25-minute window. Draft verdicts, window 1 and the logs:

| Store | Busy wait | Lock busy | D16 now | D16 with prune holds removed |
|---|---|---|---|---|
| cezar `store.sqlite` | ≤2.0% (cezar total) | 11.5%; logs: 3 to 4 evening windows over 50% since 2026-11-16 | window 1: no; logs: yes, on evenings | same: the prune is 1.5 points |
| cezar `code.sqlite` | ≤1.8% | 29.6%; logs: 0 over 50% since 2026-11-16 | no | no |
| squeal `store.sqlite` | 0.1 to 4.6% | 10.4%; logs: max 20% | no (near 5% only if all "both" samples were store waits) | no |
| squeal `code.sqlite` | 4.2 to 8.7% | 46.5%, 70% in the last 5 minutes | yes on busy wait; near on lock busy | yes: 7.9% of busy wait is not the prune |

### Q5. Recommendation

Pending window 2.

## Open questions

1. Which operations make squeal's short `code.sqlite` holds: not logged under D3's 250 ms. A per-operation count of all write transactions (not only long ones) would name them.
2. Whether a hold's length grows with host load (synchronous work inside a transaction descheduled): not determined; it decides whether one writer would shorten holds or only queue them.

## Sources

- `spec.md` D3, D15, D16; `status.md` (2026-11-11 to 2026-11-14 entries); `store-contention.md` Q3; `daemon-model.md` Q1; probes `store-contention/lock-watch.mjs`, `daemon-model/wchan-sample.sh`.
- Source at `a45e88372`: `src/core/store/long-write.ts`, `busy.ts`, `connection.ts`, `open.ts`; `src/core/daemon/lifecycle.ts`, `sliced-prune.ts`, `daemon.ts:851`; `src/core/code/store/prune.ts`, `schema.ts`. Bundles `~/.claude/plugins/cache/hearsay/squeal/<version>/dist/cli/squeal.mjs`, 0.1.488 to 0.1.565, to name anonymous frames.
- Live, read only: `/proc/locks`, `/proc/<pid>/task/<pid>/{stat,wchan}`, `squeal ps`, `~/projects/{cezar,squeal}/.git/squeal/logs/daemon-*.log{,.1}`.
- Probes in `probes/one-daemon-gate/`: `wchan-watch.mjs`, `summarize-locks.mjs`, `summarize-wchan.mjs`, `long-writes.mjs`, `logs-summary.mjs`, `log-windows.mjs`, `explain-prune.mts`; outputs in `out/`.
