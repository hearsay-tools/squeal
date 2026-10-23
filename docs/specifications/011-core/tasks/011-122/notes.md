# 011-122: where `busy-edit.test.ts` spends its time after the lock frees

Wave 19 W3, worker 61519d18, from main f9e09794e (0.1.271). Shape: survey, then repair. The busy-store rule the brief calls C9 is in C7 (the D8 paragraph that ends "Measured by `test/daemon/busy-edit.test.ts`"); C9 has no sentence on a busy store.

## Answer

In 21 instrumented runs of the test as it was (16 beside a locked full suite, 5 before the load sampler ran), the edit's revision landed 11 to 277 ms after the writer's commit returned. No run came within 700 ms of the 1,000 ms bound. One phase makes the spread: the retry's backoff pause. A pass that is in its 250 ms busy slice when the lock frees stores the revision 11 to 47 ms later. A pass in the 250 ms pause between attempts stores it 188 to 277 ms later. After the pause, the pass's own work takes 20 to 40 ms.

A tier that records during the hold changes how the hold looks, not the time after it. The pump's writes keep the 5 s busy timeout (C7), so a record, then its requeue's commit, then the next selection's lookup held the event loop for up to 10 s in one stretch. The revision still landed 83 to 206 ms after the free. With the record at the start of the hold, the edit's batch was debounced only after the free, so its pass never met the busy store, and the busy note named no revision. That is the wave-4 line-144 failure (`reviews/wave-4.md`, "observed note ... 5 files of a tier queued again, the heartbeat"), reproduced 3 of 3.

The two bound misses (4,030 ms in `reviews/wave-2b.md`, 3,469 ms in `reviews/wave-4.md`) are not reproduced. Both came from a Squeal background baseline run beside a review's locked full suite, at load 34 to 58. A locked full suite alone loads this host to 3 to 8. No phase grew with load here: the pause is at most 250 ms by design, and every other phase stayed under 120 ms in every condition. So the 3 to 4 s are in a phase that this load does not stretch. Two candidates stay unmeasured. The writer may free the lock late (a late timer, or a slow sync of its `synchronous=FULL` commit under I/O load); the test counted that lateness as the daemon's, because it timed from the planned end of the hold. Or in-process Vitest work on the daemon's main thread may compete with the pass after the free, at a load this host did not reach. Squeal's store holds 21 results of the file since 2026-10-21: all pass (`squeal why test/daemon/busy-edit.test.ts`, 2026-10-23).

## Phases after the lock frees

Times in ms. "Due" is the writer's planned end of the hold (`epoch + 12,000`), the test's old reference; "freed" is the writer's own `Date.now()` after `COMMIT` returned.

| Condition | Runs | Load (1 min) | Freed − due | Revision − freed | Heartbeat − freed | Pass in its slice at the free | Pass in its pause at the free |
|---|---|---|---|---|---|---|---|
| Plain, beside a locked full suite | 16 | 3 to 8 | 2 to 12 | 11 to 277, median 188 | 3 to 65 | 8 runs: 11 to 47 | 8 runs: 188 to 277 |
| Plain, before the sampler | 5 | 10 to 22 | 6 to 8 | 11 to 243 | 1 to 167 | 2 runs: 11 to 14 | 3 runs: 218 to 243 |
| Baseline recorded at the hold's start (slow test 2 s) | 3 | 3 | 7 to 11 | 166 to 206 | 90 to 115 | no pass before the free: 3 runs | |
| Baseline recorded mid-hold (slow test 6 s) | 3 | 3 to 4 | 6 to 8 | 108 to 185 | 17 to 101 | 1 run: 135 | 2 runs: 108 to 185 |
| Baseline record spans the free (slow test 11 s) | 3 | 3 to 4 | 7 to 8 | 83 to 123 | 50 to 107 | 2 runs: 117 to 123 | 1 run: 83 |
| Daemon pinned to 2 CPUs beside 2 busy loops | 5 | 4 to 6 | 1 to 7 | 83 to 128 | 25 to 83 | 3 runs: 83 to 128 | 2 runs: 84 to 114 |

Every run but the "before the sampler" set had a locked full run alive throughout (another worktree's flocked `vitest run --maxWorkers=4`; sampler `full=1` in each run's window, `data/load.log` and `data/load-host.log`). My own locked suite waited behind it, and I cancelled it before it took the lock.

The plain runs' phases after the free (16 runs beside the suite):

| Phase | What it is | Min | Median | Max |
|---|---|---|---|---|
| Pause | the retry's backoff pause left after the free (`BatchRetries`, `busyBackoffMs` 250 ms from attempt 2) | 0 | 160 | 245 |
| Feed prelude | the retried pass's `reconcileNow` before the scheduler: `git status` 6 to 9 ms, the watch spec's rebuild 12 to 18 ms, the candidates' walk under 1 ms | 0 | 18 | 24 |
| Scheduler mutex | `#lock.run` wait | 0 | 0 | 0 |
| To the transaction | `confirmHeld`, `#adopt`, `diffBatch`, then `readHead` (`git rev-parse` and `git status`, 9 to 16 ms) | 0 | 10 | 12 |
| Transaction | from the batch's diff to `createdAt`: the lock (an `IMMEDIATE` begin) and a body under 3 ms | 0 | 11 | 47 |
| Event-loop stalls inside the window | gaps over 40 ms | 0 | 16 | 47 |

The retry runs 19 or 20 times during the hold. Each attempt is the feed's prelude (about 30 ms), the slice (250 ms, the event loop held), then the pause (250 ms). The heartbeat's and expiry's sliced writes take the gaps, so the event loop is held for most of the hold. When the lock frees, whatever is in its slice takes it within SQLite's busy-handler sleep (up to 50 ms near a slice's end): a run with the pass in its slice stores at once, and a run with the timers in their slices lets the pause run out first.

### With a tier in the hold

The fixture daemon reports `ready` before its baseline tier runs. At this host's load the baseline records in 300 ms, before the hold. At high load it does not: pinned to 2 CPUs, the baseline was in flight during the hold in 5 of 5 runs, and the pump gave up in 4. The probe's slow test file puts it there on purpose. Then:

- The record's transaction waits its 5 s and fails (`database is locked`). The pump stalls with "N files of a tier queued again", and `#requeue`'s `Ledger.commit` waits another 5 s. After the resume, `selectTier`'s lookup writes a result's last use (`acceptedAt`, outside a transaction) and waits again. The longest event-loop stall was 10,015 ms (slow 2 s), 7,348 to 7,898 ms (slow 6 s), and 2,752 to 6,450 ms (pinned).
- While the loop is held, no timer runs and no watch event is handled. With the record at the hold's start (slow 2 s), the edit's debounce timer was due before the free (the loop was held from 1,350 ms before it to 100 ms after) and fired 102 ms after it. The pass ran 189 ms after the free and stored at once, so it never told `BusyWaits` it waited. The episode closed on the pump's, heartbeat's and expiry's retries, and the note named "6 files of a tier queued again, the heartbeat, consumer expiry": the test's note assertion (line 144 in wave 4, 145 at f9e09794e, 168 now) failed 3 of 3.
- A 5 s write that is waiting when the lock frees takes it first (the record in the 11 s case, 49 to 106 ms after the free; a requeue's commit or a tier start in the others). The pass follows it, 83 to 206 ms after the free.

## Repair (commit b8130baa8)

Test-side only. No phase in the daemon is a cause of a miss here, so `src/` is unchanged.

1. The hold starts once the baseline has recorded (`readHeader` counts: 5 current, 0 pending, as `unused-stop.test.ts` waits). This removes the "tier in the hold" phase above, and with it the 5 to 10 s event-loop holds and the wave-4 note failure. A tier recording in a hold is the pump's case, which `test/scheduler/busy-record.test.ts` covers. It is not this test's subject, an edit's pass.
2. Both bounds count from the writer's `freed <epoch ms>` line, which it now prints as each commit returns. This removes the writer's own lateness from the measure: 1 to 12 ms here, unmeasured at load 34 to 58. The bound stays 1,000 ms, spec 001's "within a second of the lock freeing".
3. Each bound's failure message gives the due and the freed time and the notes, so the next miss names its share: the writer's (freed − due) or the daemon's (revision − freed).
4. The writer ends a sleep on SIGTERM. Before, it slept out its 600 s rest, and `stopProcess` waited its 60 s grace before SIGKILL, so each run of the file took about 77 s (median of Squeal's 21 results). Now it takes 17 to 19 s.

Verified: 20 of 20 runs of the repaired test beside my own locked full suite (`flock ... vitest run --maxWorkers=4` in this worktree), load 3 to 5, 19 s each with the CLI build. See "Verification".

## Proposed for the spec (spec text is not mine)

C7's last D8 sentence on the busy store now reads: "Measured by `test/daemon/busy-edit.test.ts`: beside a 12 s hold, an edit's revision lands 146 ms and a heartbeat 44 ms after the lock frees, and every ping is answered within 1 s". Proposed: "Measured by `test/daemon/busy-edit.test.ts`, whose hold starts once the baseline has recorded and whose bounds count from when the writer's commit returns: beside a 12 s hold, an edit's revision lands 11 to 277 ms and a heartbeat 3 to 65 ms after the lock frees (16 runs beside a locked full suite, row 011-122), the spread being the retry's 250 ms pause, and every ping is answered within 1 s." The bound stays 1,000 ms.

## For the next row

- A miss of the repaired test: its message names the writer's and the daemon's shares. If the daemon's share passes 1 s, run the probe below at the load that miss had (a Squeal baseline beside a locked full suite), so its log names the phase. No row before a miss, because none recurred in 21 results since 2026-10-21.
- The pump's writes keep 5 s (C7). Chained, they held the event loop 10 s during a hold, and an edit's batch waited until the lock freed. C7 states its "never holds its event loop for long" for the retried writes only. If a 10 s hold of the event loop matters, a row could slice the pump's writes as the feed's are: `src/core/scheduler/scheduler.ts` (`#record`, `#requeue`, the selection's lookup), `busy-resume.ts`. It would change C7.
- The pause phase: a pause that ended when the lock frees (a `BEGIN IMMEDIATE` with no busy wait every 25 ms or so) would cut the 250 ms spread to about 25 ms. The bound does not need it. It would change `src/core/watcher/batch-retry.ts` (`BatchRetry.delayMs`), outside this row's seam.

## The probe, to run it again

`probe/` holds the tools. `data/` holds each run's summary line (`<condition>.jsonl`: `quiet` is "before the sampler", `loaded` is "plain, beside a locked full suite"), the load samples, the 20 verification runs (`verify.log`), and three timelines: a pass in its pause at the free (`timeline-plain-pause.txt`), the record at the hold's start (`timeline-slow2.txt`) and mid-hold (`timeline-slow6.txt`). The full event logs (1.5 MB) stay in this worker's scratch directory, `.ai/cezar/t/61519d18/results/`, until the review passes.

1. A copy of the tree, not a worktree: `git archive <commit> | tar -x -C <copy>`, then `ln -s <worktree>/node_modules <copy>/node_modules`. The copy is never watched, so the instrumented code never reaches a branch or a Squeal daemon.
2. `node probe/instrument.mjs <copy>` adds `probe.ts` to `src/core/` and timestamps every write transaction (the lock wait, body, commit, and the calling frames), each write outside one, the feed's reconcile phases, each retry, the scheduler's batch, the pump's tier fly, record and stall, the sliced timer steps, `BusyResume`, `BusyWaits` and `readHead`. It also starts an event-loop stall monitor (a 10 ms interval; gaps over 40 ms). Each line goes to `$SQUEAL_PROBE_LOG`. Each edit asserts that its anchor matches once, so a changed source fails loudly.
3. `patch -p1 -d <copy> < probe/probe-test.patch` (made on f9e09794e's test files, before this row's repair). It gives one summary line per run, `PROBE_REPEAT` runs in one file (one CLI build), `PROBE_SLOW_MS` (a fixture test that sleeps, so the baseline tier is in flight in the hold) and `PROBE_TASKSET` (the fixture daemon's process tree pinned to those CPUs). The writer prints `took`, `committing` and `freed`, and ends its sleep on SIGTERM.
4. `RESULTS=<dir> probe/load-sampler.sh <label>` in the background; then `PROBE_ROOT=<copy> RESULTS=<dir> probe/probe-loop.sh <label> <repeat> <rounds>`, or `pinned-loop.sh` with `CPUS` and `HOGS`. Run them beside a locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`.
5. `node probe/analyze.mjs <dir>/<label> --load <dir>/<label>/load.log` prints one row per run and a summary. Its columns: `late` = freed − due; `daemon` = revision − freed; `state` at the free (`running`: the storing pass began before it; `pause`: it was in the backoff pause; `no pass yet`); `pause`, `prelude`, `mutex`, `toTx`, `tx`: each phase's share after the free; `stalls`: event-loop stalls inside the window; `firstWriter`: the first write after the free; `pumpBusy`: the pump gave up; `flyDuringHold`: a tier flew or recorded in the hold.

`probe/fsync-probe.mjs <dir> <n>` times a WAL commit with `synchronous=FULL`, the writer's: 0.56 to 1.28 ms (median 0.68) on this host's NVMe disk at 03:15Z, with I/O pressure at 0.

## Verification

- The repaired test, `npx vitest run test/daemon/busy-edit.test.ts` in this worktree at b8130baa8, 20 times in a row, 03:18:31Z to 03:24:48Z, beside my locked full suite (started 03:18:29Z, `full=1` in every sample): 20 passed, 0 failed, each run 18 to 20 s wall (CLI build included), 1-minute load 3.36 to 5.05. Before the repair the file took about 77 s.
- Squeal's own runs of the changed files at revision 6: `busy-edit.test.ts` PASS in 17,392 ms, `busy-store.test.ts` PASS.

