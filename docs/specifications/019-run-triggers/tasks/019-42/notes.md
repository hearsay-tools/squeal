# 019-42 notes: `wait-reads.test.ts` counted one poll too many

Worker 67b6f6ad, 2026-11-04. Shape: repair. CI 41810579375 at `64ed7667e` (Node 22, shard 2/3, load average 2.6): "status --wait <path> reads the selected files' states, and every state only at its end" failed with `expected 7 to be less than or equal to 6` in `between`. The test took 2514 ms, so the runner was not slow.

## Cause

Spec 019 did not add a read or a poll. The wait's deadline timer did it: Node truncates a timer's delay to whole milliseconds and counts it on libuv's whole-millisecond clock. So the pause to the deadline can end up to 2 ms before the deadline on `performance.now()`, the clock the wait counts on. The wait then reads again, not as its final read, and pauses at least 1 ms (Node's minimum). That pause can also end before the deadline. A fast wait thus reads twice before its deadline read: first read, sync answer, 1 s, 2 s, two early reads, deadline read, 7 polls in all. The test's fixed bound of 6 allowed one early read only.

`test/cli/wait-clock.ts` (task 001-334) already records the same early timer for `waitedMs`.

## Probe numbers

All probes ran in copies of the tree under the task's scratch directory (`git archive`, `node_modules` symlinked, `node_modules/.bin/vitest` run directly), not in the worktree. Host: 24 cores, load average 12 to 18 from other sessions during the probes.

1. **Did 019 add a read?** `git log -p b1255533f..c5b7803f5` on `status-wait-lines.ts` and `status-wait-paths.ts` shows one commit, `910ed3def` (019-24). Its only change to the wait is `...leftGroupsOf(root, leftForPause)` in the result of the final read. That reads the policy file (`readPolicy`), not the store, and only once, at the end. The rest is line text. 019-25 (`9d07daf30`) did not touch these files.
2. **Store sessions of `status --wait 2500 <path>`**, the failing test's own call. A probe test logged when each store session opened, what it read and who opened it. 10 waits at each tree:

   | tree | polls (sessions that read file states), per wait |
   |---|---|
   | `b1255533f` | 5 5 5 5 5 5 5 6 6 5 |
   | `c5b7803f5`, this row's base on main (`src` and `test` as at the CI commit `64ed7667e`) | 6 6 6 5 5 6 5 5 5 5 |

   Both trees have the same timeline and one read per poll: for example, at `c5b7803f5`, 1 ms, 6 ms, 1007 ms, 2013 ms, 2502 ms (early), 2504 ms (deadline, the only session that reads every state). All sessions come from the one `waitForNamed` call.
3. **Slow reads do not cause it.** With every state read blocked 5, 20 or 40 ms (`Atomics.wait`, no CPU used), 5 waits each gave 5 or 6 polls. A slow read leaves fewer early reads, not more.
4. **The timer alone gives it.** A plain Node loop with the wait's clock rule and no store (`final = elapsed >= timeout`; pause `min(1000, remaining)`), timeout 37.3 ms, 400 waits per read time:

   | read time | deadline reads besides the first read: 1 / 2 / 3 |
   |---|---|
   | 0 ms | 40 / 354 / 6 |
   | 0.2 ms | 336 / 62 / 2 |
   | 1 ms | 102 / 298 / 0 |
   | 3 ms | 154 / 246 / 0 |

   Three deadline reads (two early ones and the final one) is the 7-poll case: 1.5% of waits with very fast reads. That is the rate of a rare CI failure; the push run of the same commit passed.
5. **How early a timer fires.** 300 timers of 10 to 11 ms: the earliest fired 0.88 ms early; after 30 ms of blocking, 1.76 ms early. Node updates its loop clock when it sets a timer, so a long read does not make the next timer fire earlier.

## Fix

Only `test/cli/wait-reads.test.ts` changed; no source change, as the brief says when 019 added no read. `between(polls, since)` now checks the polls on the wait's clock instead of a fixed count:

- the test's store mock records when each counted session opened (`openedAt`, on `performance.now()`);
- each wait records `since` just before it is called;
- every poll that opens before the last 20 ms of the wait (`DEADLINE_MS`) opens at least 990 ms after the poll before it (`SECOND_MS`, the spec's one second less timer rounding), except one: the read when the wait's sync answered;
- the last poll opens at the deadline (no earlier than `WAIT_MS - DEADLINE_MS`).

`SECOND_MS` is a literal, not `STATUS_WAIT_POLL_MS - 10`, so a change to the source constant does not change the bound. With `STATUS_WAIT_POLL_MS` set to 250 in a probe copy, the four tests whose waits use it fail (polls 250 ms apart); the slow-file test passes its own `pollMs: 1_000`, and `run --all --wait` uses `STORE_POLL_MS`.

## Checks

- `pnpm exec vitest run test/cli/wait-reads.test.ts`, 10 runs in a row in the worktree: 10 of 10 passed (8 of 8 tests each), 11:04 to 11:07 UTC, load average 14.0 at the start and 15.8 at the end on 24 cores.
- `squeal status --wait 60000 test/cli/wait-reads.test.ts`: no known failures, current at revision 2.
- `pnpm run lint`, `pnpm run typecheck`: pass.

## Left open

- The wait itself still reads once or twice in the last 2 ms before its deadline. Each early read is a full poll read. It costs at most two extra reads per timed-out wait, so this row did not change `src/cli/status-wait*.ts`. To stop it, the wait could treat a read within a few ms of its deadline as the final read. That is a source change, outside this row's ownership.
- The deadline window (the last 20 ms) is exempt from the one-second rule. A fault that polled many times in only those 20 ms would pass this test.
