# 001-362 notes: a daemon start beside long writers fails before ready

005-52's full run on `7f1acb09` failed `test/daemon/busy-store.test.ts:83`. The daemon of start 1 exited 1 with "could not start serving: database is locked" (its notes held only that one note, so starts 2 and 3 never ran). The cause is the test, not the product: its two writers raced for the lock and could leave it free for less than SQLite's busy handler can use, for minutes on end. The repair gives the writers a shared schedule. No product code changed.

## The failing statement (measured)

It is `#register`'s `BEGIN IMMEDIATE` (`Connection.transaction`, `src/core/store/connection.ts:43`, called from `src/core/daemon/daemon.ts:178`). It fails with errcode 5, a plain `SQLITE_BUSY`, after the full 120 s busy timeout: 120,571 ms. It is not `SQLITE_BUSY_SNAPSHOT` (517) or `SQLITE_BUSY_RECOVERY` (261).

Evidence: a temporary log line in `Daemon.start`'s catch (not committed) printed errcode, errstr, elapsed time and stack. The run used `starts.probe.ts` with `PROBE_POLL_MS=1`: real daemon starts beside two writers that hold 7 s, rest 1 s and retry every 1 ms (`poll-writer.ts`).

```text
squeal daemon: PROBE after 120571 ms errcode 5 errstr database is locked stack Error: database is locked
    at Connection.transaction (…/dist/core/store/connection.js…)
    at Object.transaction (…)
    at #register (…/dist/core/daemon/daemon.js…)
    at Daemon.start (…)
squeal daemon: could not start serving: database is locked
squeal daemon: shutdown: setDaemon failed: database is locked
hold 7000 rest 1000 poll 1 writers 2: 1 of 1 starts failed
```

The text is the same as in 005-52. The start failed at 120.6 s and exited at 362 s: its shutdown's note and its `setDaemon(null)` waited out the start's 120 s timeout too. An earlier run with the same writers (1 start) had not exited within 300 s.

## The hypotheses refuted (read in source, measured)

- **A busy that skips the busy handler.** SQLite 3.53.4 is Node 24.21's build; its compile options have no `ENABLE_SETLK_TIMEOUT`. In its source, `btreeBeginTrans` (`src/btree.c`, version-3.53.0) calls the busy handler for every `SQLITE_BUSY`-class result while the connection has no transaction (`inTransaction == TRANS_NONE`). It also turns `SQLITE_BUSY_SNAPSHOT` into `SQLITE_BUSY` in that case. So `BEGIN IMMEDIATE` from autocommit always waits. It returns busy without waiting only while another statement on the connection still holds a read. Measured: an unfinished `iterate()` makes `BEGIN IMMEDIATE` fail at once with 517. `get()`, `all()`, `exec()` and pragma reads reset and leave nothing. `src/` has no `iterate()`, and every statement goes through those calls, so nothing on the start path holds a read.
- **A connection at 5 s.** Only `daemon.ts:435` lowers the serving connection's timeout, after ready. The front desk opens no store connection. The start path between the open and `#register` touches the store only through that connection.
- **A coarse busy handler.** Measured: a waiter took a lock freed at 1,051 ms after 1,030 ms of its own wait, so the busy handler sleeps in fractions of a second (`HAVE_NANOSLEEP`), not whole seconds.
- **The store-level start alone.** `probe-store.ts` ran `openDaemon`'s serving open plus `#register`'s writes 200 times beside the long writers (hold 300 ms, rest 20 ms): 0 of 200 failed.

## The cause: a waiter SQLite never lets in (measured, then inferred for 005-52)

SQLite queues no waiter. After its first 228 ms, a waiter in the default busy handler tries again every 100 ms of nominal time, and a lock freed between two tries goes to whoever asks first. The old `long-writer.ts` retried every 250 ms with a 0 busy timeout. Of the two writers, the resting one rests 1 s, so the other takes the lock at its next retry. The gap a waiter can use is therefore the time from one writer's commit to the other writer's next retry.

Hold (7,000) and rest (1,000) are both multiples of the retry (250). So two consecutive gaps add up to the other writer's drift over its ~24 retries in the hold, D, modulo 250: u1 + u2 ≡ D. When one gap is shorter than D, the next is too, and the gaps stay small until jitter breaks the run. A waiter that misses about 17 gaps in a row, one per 7 s cycle, has used up its 120 s.

Measured with `gaps.ts` (a timestamped copy of the old writers) at the test's 7,000/1,000 timing:

| run | gaps | in order (ms, first 24) | under 10 ms | under 25 ms |
| --- | --- | --- | --- | --- |
| load 15 to 23 | 39 | 20 239 18 250 11 7 249 10 248 5 249 6 249 11 247 16 239 19 237 17 240 16 246 13 | 6 | 21 |
| load 30 to 80 | 119 | 10 248 19 242 16 243 16 248 25 242 32 229 41 226 38 220 49 208 73 200 82 191 86 191 | 1 | 5 |

The same old writers, sampled by `free-stretches.ts` (an observer that takes and drops the lock every 5 ms), were free in 45 stretches between 40 holds, at load 34:

```text
5 245 6 243 0 5 0 5 243 5 242 67 175 71 179 67 174 66 179 65 184 48 207 41 201 42 197 48 210 41 205 46 211 30 205 46 215 45 208 55 200 42 210 44 211
```

`0 5 0 5` is four small gaps in a row. A 100 ms waiter hits a 5 ms gap about 1 time in 20. With retries every 1 ms the gaps stay under 2 ms for good, which is the 1-of-1 reproduction above.

The unchanged test at its own timing passed 30 of 30 starts in one `starts.probe.ts` run, from 12:24 to 12:42 at loads 7 to 82 (measured). Two short-hold runs (400 ms, rest 30 ms) passed 25 of 25 (measured). So the failure needs the small-gap regime to last about 2 minutes, which is rare, as 005-52's single failure in several gates suggests. That 005-52 hit this regime is inferred, not measured: its run did not record the errcode or how long start 1 waited. It is the only mechanism found that fits the evidence: a plain busy, at `#register`, under a 120 s timeout that cannot run out against writers that leave the lock free for long.

## Fix (`test/daemon/long-writer.ts`, `test/daemon/busy-store.test.ts`)

The coordinator asked to keep two writers. They now take turns on one schedule from a shared `epochMs`: slot s is writer `s % writers`'s, starts at `epochMs + s × (holdMs + restMs)`, and holds until `holdMs` into the slot. A hold always ends at its slot's fixed time, so the lock is free `restMs` between any two holds by construction. A writer that is late for its slot (start-up, a daemon's write in the way) holds a shorter time; the gap does not shrink. The writers wait with a 60 s busy timeout, behind the daemon's short writes, where they used to poll at 0. The test passes `turn`, `WRITERS` (2) and an epoch 2 s ahead; the test's name, 7 s holds, 1 s rests and 3 starts are kept.

Measured with `free-stretches.ts` on the new writer, 12 holds at load 89:

```text
free stretches (ms): 990 992 990 988 990 990 996 984 990 988 984 980
```

The old writers' longest stretch was 245 ms; the new writers' shortest is 980 ms. A start now waits at most about one hold. The test took 43 s instead of 179 s. It still tests 001-161's subject, a start that waits longer than the old 5 s timeout. As before, a start that arrives with less than 5 s of a hold left would also have passed under the old timeout.

## 001-346 (inferred)

001-346 is a different mechanism. The optimizer note is written after ready, at `DAEMON_BUSY_TIMEOUT_MS` (5 s), and a 7 s hold outlasts that timeout without any starvation. The new schedule does not change that: a note written within the first 2 s of a hold still waits more than 5 s. So it is not this row's one-line cause, and this row does not fix it. With the old writers, starvation made it likelier, since a note had to win a race for the lock as well.

## Could short real writers starve a start for 120 s? (measured, for the coordinator's row)

Squeal's writers wait in the same busy handler and hold the lock for milliseconds (D8; 001-161 brought a tier's apply to under a second). Against them, a start is one waiter among equals, not one that loses every race. Measured with `short-writers.ts`: a waiter with a 120 s timeout took the lock 20 times beside writers that keep it busy.

| writers | hold, pause (ms) | waits (ms) | median | longest |
| --- | --- | --- | --- | --- |
| 4 | 20, 5 | 9 1433 19 9 0 830 34 530 430 1 18 1631 54 2 2734 430 530 530 430 8 | 430 | 2,734 |
| 8 | 50, 0 (back to back) | 2536 179 1233 129 9339 229 12154 13047 2132 10246 5354 2246 531 12497 14493 9 4444 6060 737 7771 | 4,444 | 14,493 |

Many short writers on a shared store can delay a start by seconds, at most 14.5 s in 20 waits even with the lock busy all the time. They could starve it for 120 s only if that saturation lasted the whole 2 minutes and the start lost every race in it. SQLite's lack of a queue makes that possible but not bounded. The same saturation would fail a ready daemon's 5 s writes about half the time (median 4.4 s), so it would show up there first, as 001-346 does. If the coordinator wants a start that cannot lose those races, that is a product row: for example, the start polls `BEGIN IMMEDIATE` itself every few milliseconds up to its 120 s, as `switchToWal` already does. Even that still loses to a writer that retries every millisecond.

## Spec

D8 and D10 need no change: no product behaviour changed. If the coordinator wants D8 to state the limit, a draft sentence: "SQLite queues no waiter, so a busy timeout bounds a wait only while the lock is free for longer than the busy handler's 100 ms retry; writers that hand the lock to each other directly can keep a waiter out for its whole timeout (task 001-362)."

## Probes (this folder; none run in the suite)

- `starts.probe.ts` with `vitest.probe.config.ts`: real daemon starts beside the writers. Hold, rest, writer count and start count come from `PROBE_*` variables; `PROBE_POLL_MS` selects `poll-writer.ts`. Run with `npx vitest run --config docs/specifications/001-core-loop/tasks/001-362/vitest.probe.config.ts`. It uses the test's builds and fixtures only.
- `poll-writer.ts`: the old writer with its retry interval as an argument.
- `gaps.ts`: the old writers' gaps, timestamped by the writers.
- `free-stretches.ts`: the free stretches of `test/daemon/long-writer.ts`, or of `PROBE_WRITER`. The old writer must run as an `.mts` copy outside the repository, since it has no schedule arguments.
- `short-writers.ts`: a 120 s waiter's waits beside many short writers.
- `probe-store.ts`: the start's store work alone, beside the writers.

All of them work only in a temporary directory given as an argument, or in the test's fixture.

## Verification

`test/daemon/busy-store.test.ts` with the fix, 10 runs in a row from 14:21 to 14:35: 10 of 10 passed, 43 to 115 s each. The one-minute load was 83.7 at the start of the first run and 22.7 at the end of the last, peaking at 145 between them. Before that, 4 of 4 load-gated runs had passed, 43 to 59 s each. The full suite, `npx vitest run --maxWorkers=4`, started at load 21.8 and ended at load 8.1: 478 files passed, 1 skipped, 4,056 tests passed, 10 skipped, 515 s.
