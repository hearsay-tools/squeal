# Row 011-427: notes

One header read (`headerWith`, `src/core/state/header.ts`) makes one `LaneReads` (`src/core/state/lane-reads.ts`). It reads each of these once, when a reader first asks, and the next header read makes a new one:

- the worktree row (`store.worktrees.get`): the policy's root and the live daemon;
- the daemon's published lane requests (`publishedLaneRequests`, the `narrow-asks:` meta row);
- each group's published activity (`readGroupActivity`), per group name;
- whether a registered consumer is in a turn (moved here from `slow.ts`).

`onRequestFiles`, `groupTiersOf` (through `requestedOf`) and `liveActivity` take it as an optional last argument. A caller outside a header read (for example `status-wait-settled.ts`, `readGroupTiers`, `readLane`) gets a fresh one by default, so its reads are as before.

Measured by `test/state/header-reads.test.ts` with one `manual` group, a narrow ask and a running lane: before, `narrow-asks:` was read 2 times and `worktrees.get` 4 times per header read; after, 1 each. The `group-tier:` row is read once per group name. With several configured groups it is still read once per group, as before this row: `readGroupActivity` parses the whole row for one group, and a single-read version would need a change in `src/core/slow/state.ts`, outside this row's ownership.

Full status (`src/core/status/snapshot.ts`) already kept the header's on-request set for its lists (011-426 repair), so it needed no change here.
