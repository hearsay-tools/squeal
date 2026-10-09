# 001-148: a path first observed through a directory link re-runs its file at most once

2026-10-09, host of 24 CPUs at load 30 to 160.

## Cause

The link spelling and its target were first observed in different runs. 001-146's notes had already named this mechanism.

Logged from `observedGrowth` (paths added, growth, `firstSeen` per tier), on 8 runs of the case alone. 7 passed and 1 failed:

- Passing (one pool looked after the driver created the file): tier 3 records `linked/appeared.txt` and `data/appeared.txt` for both pools, both first seen. Tier 4 re-runs with no growth and stores `fail`. 2 runs.
- Failing (both pools looked before): tier 3 records only `linked/appeared.txt`. The recorder adds a link's target only when `realpath` resolves it (`recorder.cjs` `record`), and the leaf did not exist yet. Tier 4 reads the file, which is there now, and records `data/appeared.txt`, first hashed during tier 4. That makes it first seen, so per 001-134 tier 5 re-runs. 3 runs.

It was not a watch batch or a test race: the stat cache first hashed the target only at tier 4's recording. Whether both pools looked first depended on when they started relative to the driver's 10 ms poll.

## Fix

`src/core/scheduler/link-target.ts` `linkTargets` resolves the real directory of each observed file path the closure lacks. When that directory is reached through a link and is kept, it adds the target spelling, whether the file exists or not (under the root, outside `node_modules` and `.git`, as the recorder keeps). `observedGrowth` adds the targets with the read paths, so they go through the same ignore check, `track` and `firstSeen`. Tier 3 now records both spellings in either order. The first-observation rule is unchanged: both are first seen, and the run's pass is never stored under the key with them.

Cost: one `realpath` per distinct directory among a tier's newly observed paths, only while observing.

## Test

The link case now waits until both pools wrote their own `ready-*` file before the driver creates the file. It fails every time without the fix (3 of 3 runs, "expected 3 to be less than or equal to 2") and passed 10 of 10 alone at load 62 to 81 with it. The other two cases keep the race, with one `ready-*` file enough. `test/scheduler/link-target.test.ts` covers an absent file under a link, a nested directory, a link to the root, a plain path, and links out of the worktree and into `node_modules`.

## Not settled here

- The recorder could resolve the target the same way (realpath the parent when the leaf is absent). It is not this row's, and the scheduler-side fix covers any recorder.
- `plugins/claude-code/dist` and the Codex bundles differ from the build (`src/core` changed). This row may not build; the landing rebuilds.
