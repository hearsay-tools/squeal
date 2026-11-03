# 019-10 notes: scheduler lanes per group

Worker 1013a7de, 2026-11-03. Residue for step 2b (019-14 to 019-16) and for integration with 019-11 and 019-12.

## Seam map

- `src/core/types/scheduler.ts`: `TESTS_GROUP`, `SLOW_GROUP`, `GROUP_LANE_PREFIX`, `groupLane(group, runnerLane)`, `isGroupLane(lane)`, `laneGroup(lane)`; `Scheduler.requestGroup(group)`. `isSlowLane` in `types/runner.ts` is unchanged (coordinator, 2026-11-03: option A).
- `src/core/scheduler/slow.ts`: `groupView(policy)` (019-07's `resolveGroups` and `groupOf`, memoized per file per policy object), `runnerOf(policy, project)`, `laneFor` through `groupLane`. `slowView(policy).isSlow` is now "a group other than `tests` owns the file".
- `src/core/scheduler/queue.ts`: `setGroups`, `checkGroup`, `hasGroup`, `orderedGroup`. `setSlow` stays as a wrapper; `isSlow` is "not `tests`".
- `src/core/scheduler/ledger.ts`: `orderedGroup(name)`; the default `slow` group keeps `slow.rank`. `orderedSlow` stays: every file of every group lane.
- `src/core/scheduler/slow-tier.ts`: `SlowTier` is one group's lane object (`group`, default `"slow"`). Each step reads its `ResolvedGroup` from the policy in force. `queueGroup(context, ledger, group)`; `queueSlowSuite` is `queueGroup(..., "slow")`.
- `src/core/scheduler/slow-trigger.ts`: `momentHolds(context, group)`, `quietLeftMs(context, group)`. `policyTriggered` is gone.
- `src/core/scheduler/group-limits.ts` (new): `poolLaneOf`, `tierKindOf`, `fullWidth`, `workersPerFile`, `ungated`, `slotDirOf`.
- `src/core/scheduler/group-tiers.ts` (new): `GroupTiers`, one lane object per group but `tests`, synced on each read with the policy object; lanes with `deferUnderLoad` are asked last.
- `src/core/scheduler/scheduler.ts`: `#groups`; the pump asks each lane that may start (`#groupLanesNext`, `#laneMayStart`); `requestGroup`; `#normalIdle`, `#groupBusy`, `#drainable`.
- `src/core/scheduler/tiers.ts`: `Tier.priority` (the group's); the marked line in `executeTier` where 019-12 sets `RunOptions.priority`.
- `src/core/slow/state.ts`: `groupTierMetaKey`, `publishGroupActivity`, `readGroupActivity`.
- `src/core/slow/classify.ts`: `slowFiles` and `slowGlobs` read `pytest[].slow` from the policy.

## Decisions the spec did not settle

1. **One tier per group at a time**, whatever its runner. Today a slow Vitest tier and a slow node:test tier never run at once (`#slowMayStart`); each group keeps that rule. Two groups run at once.
2. **Width.** A group with `maxParallel` takes up to that many files a tier; without it, `runner.tierSize`. A `low` group takes one file while `#normalIdle` is false or the load is above its bound (today's idle width rule). A `normal` group always takes its full width.
3. **"Normal work pending"** for a `low` group's width is `fastIdle` false or a `normal` group (not `tests`) with a file queued or a tier in flight. With no `checks` key it is today's `fastIdle`.
4. **Pool grant.** A group's tier runs without a grant, as an edit's tier, when the group is at `edit` with no `after`, no `quietMs`, `normal` priority and no `maxWorkers` (`ungated`). Every other group's tier waits for a grant in its pool lane (`low` = `"slow"`, `normal` = `"fast"`); an open request runs without one when the pool refuses, as `run --slow` does. `maxWorkers` absent is one worker per file.
5. **Tier kind.** `low` gives kind `slow` (nothing cancels it). `normal` gives kind `edit`: the existing rules cancel it on supersession when its runner cancels (Vitest) and may yield it as a fast tier.
6. **`after`.** `tests` keeps 004-60: an edit's work always goes first; the fast backlog goes first unless the lane has an open request. Any other named group goes first while it has a file queued or a tier in flight.
7. **`commit`.** The moment never holds by itself; queued files of a `commit` group wait for `requestGroup`. They do not count in `slowPending` or `slowWaiting` (the exit drain) unless a request is open.
8. **`quietMs` at a moment other than `edit`** is ignored (019-07 decision 8 left it to the scheduler).
9. **Slot of a configured group.** Per user, directory `<slot dir>/group.<name>/` with today's file names, until 019-11 names the files `group.<name>.*.lock` in the slot directory. The one place to change is `slotDirOf`.
10. **Waiting for a predecessor** publishes `{ kind: "waiting", for: "fast" }` for any predecessor: `SlowTierWait` has no group or commit reason. 019-16 decides the words.
11. **Pump order.** Lanes without `deferUnderLoad` are asked first. A lane's load-guard wait holds the pump; asking the unguarded lanes first keeps a guarded lane from delaying them.
12. **`requestGroup("tests")`** queues the `tests` files that are not current; the fast tiers run them. An unknown name gives `null`.
13. **`pytest[].slow`.** `slowFiles` and `slowGlobs` read `policy.pytest` themselves, so every caller (scheduler, status, Stop, warm-up) agrees. `PYTEST.slowProjects` stays `[]`, since `RunnerDescription.slowProjects` returns node:test entries.

## Found, not fixed

- **Until 019-12 lands, a configured group's Vitest tiers go to the daemon's main Vitest instance.** `withSlowInstance` routes only `slow:` lanes to the second instance, so a `group:` lane's run shares the main instance with the fast lane's runs. The scheduler starts them beside each other; whether the instance overlaps them is 019-12's to measure. `lower(..., isSlowLane(lane))`, the node:test and pytest adapters' slow-lane checks, `status/tier-text.ts`, `standing.ts`, `standing-yields.ts`, `next-step.ts`, `ps/processes.ts` and `store-decision.ts` still read `isSlowLane`. With no `checks` key nothing changes.
- **A configured group's activity row is not removed with its worktree.** `WORKTREE_META_ROWS` deletes by exact key, and `group-tier:<name>:<worktree>` has the name in the middle. Closing a lane writes `null` to it. A pattern delete in `store/repos/worktrees.ts` (owner: store) would remove it.
- **Status counts a configured group's files as slow** (`slowView(policy).isSlow`), so `Slow tier:` lines include them until 019-16 writes the per-group lines.
- `plugins/claude-code/dist` and the Pi bundles drift (`test/harness/pi/package.test.ts > bundles`); this row does not own the build.
- `slow-tier.ts` is about 800 lines; `tierKeys` in it has no caller.
