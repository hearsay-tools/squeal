# The gate for one daemon per clone (row 021-17, spec D16)

Researcher cf35a6b6, 2026-11-19. Repeats `store-contention.md` Q3 (lock watch) and `daemon-model.md` Q1 (main-thread sampling) one week after Parts 1 to 4 shipped (0.1.436, 0.1.442), and reads the daemon logs of row 021-32 (0.1.488 and later). Two 25-minute windows: 08:03Z (every daemon on 0.1.563) and 10:00Z (0.1.563, 0.1.565, 0.1.566), the second in the daytime peak the coordinator chose; the logs stand for the evenings. Source read at `a45e88372`; bundles 0.1.488 to 0.1.566 from the plugin cache. Probes and outputs: `probes/one-daemon-gate/` (throwaway).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Lock watch | cezar `store.sqlite` held 11.5% and 28.3% (was 24%); cezar `code.sqlite` 29.6% and 42.2% (was 43%); squeal `store.sqlite` 10.4% and 10.0% (was 17.4%); squeal `code.sqlite` 46.5% and 24.8%. No store over 50% in either window. Hooks hold 0.1 to 0.4% (cezar was 4.5%). Per daemon present, held time did not fall. **[exp]** |
| 2 | Main-thread sampling | Busy wait: cezar 2.0% and **10.1%** (was 21.1% at load 52 to 68); squeal **8.8%** and 3.9% (was about 1%). **[exp, inf]** |
| 3 | Daemon logs, 2026-11-14 to 11-19 | 67,427 long writes on cezar's store (p50 0.5 s, max 29 s), 11,216 on its code store (89% of their time in 0-row prune deletes), 15,604 and 2,554 on squeal's. Holders: tier records, ledger commits, revision apply's closures, prune slices. **[exp]** |
| 4 | D16 applied | Met. Busy wait passes 5% on both clones in one window each, also with prune holds removed (cezar 5.9%, squeal 7.9%). cezar's store lock passed 50% in 3 evening windows since 2026-11-16 by logged long holds alone, prune removed. Per store below. **[exp]** |
| 5 | Recommendation | Propose one daemon per clone to the human. Fix the prune first, separately: it is the largest single holder and the longest holds, but removing it does not bring the gate below its thresholds. |

## Findings

### Q1. Lock watch

`../store-contention/lock-watch.mjs 1500 20` on cezar's `store.sqlite`, `code.sqlite`, `lint.sqlite` and squeal's `store.sqlite`, `code.sqlite`, read-only through `/proc/locks` **[verified by experiment]**. Window 1: 08:03:03Z to 08:28:03Z, load 6.2 to 23.5; cezar 3 to 5 daemons (mean 4.2), squeal 6 rising to 14 as eight worktrees started after 08:13Z (mean 9.1). Window 2: 10:00:19Z to 10:25:19Z, load 8.6 to 28.2, above 24 for 34 s (so any share below moves by at most 2.3 points without them); cezar 7 to 9 daemons (mean 8.4, 19 pids), squeal 3 to 4 (`out/window-{1,2}.txt`, `out/ps-window-{1,2}.txt`). Holds are clipped to the window and to 5-minute buckets. (a) is the prune holds the daemon logs name (`long-writes.mjs`; 92 of 93 anonymous slice frames in window 2 map to prune functions in 0.1.563 to 0.1.566; holds of 250 ms or less are not logged, so (a) is a lower bound), (b) the rest.

| Store, window | Held | Daemons / hooks | ≥1 s, ≥2 s, ≥5 s, max | Per 5 min | (a) prune / (b) rest |
|---|---|---|---|---|---|
| cezar `store.sqlite`, 1 | 11.5% | 11.2 / 0.3% | 11, 6, 2, 7.0 s | 15, 15, 7, 7, 15% | 1.5 / 10.0% |
| cezar `store.sqlite`, 2 | **28.3%** | 27.8 / 0.4% | 67, 34, 5, 7.1 s | 35, 29, 25, 28, 25% | 5.5 / 22.8% |
| cezar `code.sqlite`, 1 | 29.6% | 29.6 / 0.0% | 4, 1, 1, 7.8 s | 41, 36, 28, 24, 20% | 0.8 / 28.8% |
| cezar `code.sqlite`, 2 | **42.2%** | 41.9 / 0.3% | 36, 24, 13, 18.3 s | 41, 24, 51, 56, 39% | 13.5 / 28.7% |
| squeal `store.sqlite`, 1 | 10.4% | 10.2 / 0.1% | 34, 6, 0, 3.0 s | 5, 2, 9, 16, 21% | 1.0 / 9.4% |
| squeal `store.sqlite`, 2 | 10.0% | 9.7 / 0.3% | 29, 13, 2, 8.3 s | 3, 17, 15, 6, 10% | 1.2 / 8.8% |
| squeal `code.sqlite`, 1 | **46.5%** | 46.3 / 0.1% | 4, 1, 0, 3.7 s | 23, 23, 51, 65, 70% | 1.3 / 45.1% |
| squeal `code.sqlite`, 2 | 24.8% | 24.8 / 0.0% | 1, 1, 1, 5.6 s | 7, 23, 37, 40, 18% | 0.5 / 24.3% |
| cezar `lint.sqlite`, 1 and 2 | 0.0 to 0.1% | | max 125 ms | | |

2026-11-11 (same probe, 25 minutes, load 12.7 to 35.8): cezar store 24% (daemons 19.4%, hooks 4.5%, max 3.4 s), cezar code store 43% (holds up to 116 s), squeal store 17.4% (half hooks, max 2.1 s).

What changed. Hooks left the lock: D15 sends their writes through the serving daemon (busy notes name "a hook's or command's writes" 3,912 times on cezar). The longest holds fell from 116 s to 18 s. Per daemon present, held time did not fall: cezar's store 3.0% per daemon on 2026-11-11, 2.7% and 3.4% now; cezar's code store 5.4%, now 7.0% and 5.0% **[inferred: a crude normalization; busy daemons were not counted over the 2026-11-11 window]**. The work the hooks did now runs inside the daemons. Squeal's code store in window 1 was 13,839 daemon holds, nearly all under 250 ms, so the logs do not name them; the code store's writers are the complexity pass, the CRAP step and coverage records (`src/core/code/pass/`, `crap/`, `store/coverage.ts`, `store/parts.ts`) **[read in source code]**. The longest holds in window 2 (cezar code store, 12 to 18 s) are prune slices.

### Q2. Main-thread sampling

`wchan-watch.mjs`: every second, every live daemon's main-thread state and `wchan` from `/proc`, finding daemons again every 5 s (`out/wchan-{1,2}.txt.gz`); window 1 in whole seconds, window 2 in milliseconds. Test-fixture daemons (titles `main`, `repo`) and one idle `toolkit-dev` daemon are left out **[verified by experiment]**. `hrtimer_nanosleep` is SQLite's busy handler: the daemon's other synchronous waits are `Atomics.wait`, a futex wait, and `execFileSync` (`src/core/store/open.ts:172`, `src/core/commit/at-keys-side.ts:201`) **[inferred, read in source code]**. Each sleep sample is matched with the lock watch (which store another process held at that instant; window 1: in that second) and with the logged prune holds.

| Project, window | Daemons (mean), samples | Running | Busy wait | (a) prune / (b) rest | Only store held: prune + rest | Only code held: prune + rest | Both held |
|---|---|---|---|---|---|---|---|
| cezar, 1 | 4.2, 5,717 | 14.0% | 2.0% | 0.6 / 1.4% | 0.1 + 0.1% | 0.0 + 0.8% | 1.0% |
| cezar, 2 | 8.4, 12,609 | 14.9% | **10.1%** | 4.2 / **5.9%** | 1.3 + 2.5% | 0.9 + 1.5% | 3.8% |
| squeal, 1 | 9.1, 12,409 | 12.4% | **8.8%** | 0.9 / **7.9%** | 0.0 + 0.1% | 0.3 + 3.9% | 4.5% |
| squeal, 2 | 3.5, 5,273 | 18.5% | 3.9% | 1.1 / 2.8% | 0.8 + 1.0% | 0.1 + 1.2% | 0.5% |
| cezar, 2026-11-11 | 8, 857 (load 52 to 68) | 72.5% | 21.1% | | | | |
| squeal, 2026-11-11 | 9, 1,080 | 14.0% | about 1% | | | | |

The busy wait follows the number of daemons at work: cezar doubled its daemons between the windows and its wait went from 2% to 10%; squeal's wait was 8.8% while it had 6 to 14 daemons and 3.9% with 3 to 4. Per daemon it ran from 1% (an idle one) to 19%. Busy wait halved on cezar against 2026-11-11, but the load was a third of that day's; how much is the fixes is not determined.

### Q3. The daemon logs, 2026-11-14 16:04Z to 2026-11-19 08:04Z

`logs-summary.mjs` over 596 cezar and 286 squeal log files (`out/logs-summary.json`); `squeal remove` deletes a gone worktree's log, so counts are lower bounds **[verified by experiment]**.

| Store | Long writes | p50, p90, max | ≥1 s, ≥2 s, ≥5 s | Time held | Main holders (time held) |
|---|---|---|---|---|---|
| cezar `store.sqlite` | 67,427 | 498 ms, 1.3 s, 29.1 s | 10,356, 3,575, 786 | 51,901 s; 9,192 to 13,883 s a day | tier records `#write < #record` 14,800 s; revision apply's closures `storeClosures < applyRunnerPart` 10,539 s (p50 1.3 s, max 29 s); ledger commits 9,041 s; reconciliation 4,513 s; tier starts 3,277 s; prune slices 2,497 s |
| cezar `code.sqlite` | 11,216 | 1.7 s, 2.6 s, 61.9 s | 10,007, 2,706, 459 | 23,958 s | prune: unsliced `pruneCodeStore` 14,536 s (all before 2026-11-15 05Z, releases before 0.1.511), sliced 9,014 s; 0-row holds 21,228 s |
| squeal `store.sqlite` | 15,604 | 476 ms, 1.4 s, 32.0 s | 2,651, 661, 96 | 11,172 s | tier records 5,318 s; closures 3,468 s; reconciliation 1,339 s |
| squeal `code.sqlite` | 2,554 | 460 ms, 1.9 s, 14.4 s | 348, 252, 67 | 2,223 s | prune slices, 1,452 s of 0-row holds |

Busy notes (D2's retried path): cezar 74,673 episodes (p50 0.7 s, p90 7 s, p99 64 s), squeal 10,586 (p50 0.5 s, p90 2.4 s); most waited: the next tier, the heartbeat, consumer expiry, hooks' writes. Writes that still failed "database is locked": `complexity:` 4,692 on cezar and 646 on squeal (logged; the next pass counts again), and 139 others (shutdown marks, `setDaemon`, optimizer and merge-hold notes), 101 of them on 2026-11-15 and 14 since 2026-11-17.

**The prune [read in source code, exp].** Every daemon prunes the shared store, then the code store, 60 s after start and every hour (`src/core/daemon/lifecycle.ts:261,471`): a clone with N daemons prunes N times an hour plus once per daemon start. Each slice is `DELETE ... WHERE (key) IN (SELECT key ... WHERE <condition> LIMIT 256)` inside the write transaction (`src/core/code/store/prune.ts:223`); the main store's `dropOrphanLoadedModules` and checks delete have the same shape. `explain-prune.mts` (`out/explain-prune.txt`; an empty database with the code store's schema, so no statistics): the `views`, `counts`, `coverage` and `checks` conditions each scan a whole table, `checks` three more. A slice that deletes nothing still scans under the lock: 0-row holds of 1.5 to 2 s, up to 18 s at load.

**25-minute windows from the logs** (`log-windows.mjs`, `out/log-windows.txt`). Logged holds on one store never overlap, so their sum per window is a lower bound; in window 1 they were about three quarters of cezar's store hold time.

| Store | Since 2026-11-14 16:15Z: over 50% (max) | Without prune | Since 2026-11-16: over 50% (max) | Without prune |
|---|---|---|---|---|
| cezar `store.sqlite` | 11 of 268 (101%) | 10 (93%) | 4 of 192 (92%) | **3 (91%)**: 2026-11-16 00:00Z, 11-18 22:50Z, 23:15Z |
| cezar `code.sqlite` | 12 (99%), all 2026-11-15 00:35Z to 03:30Z | 0 (2%) | 0 (14%) | 0 (1%) |
| squeal `store.sqlite` | 0 (22%) | 0 (20%) | 0 (20%) | 0 (18%) |
| squeal `code.sqlite` | 0 (4%) | 0 (2%) | 0 (4%) | 0 (2%) |

By hour (UTC, 2026-11-15 to 11-18), cezar's store is busiest 20Z to 00Z (20 to 52% by long holds alone; 2026-11-15 weighs most) and 09Z to 14Z (9 to 12%).

### Q4. D16 applied

D16: propose one daemon per clone if daemons wait on each other's lock in more than 5% of main-thread samples, or the lock is busy more than half of a 25-minute window. Busy wait is measured per clone; per store it is bounded: the "both held" samples can be either store.

| Store | Busy wait on it (w1; w2) | Lock busy | D16 | D16 with prune holds removed |
|---|---|---|---|---|
| cezar `store.sqlite` | 0.2 to 1.2%; **3.7 to 7.5%** | 11.5%, 28.3%; logs: 3 evening windows over 50% | **met** by the logs' lock windows; busy wait near | **met**: 22.8%, busy wait 2.5 to 6.3%, 3 log windows over 50% |
| cezar `code.sqlite` | 0.8 to 1.8%; 2.4 to 6.2% | 29.6%, 42.2% (56% in one 5-minute bucket); logs: none since 2026-11-16 | near, not met | not met: 28.7%, 1.5 to 5.3% |
| squeal `store.sqlite` | 0.1 to 4.6%; 1.9 to 2.4% | 10.4%, 10.0%; logs: max 20% | not met | not met |
| squeal `code.sqlite` | **4.2 to 8.7%**; 1.4 to 1.9% | 46.5% (70% in the last 5 minutes), 24.8% | met on busy wait in window 1 at its upper bound; near on lock | 3.9 to 8.4%: met only at the upper bound |
| Per clone | cezar 2.0%, **10.1%**; squeal **8.8%**, 3.9% | | **met** on both clones | **met**: cezar 5.9%, squeal 7.9% |

### Q5. Recommendation

**Propose one daemon per clone to the human** (`daemon-model.md` Q2 (a), as D16 says). The gate holds on both clones, in the daytime and in the evening, and holds without the prune. The reason sits in Q1: per daemon present, held time did not fall after Parts 1 to 4. The remaining holders are each daemon's own work on shared files: tier records, ledger commits, revision apply's closures (p50 1.3 s, max 29 s), tier starts, short code-store writes. Busy wait grows with the number of daemons at work (2% at 4, 10% at 8 on cezar). Shortening those transactions shortens holds; it does not stop N processes polling one lock. One writer per clone turns the waits into a queue in one process.

**Fix the prune first, in its own row, whatever the human decides.** It is the largest single holder: 13.5 of 42.2 points of cezar's code lock and 5.5 of 28.3 of its store lock in window 2, 4.2 of 10.1 points of busy wait, and all seven logged holds of 10 s or more (12 to 18 s, code-store prune slices). Two defects, both in source: every daemon prunes the shared files (once per clone per interval would do), and each slice searches a whole table while it holds the write lock (search first, outside the lock, then delete by key and test again under it). One daemon per clone fixes the first defect but not the second.

What neither fixes: hold length under host load, and the 4,692 `complexity:` writes that still fail and wait for the next pass on cezar.

## Open questions

1. Which operations make the short code-store holds (squeal, window 1): not logged under D3's 250 ms. A count of every write transaction per operation would name them.
2. Whether a hold grows with host load (synchronous work in a transaction, descheduled): not determined. It decides whether one writer shortens holds or only queues them.
3. Busy wait per store stays a range: in 3.8% (cezar, window 2) and 4.5% (squeal, window 1) of samples both stores were held by others.

## Sources

- `spec.md` D3, D15, D16; `status.md` (2026-11-11 to 2026-11-14); `store-contention.md` Q3; `daemon-model.md` Q1; probes `store-contention/lock-watch.mjs`, `daemon-model/wchan-sample.sh`.
- Source at `a45e88372`: `src/core/store/long-write.ts`, `busy.ts`, `connection.ts`, `open.ts`; `src/core/daemon/lifecycle.ts`, `sliced-prune.ts`, `daemon.ts:851`; `src/core/code/store/prune.ts`, `schema.ts`; bundles `~/.claude/plugins/cache/hearsay/squeal/<version>/dist/cli/squeal.mjs`, 0.1.488 to 0.1.566, to name anonymous frames.
- Live, read only: `/proc/locks`, `/proc/<pid>/task/<pid>/{stat,wchan}`, `squeal ps`, `~/projects/{cezar,squeal}/.git/squeal/logs/daemon-*.log{,.1}`.
- Probes `probes/one-daemon-gate/`: `wchan-watch.mjs`, `summarize-locks.mjs`, `summarize-wchan.mjs`, `long-writes.mjs`, `logs-summary.mjs`, `log-windows.mjs`, `explain-prune.mts`; outputs in `out/`.
