# Row 011-427: notes

One header read (`headerWith`, `src/core/state/header.ts`) makes one `LaneReads` (`src/core/state/lane-reads.ts`). It reads each of these once, when a reader first asks, and the next header read makes a new one:

- the worktree row (`store.worktrees.get`): the policy's root and the live daemon;
- the daemon's published lane requests (`publishedLaneRequests`, the `narrow-asks:` meta row);
- the configured groups' activity row (`group-tier:`), read and parsed once for every group (`readGroupActivities` in `src/core/slow/state.ts`), and the default `slow` group's own row once;
- whether a registered consumer is in a turn (moved here from `slow.ts`).

`onRequestFiles`, `groupTiersOf` (through `requestedOf`) and `liveActivity` take it as an optional last argument. A caller outside a header read (for example `status-wait-settled.ts`, `readGroupTiers`, `readLane`) gets a fresh one by default, so its reads are as before.

Measured by `test/state/header-reads.test.ts` with one `manual` group, a narrow ask and a running lane: before, `narrow-asks:` was read 2 times and `worktrees.get` 4 times per header read; after, 1 each. The `group-tier:` row is read once per header read.

Review 0.1.660 B1 repair: the first version cached activity by group name, so with two configured groups one header read read and parsed the `group-tier:` row twice. `readGroupActivities` now reads it once and gives every group's entry from it; `readGroupActivity` uses it for a single group, so a caller without a shared `LaneReads` still reads fresh. With two `manual` groups: before, 2 reads of the row per header read; after, 1 (`test/state/header-reads.test.ts`, which also checks a second header read sees a changed activity).

Full status (`src/core/status/snapshot.ts`) already kept the header's on-request set for its lists (011-426 repair), so it needed no change here.
