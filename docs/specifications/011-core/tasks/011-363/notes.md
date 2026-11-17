# 011-363: the six flakiest whole-scheduler test files on the virtual clock

Worker 39096e36, wave 106 W1, 2026-11-16. Base: `62dcae8e2` (0.1.518 plus the wave brief). Test files only.

## What changed

- `tier-yields-fixture.ts`: `settle(...sides)`, the quiet point of one or more catch-up sides on virtual clocks. Each side rests (`CatchUpSide.rest`). A rest sets a runner's run aside, so a run that is not held (0 ms of real time here) can still end after it, and its record follows. `settle` therefore rests again until no run started or ended between the mark taken before the rests and one real timer turn after them. A `slot-gather` wake is bookkeeping: `settle` moves the clock to it. No other wake fires unless the test moves time. A 20 s host-clock guard fails a settle that finds no quiet point. `heldRun` reads at `settle` when the side has a virtual clock; on the host's clock it still polls, so its 30-odd other users are unchanged.
- `tier-yields-claim-fixture.ts`: `sides` puts both worktrees on virtual clocks, starts each to `settle`, and no longer takes `now` (its only users are the two claim files).
- The six files use `clock: "virtual"` and `settle`. No `expect.poll`, `pause(SETTLE_MS)`, `idle()` or skewed `now` remains in them (`grep -nE "expect\.poll|pause\(|SETTLE_MS|\.idle\(\)|setTimeout|Date\.now\(\) \+"` on the six files and the claim fixture: no match).
- A skewed `now` (`clock.skew = x`, `skew += x`) is a `clock.jump`: time passes with nothing fired on the way, as before. The runner's own sleep stays real (`catch-up-fixture.ts`), as the brief says.
- A claim's recheck (`CLAIM_RECHECK_MS`) comes only when the test moves this worktree's clock: `recheck(main, other)` advances 1 s and settles both. "Three rechecks while the claim is live" is now three such moves (was a 3 s real pause).

## Cases changed in meaning

None dropped, renamed or loosened. Stricter or more exact:

- `tier-yields-overrun` case 1: the bound alone cuts the tier, now checked on both sides of it: 1 ms before the bound the tier is not cancelled; at the bound it is (was: a poll of up to 40 s that it ends some time).
- `tier-yields-kept` case 4 (row 011-301): adds `expect(next.runner.runs…).toEqual([SLOW])`: the restarted daemon's first run is the slow tier, so no tier of the lane ran and ended before it (rule C's input).
- `tier-yields-claim-ends` cases 3 and 4: "the result is taken" is checked after one claim recheck (was: a poll of up to 10 s). Case 2's 20 s and 30 s skews are jumps; the first jump subtracts the three rechecks already moved.
- Each "nothing happened" settle (`pause(SETTLE_MS)` then a negative check) is now an exact check at the quiet point.

## Row 011-301 (`tier-yields-kept` "a restart keeps no yield")

Likely cause, not proven: the old `restarted()` closed the first daemon as soon as the second slow run was seen in flight (a poll), without waiting for the record of F and G's run before it. On a slow runner F and G could lack their results at the stop, so the new daemon ran them first as a tier of the vitest lane; that tier ended, and rule C (`firstTier`, `standing-yields.ts`) found an ended tier of the lane. The wait was the cause. Now the first daemon is at its quiet point before the stop, and the new assertion fails if the restarted daemon runs anything before the slow tier. I did not reproduce the old failure.

## `handover-batches` case 4 (board row ci-43589305691)

The old case read `runs[1]` once a poll saw `runs.length > 1`, and its setup polled `runner.active`. Both now read at the quiet point. The CI failure message is not on the board, so the cause is not proven; the move removes every real-time read in the case.

## Wall time, before and after

One file per `vitest run`, `env -u PLUGIN_ROOT -u PLUGIN_DATA`, `timeout 300`, 24 CPUs. Load is the one-minute load average at the start and end of each run. The host was loaded by another project throughout (load 55 to 113). Vitest's own duration includes the transform (30 to 70 % of it here).

| File | Cases | Before (load) | After round 1 (load) | After rounds 2, 3 (load) |
|---|---|---|---|---|
| `tier-yields-overrun` | 10 | 32.1 s (86 → 86) | 44.9 s (97 → 88) | 19.4 s (79 → 77), 8.3 s (67 → 64) |
| `tier-yields-kept` | 4 | 18.0 s (86 → 89) | 11.5 s (88 → 85) | 12.2 s (77 → 77), 7.8 s (64 → 63) |
| `handover-batches` | 3 | 18.1 s (89 → 94) | 10.3 s (85 → 82) | 10.6 s (77 → 76), 7.2 s (63 → 59) |
| `tier-yields-claim` | 2 | 20.8 s (94 → 99) | 19.0 s (82 → 82) | 5.6 s (76 → 72), 7.5 s (59 → 56) |
| `tier-yields-claim-ends` | 4 | 45.0 s (99 → 94) | 15.3 s (82 → 82) | 8.4 s (72 → 69), 7.6 s (56 → 56) |
| `retry-slow-lane` | 2 | 13.8 s (94 → 92) | 13.4 s (82 → 79) | 5.2 s (69 → 67), 7.7 s (56 → 59) |

All 18 after-runs passed (3 of 3 per file) at `9a81110c9`. Earlier single runs during the work: `tier-yields-overrun` 13.7 s at load 86 → 84, `tier-yields-kept` 7.7 s and 12.6 s at load 63 → 66.

Reading: the before runs and after round 1 were at similar load (80 to 99). Round 1 of `tier-yields-overrun` (44.9 s) was the first run after a load peak of 113 and is an outlier against its other three runs (8 to 19 s). The real waits the move removed: about 4.5 s of settles and up to 40 s of polls in `overrun`, 1.5 s plus a poll in `kept`, about 30 s of rechecks, skews and settles in `claim-ends`. At these loads the remaining time is mostly transform, git fixtures and the store. A clean comparison needs a quieter host.

## For the next worker

- `settle(...sides)` in `tier-yields-fixture.ts` is the quiet point for catch-up sides on `clock: "virtual"`. Pass every side whose work can affect the other (two worktrees on one store).
- Read the run index of a cut tier as `runs.indexOf(tier) + 1`, not `runs.length` after a settle: the next tier has already started by then.
- A claim recheck, a slow-lane look or a yield bound fires only when the test moves the clock. `retry-slow-lane` needed no move: its lane's wakes are due at once and the prompt clock fires them.
- Rows 011-369 and 011-371: these six files no longer use `now:` or `idle()`.
