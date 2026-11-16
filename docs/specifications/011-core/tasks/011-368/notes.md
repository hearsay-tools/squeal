# 011-368: eight settle-bound scheduler test files on the virtual clock

Worker f67dd95b, wave 107 W1, 2026-11-16. Base: `dd26ea2b8` (main with 0.1.518, cand/011-363-367 and the wave brief). Test files only.

## What changed

- The eight files use `clock: "virtual"` and `settle` (`tier-yields-fixture.ts`): `tier-ended-files`, `editor-scratch`, `editor-scratch-observed`, `tier-yields-fairness`, `batch-tier`, `backlog-quiet`, `catch-up-quiet`, `group-lanes-guards`. `grep -nE "expect\.poll|pause\(|SETTLE_MS|\.idle\(\)|delay\(|Date\.now"` on the eight: one match, `delay(f.path)` in `tier-ended-files`, the fake runner's per-file end delay (a parameter, no sleep of the test). Each "nothing happened" pause is now an exact check at the quiet point; each poll is `settle` then the same `expect`.
- Fixtures, each change additive (the host-clock path is unchanged for their other users):
  - `group-lanes-fixture.ts`: `GroupSideOptions.clock`; `GROUP_RECHECK_MS` (the 50 ms recheck it already used); `allCurrent` settles on a virtual clock.
  - `backlog-quiet-fixture.ts`: `quietSide` takes `clock` (then no tenth-speed clock); `cancelBacklog`, `editedCurrent`, `backlogStarts` settle on a virtual clock.
  - `batch-fixture.ts`: `BatchSetup.clock: "virtual"` in place of the `ModelClock`; the setup and `firstOf` settle.
  - `edit-cut-fixture.ts`: `started` settles on a virtual clock. `idle()` there hung case 3 of `catch-up-quiet` (a lane of slots): a wake waits for the test to move time, so `idle` never came (120 s timeout, seen once).
  - `catch-up-fixture.ts`: `CatchUpRunner.finishOf`, a run's own early end: its files complete when the promise resolves, before their `realMs`; a cancel still ends it first. The sleep's timer is now cleared when the run ends early or is cancelled.
- Time moves only where the case means it to:
  - `group-lanes-guards` case 1: the strict group still waits 1 ms before its 5 s `maxDeferMs` and runs at it (was: a poll of up to 20 s that waited the real 5 s). Cases 2 and 3 move one recheck (`GROUP_RECHECK_MS`) where the old test waited for the next real one.
  - `editor-scratch` case 5: the scratch revision comes 1 s after the cancel's (`advance(1_000)`, was a 1.5 s real pause). Without a move, a wait the scratch revision restarted would end at the same time, and `expect(l.quiet()).toEqual(ends)` would pass on the bug.
  - `editor-scratch`'s `quiet()` reads the scheduler's clock, not `Date.now()`.
- `tier-ended-files` case 3 ("the tier runs on"): B's run took a real minute (`realMs` 60 s), and the case waited it out. Now, after B's reported end, the case checks the tier is neither cancelled nor ended, then ends the run (`ends.finish(B)`, through `finishOf`). The other cases cancel that run, as before.

## Cases changed in meaning

None dropped, renamed or loosened. Stricter: `group-lanes-guards` case 1 checks both sides of the bound; `tier-ended-files` case 3 adds `expect(tier.endedAt).toBeNull()` before the run ends; every former poll is an exact check at the quiet point.

## Review `reviews/011-363-367.md` S1 and N1 (coordinator's request)

- S1: `settle` moved the clock to every `slot-gather` in a rest's wakes, so an earlier or simultaneous wake of another kind (a yield bound, a claim recheck) fired inside it. Now it moves only to the first gather that no other wake comes at or before (`gatherAt`), one at a time. New `tier-yields-settle.test.ts` (3 cases, red before the fix: the clock ended at 25 in each): a yield bound at 10 before a gather at 25 leaves the clock at 0; a gather at the same time as a claim recheck is not moved to; gathers at 5 and 8 before a bound at 10 are moved to, and the clock stops at 8.
- N1: `drive-fixture.ts`'s comments now say that the default `DRIVEN` (`pump`) moves to a pool's capacity recheck too, and that a test that must stay before it advances itself or leaves `pump` out of `driven`. No behaviour change.

## Sleep removed

Real waits each run executed in the old files (a settle is `SETTLE_MS`, 1.5 s):

| File | Old real waits | Seconds |
|---|---|---|
| `tier-ended-files` | 8 settles; B's 60 s run in case 3 | 72 |
| `editor-scratch` | 9 settles (3 `it.each` cases of 2, then 1 and 2) | 13.5 |
| `editor-scratch-observed` | 3 settles | 4.5 |
| `tier-yields-fairness` | 3 settles | 4.5 |
| `batch-tier` | 4 settles | 6 |
| `backlog-quiet` | 4 double settles | 12 |
| `catch-up-quiet` | 2 double settles, 1 settle | 7.5 |
| `group-lanes-guards` | the real 5 s `maxDeferMs`; a 200 ms pause | 5.2 |
| All | | about 125 |

About 60 s of it is fixed settles (the quality file's "about 40 s" counted them by text, not by run); the rest is B's real minute and the real defer bound. The old polls also waited for real work to finish; those are not counted.

## Wall time, before and after

One file per `vitest run`, `env -u PLUGIN_ROOT -u PLUGIN_DATA`, `timeout 300`, 24 CPUs, Squeal's daemon stopped for the rounds. Load is the one-minute load average at the start and end of each run. Vitest's own duration includes the transform (45 to 65 % of the after runs).

| File | Cases | Before (load) | After round 1 (load) | Round 2 (load) | Round 3 (load) |
|---|---|---|---|---|---|
| `tier-ended-files` | 5 | 75.6 s (22 → 29) | 2.9 s (17 → 17) | 6.1 s (40 → 41) | 5.3 s (46 → 46) |
| `editor-scratch` | 7 | 21.3 s (29 → 31) | 7.4 s (17 → 25) | 6.2 s (41 → 42) | 5.6 s (46 → 47) |
| `editor-scratch-observed` | 4 | 10.2 s (31 → 29) | 5.4 s (25 → 27) | 5.3 s (42 → 43) | 5.7 s (47 → 46) |
| `tier-yields-fairness` | 5 | 10.0 s (29 → 28) | 6.5 s (27 → 28) | 6.6 s (43 → 43) | 6.7 s (46 → 44) |
| `batch-tier` | 5 | 14.8 s (28 → 27) | 12.4 s (28 → 31) | 11.9 s (43 → 44) | 12.6 s (44 → 44) |
| `backlog-quiet` | 4 | 20.2 s (21 → 20) | 7.8 s (31 → 32) | 7.6 s (44 → 45) | 8.7 s (44 → 44) |
| `catch-up-quiet` | 3 | 11.9 s (20 → 18) | 9.6 s (32 → 35) | 6.6 s (45 → 45) | 7.0 s (44 → 47) |
| `group-lanes-guards` | 3 | 8.7 s (18 → 17) | 8.9 s (35 → 40) | 6.3 s (46 → 46) | 7.0 s (47 → 48) |
| All | 36 | 172.7 s | 60.9 s | 56.6 s | 58.6 s |

All 24 after-runs passed (3 of 3 per file) at `7309f183b`. The before runs of the first five files ran from this worktree before any edit; those of `backlog-quiet`, `catch-up-quiet` and `group-lanes-guards` from a detached checkout of `dd26ea2b8`, because the first before runs of those three had already read edited files. The after rounds ran at higher load (17 to 48) than the before runs (17 to 31).

Reading: `tier-ended-files` drops most (75.6 s to 3 to 6 s), the minute of case 3. `batch-tier` keeps about 12 s: its 6 s of settles went, the rest is case 2's many tiers at 4 workers over 82 files and the store. `group-lanes-guards` at round 1 sits at the before time at twice the load; rounds 2 and 3 are lower. At these loads most of what is left is transform, git fixtures and the store.

## Checks

- Squeal at revision 19 (`7309f183b`): `squeal status --wait` on `tier-yields-fixture.ts` selected the 55 test files that read it: no known failures, each current (474 s). On the other changed fixtures and the new test (102, 13, 6, 7, 3, 3 readers; 105 files in all): no known failures, each current (279 s).
- `pnpm run lint`, `pnpm run typecheck`: pass.

## For the next worker

- A fixture that calls `scheduler.idle()` after its start hangs on a virtual clock when a wake is armed (a lane of slots, a quiet): settle instead, as `started` and `quietSide` now do.
- A case that checks a published wait's end against a later one must move the clock between them; on a virtual clock two waits started at the same time end at the same time.
- `CatchUpRunner.finishOf` ends a long `realMs` run when the test says so, with every file complete; `holdOf` and `hold` instead complete nothing on a cancel.
- Rows 011-369 and 011-371: these eight files no longer use `now:` or `idle()`. `backlog-quiet-exempt` still uses `quietSide`'s tenth-speed clock and `idle()`; `batch-beside`, `batch-line` and `background-runs` still use the `ModelClock` path of `heldBatch`.
