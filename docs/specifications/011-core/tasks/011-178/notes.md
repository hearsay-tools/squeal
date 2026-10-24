# 011-178: `backlog-slots.test.ts` checks the slot schedule by events, not by the wall clock

Worker 0b0387ed, wave 31 W9, from main at 36ee11d02 (after 0.1.291), 2026-10-24. Shape: repair (test). Only `test/scheduler/backlog-slots.test.ts` changed; `slots-fixture.ts`, `timed-runner.ts` and `src/` did not.

## 1. Why the two bounds failed on a loaded host

Both bounds measured each file's process, and a loaded host stretches a process's start and exit by seconds:

- Test 1 compared the makespan of the files' processes (`performance.timeOrigin` to exit) with list scheduling of the same spans. The gap between one process's exit and the next one's time origin holds the node:test runner's own `node --test` start, the child's spawn and the report's parse. At load 34 to 94 the reviewer measured 33.6 % and 41.5 % over, against a 15 % bound.
- Test 4 bounded the waiter's whole wait by one slot's file plus 1 s (3,000 ms). That wait is the remaining time of the slots in flight, which also holds their processes' start and exit. The reviewer measured 5,192 and 5,350 ms.

At load 63 here, before the change, the old figures were 18.2 % (red) and 2,995 ms (5 ms from red). With a barrier mutation (section 3) the old makespan figure was 19.0 %: at this load it no longer told a barrier from slots.

## 2. What the checks assert now

Both read the scheduler's own records: `TimedRun.start` (the scheduler's `run` call) and `TimedRun.end` (its return), from `timed-runner.ts`. The time from a run's return to the scheduler's next `run` call, or to the waiter's grant, is this process's own step: the pump's checks, the lock, and the waiter's look. A loaded host stretches it by tens to a few hundred ms (at most 172 ms in section 4), not by seconds.

Test 1, "no slot idles while a file is queued" (`refills` in the test file):

- Each run holds one file, and the 16 runs cover the 16 paths.
- Starts and ends are sorted. The k-th start after the first W takes the place the (k − W)-th end freed; the first W take the places free at the first start. For each start, `idleMs` is how long its place stayed free, and `passed` is how many other places freed in that time.
- No start has `passed > 1`. Two ends inside one refill step are tolerated (they happen when two slots return together); a barrier that waits for every slot of a tier makes the first refill of each tier pass 3.
- `idleMs ≤ REACT_MS` (1,000 ms) for every start: the loose wall-clock bound, on this process's step only.
- The widest overlap of the runs is 4 (it was the processes' spans). Progress steps ≥ 8 and every file settled stay as they were.
- The processes' makespan against list scheduling (the 5 % figure of 011-21 done-when 1) is still logged, not asserted.

Test 4, "the waiter is granted at the next slot release":

- `holding` is the holder's runs in flight right after the waiter's first refused `acquire(2)`; `released` is the first of their ends. The test waits for that end in the run records.
- The waiter looks `LOOK_MS` (250 ms) after `released`, then every `LOOK_MS`. The holder's pump refills a slot in tens of ms, so a holder that takes back the permit it returned has done so before the waiter looks. A free-running poll would let the waiter win that race now and then.
- Each holder run started between the refusal and the grant is counted with the holder's runs in flight at its start. None may be above 2, the holder's fair share of 4 permits with a waiter that wants 2. Refills up to 2 are the pool's max-min sharing: the four first slots run 2 s files that start together, so they often end before the waiter looks, and the holder refills two of them (`refilled to 2 2` in the log).
- `grantedAt − released ≤ REACT_MS`: the share came on the waiter's first look after that release, not one tier later.

`REACT_MS` is 1,000 ms. In the 20 runs at load 38 to 102 (section 4) the slots idled at most 172 ms and the waiter got its share 260 to 405 ms after the release, `LOOK_MS` included. One slot's file is 1 to 5 s, so a barrier's or a skipped waiter's wait is longer.

## 3. Red against a scheduler that idles a slot or skips the waiter

Mutations in a scratch copy of the tree (`git archive HEAD` under the task's scratch folder, `node_modules` linked), so the Squeal daemon of this worktree did not re-run `src/` dependants. Not committed.

| Mutation | Where | Result |
|---|---|---|
| M1 barrier: a slot that ended waits, before it records or returns its permit, until every slot of its lane ended | `scheduler.ts` `#fly`, after `executeTier` | test 1 red: `expected [ { idleMs: 1487, passed: 3 }, …(5) ] to deeply equal []`; passed `0 0 0 0 3 2 1 0 3 2 1 0 3 2 1 0`, idle up to 1,487 ms, 3 progress steps. Old makespan figure 19.0 %. Load 62 |
| M1 first draft: the barrier only while the slot recorded | same | green, idle 32 to 69 ms. Not a barrier: a flight leaves `#inFlight` after its record, so its place freed anyway |
| M2 skip the waiter: every `acquire` takes `#take(wanted, 0)`, ignoring shares, reserve and gate | `pool.ts` `acquire` | the first test 4 (no refill before the grant, 50 ms then 250 ms free poll): red 3 of 3 at load 57 to 66. The final test 4: red 3 of 3 at load 33 to 36, `refilled to 4 4 4 4 4 4 4 4 4 4 4 4`, grant 5,347 to 7,871 ms after the first release |

Not caught, and not caught before either: a slot that returns its permit only after its record (25 ms gather plus a commit on this small store, about 50 ms a refill). On the critical path that is about 1 % of the makespan; the old 15 % bound did not see it, and at cezar's 340 ms commits it would still be below `REACT_MS`. `backlog-slots-overhead.test.ts` and `slot-records.test.ts` cover the record's cost.

## 4. Runs beside load

### First batch: test 4 too strict

The first version of test 4 forbade any holder refill before the grant. Runs 1 to 3 passed at load 67 to 76; runs 4 and 5 failed at load 74 to 81 with `expected [ 'nt/test/w04.test.mjs' ] to deeply equal []`, the grant 260 and 194 ms after the release. The holder had refilled to its share of 2 after several of the four first slots ended between two looks: correct sharing, a false failure. The batch was stopped and test 4 changed to the form in section 2 (commit f5cb00f0b). Test 1 passed in all five runs (idle at most 44 ms; other slots freeing meanwhile at most 1); the old makespan figure in those runs was 10.1 to 23.1 %, red under the old 15 % bound in two of five, and the old waiter figure 2,545 to 4,060 ms, red in three of five.

### Second batch: the final tests

20 runs in sequence of the whole file (tests 1, 2 and 4), `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/scheduler/backlog-slots.test.ts`, at f5cb00f0b, 2026-10-24 11:50 to 12:06 UTC. The load is the host's own: other projects' tests, about 40 to 100 on 24 CPUs; no load loop was added. The two "old" columns are what the replaced bounds measured, from the same runs.

| Run | UTC | Load (1 min) | Exit | Old: processes over list scheduling (bound 15 %) | Max slot idle ms (bound 1,000) | Most other slots freed in one refill (bound 1) | Progress steps (bound 8) | Old: waiter's whole wait ms (bound 3,000) | Grant after release ms (bound 1,000) | Holder refilled to (bound 2) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 11:50:38 | 42 to 49 | 0 | 32.5 % | 39 | 0 | 14 | 5128 | 273 | none |
| 2 | 11:51:34 | 49 to 47 | 0 | 28.9 % | 33 | 0 | 15 | 3933 | 262 | none |
| 3 | 11:52:12 | 47 to 44 | 0 | 8.6 % | 18 | 0 | 15 | 2911 | 264 | none |
| 4 | 11:52:54 | 44 to 49 | 0 | 16.0 % | 17 | 0 | 15 | 2998 | 271 | none |
| 5 | 11:53:43 | 49 to 66 | 0 | 21.1 % | 32 | 0 | 14 | 3778 | 262 | none |
| 6 | 11:54:43 | 66 to 75 | 0 | 19.5 % | 172 | 1 | 11 | 4611 | 322 | 2 2 |
| 7 | 11:55:42 | 75 to 102 | 0 | 27.6 % | 100 | 0 | 15 | 3917 | 265 | none |
| 8 | 11:56:36 | 102 to 94 | 0 | 18.2 % | 45 | 0 | 14 | 2905 | 266 | none |
| 9 | 11:57:30 | 94 to 87 | 0 | 25.9 % | 48 | 0 | 15 | 3225 | 260 | none |
| 10 | 11:58:26 | 87 to 90 | 0 | 32.6 % | 41 | 0 | 15 | 2836 | 275 | none |
| 11 | 11:59:20 | 90 to 97 | 0 | 23.5 % | 31 | 0 | 15 | 2977 | 265 | none |
| 12 | 12:00:12 | 97 to 74 | 0 | 20.9 % | 30 | 1 | 14 | 3207 | 277 | none |
| 13 | 12:01:02 | 74 to 61 | 0 | 21.0 % | 19 | 0 | 15 | 3148 | 268 | none |
| 14 | 12:01:48 | 61 to 53 | 0 | 14.3 % | 22 | 0 | 15 | 2838 | 271 | 2 |
| 15 | 12:02:37 | 53 to 61 | 0 | 21.7 % | 25 | 0 | 15 | 3665 | 305 | none |
| 16 | 12:03:16 | 61 to 60 | 0 | 7.6 % | 27 | 0 | 15 | 2754 | 405 | 2 2 |
| 17 | 12:03:51 | 60 to 58 | 0 | 4.7 % | 23 | 0 | 15 | 2641 | 279 | 2 2 |
| 18 | 12:04:28 | 58 to 54 | 0 | 4.3 % | 26 | 0 | 15 | 2521 | 275 | 2 2 |
| 19 | 12:05:03 | 54 to 45 | 0 | 4.6 % | 42 | 0 | 15 | 2456 | 272 | 2 2 |
| 20 | 12:05:33 | 45 to 38 | 0 | 2.4 % | 12 | 0 | 15 | 2663 | 286 | none |

20 of 20 passed. The old bounds would have failed 13 runs on the makespan (above 15 %) and 9 on the waiter (above 3,000 ms). The new figures stay far from their bounds: idle at most 172 ms against 1,000, at most one other slot freed in a refill against a limit of 1, the grant 260 to 405 ms after the release against 1,000, and refills never above the share of 2. The departure test (2) passed in every run: 4 of 12 files ran, 8 stayed queued.

The tightest margin left is not this row's: test 1's progress steps went down to 11 against its bound of 8 in run 6, the run with the 172 ms idle. That check did not change here.

## For whoever continues

- The method is the 011-175 one for the scheduler: bound what the scheduler itself does (from its `run` call records), not what the processes it starts take. `TimedRun` already records both ends of every `run` call; other wall-clock bounds over node:test processes in `test/scheduler/` can use it the same way.
- `refills` pairs starts and ends by order, so it is right for any width as long as no more than `width` runs overlap; `widest(...) === 4` checks that first in the same test.
- The test titles still say "within 5 % of list scheduling" and "within one slot's file": they are 011-21's done-when text. The 5 % figure is logged per run.
