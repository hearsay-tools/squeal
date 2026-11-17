# Rows 011-367 and 011-360: the claims fixture on a virtual clock, and its five files

Worker 1fb3ba32, wave 106 (`tasks/wave-106.md`, W2), 2026-11-16. Evidence: quality `quality/2026-11-15-card-7.md` section 4 and R7. Test files only; no `src` change, no version raise.

## What changed

- `test/scheduler/claims-fixture.ts`: `SideOptions.clock` (`"virtual"` or a `VirtualClock`) through `harnessClock`, as `catch-up-fixture.ts` has it; `Side` gains `now`, `advance`, `clock` and `rest()`. The default is unchanged: with no `clock` the scheduler gets `{ now }` over `SideOptions.now ?? Date.now`, as before. The heartbeat stays on `SideOptions.now ?? Date.now`. `FakeRunner.settled()` resolves once each run in flight has slept its real `runMs`. The runner's own time stays real.
- `test/scheduler/drive-fixture.ts` (new): `settle`, `until` and `idleOn` for a scheduler on the virtual clock whose runner works in real time (real Vitest, node:test). `rest()` sets that work aside, including an open runner-part call, so `settle` rests again until no `runner-part-bound` wake is open. `until` moves the clock only to the wakes it names (default `slot-gather` and `pump`); for any other wake it lets the runner work 10 ms. It never passes a yield bound or a pool recheck on its own.
- The five files: see the table.

| File | Harness | Cases | Scheduler waits before | After |
|---|---|---|---|---|
| `slow-slot-fair` | claims `side` | 7 | 14 `expect.poll`, 3 `delay(200)` settles on the slow lane's 25 ms recheck and the 100 ms defer budget | `step` (the runners' runs end, then each clock moves one recheck and rests) and `until`; "nothing happened" settles are exact asserts after `rest()`. The 5 s race in row 011-99's case stays: it bounds a hang, it is not a wait |
| `runner-part-bound` | Vitest harness | 4 (1 moved) | case 1: the 400 ms bound on the host clock, `Date.now() - started >= 350` | case 1: `rest()` names the `runner-part-bound` wake at edit time + 400, nothing is refined before it (`refinedRevision: 0`), then `advance(400)` |
| `busy-merge` | Vitest harness, catch-up side | 2 | merge hold release polled (10 s), result polled (30 s) | the merge hold's poll is a wake: `rest()` shows the hold, `advance(MERGE_HOLD_POLL_MS)` and `rest()` end it exactly; `idle()` for the real runs and card 9's busy resume |
| `capacity-pool` | node:test harness (passes `clock` to the Vitest one) | 2 | case 2: counted mark rewrites over 2.5 s of real time, polled the first run after a release (≤ 6 s) | case 2: one look per `CAPACITY_RECHECK_MS` exactly (no rewrite at 1 999 ms, one at 2 000 ms); after the release, no run before the next look, a run at it. Case 1: `until`/`idleOn` for the real re-key and runs |
| `fresh-worktree-durations` | own scheduler over `claimRepo` | 1 | `idle()` only | `idleOn`; `SLOW` timeout (see below) |

`node-test-harness.ts` needed no change: it passes every Vitest-harness option through, `clock` included.

## Cases changed in meaning

None dropped. Stronger, by the move:
- `runner-part-bound` case 1 also asserts that the revision is not refined before the bound's wake, and states the wake's time exactly instead of `elapsed >= 350 ms`.
- `capacity-pool` case 2 asserts one look per recheck exactly and no run between the release and the next look, instead of "at most 3 rewrites in 2.5 s" and "a run within recheck + 4 s".
- `slow-slot-fair` case 3 asserts after 5 exact rechecks; the old one asserted after "≥ 5 reads" and a 200 ms sleep.

## Row 011-360: the cause

`squeal failures test/scheduler/runner-part-bound.test.ts --all-worktrees` holds three failures, all in case 1 ("abandons a stalled invalidate past its bound…") and all `expected 0 to be greater than 0` on `counts.unknown`: 2026-11-15 16:57Z (load 1.68 per CPU), 21:57Z and 22:32Z (8.8 s and 13.3 s runs). All three ran on uncommitted work in other rows' worktrees (commits `8bf7a3b`, `771ef9b`, `133ec2d`, none on main) and **before** row 011-362's fix (`b888d9005`, 2026-11-15 23:02Z). Before that fix the revision's `RunnerPartBound` ran its own wake loop on the host clock, outside the scheduler's loop (`board.md` row 011-362). The case's 400 ms bound was therefore a host-time race against real Vitest work.

Verdict: **fixed by the move, cause not proven.** The case no longer reads host time: the bound fires only on `advance`, after `rest()` shows its wake. I did not find the path by which a host-time bound left no unknowns. The unchanged case passed 4 of 4 alone at load 69–73 (2.9–3.0 per CPU), and no failure is stored after 0.1.517. After the move: 3 of 3 alone (load 44–48 and 40–45), plus each run in the timing table.

## `fresh-worktree-durations`: its timeouts are setup, not waits

Its 8 stored failures since 2026-11-11 are `Test timed out in 5000ms` (Vitest's default). Measured phase times at load 94 on 24 CPUs (one run, unchanged file): `claimRepo(200)` 3 988 ms, first start 463 ms, first idle 313 ms, the 200-file commit 1 215 ms, second start and idle 382 ms. Total 6.4 s, of which about 5.2 s is git and file setup. The scheduler waited for no timer. The virtual clock cannot remove that, so the case takes `SLOW` (120 s), as the other scheduler cases with real repositories do. That is the fix for its recorded failures.

## Open item: one unexplained failure during the move

One run of the moved `fresh-worktree-durations` failed at load 85: `idleOn` spent its 3 000 steps (about 30 s) with the scheduler resting on a `pump` wake every 2 000 ms (`CAPACITY_RECHECK_MS`), so a tier was refused by the pool on every look. Then the teardown hook timed out (10 s). The pool reads the host's clock itself (`createPermitPool`'s `now`), not the scheduler's. I could not reproduce it: 8 runs after it passed (load 66–95), plus 3 timed runs. The log lines I had may have mixed with my Squeal daemon's run of the same file. If it comes back, the next step is to dump the pool's leases and marks when `idleOn` passes 50 steps. My guess, not checked: a lease kept by a tier whose end waits for something the drive does not advance.

## Timings

Before = the base commit `62dcae8e2` in a temporary worktree; after = this branch. Before and after alternate, so each pair ran at about the same load (one-minute load average on 24 CPUs). Wall time is the whole `vitest run` of one file; "tests" is Vitest's Duration × its tests share.

| File | Before wall (load) | After wall (load) | Before tests | After tests |
|---|---|---|---|---|
| `slow-slot-fair` | 8.6, 8.2, 7.7 s (36–38) | 7.0, 6.2, 8.3 s (37–39) | 3.9, 3.7, 3.7 s | 2.2, 2.1, 2.5 s |
| `runner-part-bound` | 8.9, 9.1, 9.3 s (39–43) | 9.0, 8.7, 8.7 s (40–45) | 3.1, 3.2, 3.0 s | 2.6, 2.6, 2.8 s |
| `fresh-worktree-durations` | 6.1, 5.0, 4.8 s (44–46) | 5.9, 5.1, 4.2 s (42–48) | 1.8, 1.6, 1.5 s | 1.6, 1.5, 1.5 s |
| `capacity-pool` | 16.4, 17.5, 15.7 s (40–49) | 13.1, 13.0, 11.6 s (41–50) | 10.5, 12.1, 10.1 s | 7.2, 6.6, 5.6 s |
| `busy-merge` | 9.5, 10.5, 10.9 s (49–54) | 7.9, 8.7, 9.6 s (50–55) | 4.3, 4.7, 4.9 s | 2.0, 2.4, 2.2 s |

Earlier single runs of the unchanged files at load 84–101: 18.7, 15.7, 25.5, 36.9 and 22.0 s wall, in table order.

All after runs: 3 of 3 pass per file in the table, plus the runs during the work.

## For the next worker

- `drive-fixture.ts` serves any harness on the virtual clock whose runner is real (`Driven` is `scheduler.idle`, `now`, `advance`, `rest`). Rows 011-368 and 011-371 can use `idleOn` where `idle()` waits for a gather or pump wake.
- On the virtual clock a backlog record waits for its `slot-gather` wake, and the pool recheck is a `pump` wake: a bare `idle()` then never resolves (seen in `capacity-pool` case 1 and `fresh-worktree-durations`).
- `rest()` returns while a runner-part call is open (row 011-362's named wait). With a real runner, `settle` first, or a check right after `rest()` can come before the runner's answer (seen in `busy-merge` case 1, where a 1 s poll then failed in Squeal).
- 21 test files use `claims-fixture.ts`; only `slow-slot-fair` passes `clock` now.
