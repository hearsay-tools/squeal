# 019-18 notes: step 2a integration

Worker a8e00acb, 2026-11-03. Rows 019-10 to 019-13 together. Commit `07dc2c5d2`.

## What changed

- **Priority.** `executeTier` (`src/core/scheduler/tiers.ts`) passes `tier.priority` as `RunOptions.priority`. `newTier` sets it for every tier from the group of the tier's first file, so `tests` runs are `"normal"`, the default `slow` group's `"low"`, a configured group's its `limits.priority`. 019-12's fallback (`runPriority`: `"low"` in a `slow:` lane) now only serves a run without the field.
- **Lane helpers.** `withSlowInstance` routes a run to a lane instance when `isGroupLane(lane)`. `vitestLaneGroup` uses `groupLane(name, "vitest")` and is `null` for a lane that is not a group lane: `groupLane("tests", "vitest")` is `vitest`, the fast instance's. The node:test and pytest adapters' `groupRun` is `isGroupLane(lane)`; `PYTEST_LANE` had no other use and is gone.
- **Slot.** `slotDirOf(group, base, at?)` (`group-limits.ts`) is `slotFiles(group, at?.scope ?? "user").dir(base, at?.commonDir ?? base)`. `SlowTierOptions.slotScope?: SlotScope` (`{ scope, commonDir }`, `src/core/scheduler/options.ts`); absent is `"user"`, the files in `slotDir` itself, so every scheduler test that passes `slotDir` keeps today's paths. `SlowTier` passes `group: this.group` to `acquireSlowSlot`, `slowSlotHeld`, `markSlotWaiter`, `clearSlotWaiter` and `othersWaitingForSlot`, and reads its directory once (`repositoryId` writes a draft file on each call). The held-slot note names the group's first permit file; its words are unchanged.
- **Host config.** `Capacity.groupSlotScope` (required; `src/core/types/capacity.ts`). `capacityReader` adds it to `resolveCapacity`'s result; `resolveCapacity` returns `Omit<Capacity, "groupSlotScope">` and keeps its input. The daemon passes `slow: { slotScope: { scope: capacity.groupSlotScope, commonDir } }` to `createDaemonLoop`, read when the loop starts, as the pool's size is.
- **One `poolLaneOf`.** The scheduler's `poolLaneOf(group)` calls `capacity`'s `poolLaneOf(group.limits.priority)`.

## Tests

- `test/scheduler/group-lanes-integration.test.ts` (new): (a) each lane's runs carry its group's priority; (b) a configured Vitest group's tiers run in an instance `withSlowInstance` made for `group:e2e:vitest`, none in the fast one; (c) two repositories sharing one slot base: under `"repository"` both default `slow` groups run at `maxParallel` 1 at once, each in its own `repo.<key>/slow.lock`; under `"user"` the second waits for the slot; a configured group's files are `group.<name>.<i>.lock` in the repository's directory; (d) no `checks`, scope `"user"`: the base holds exactly `slow.lock` and `slow.wait.<hash>`, today's names (SQLite's `-journal` files left out).
- Fixtures: `CatchUpRun.priority`; `CatchUpOptions.wrapRunner`; `groupSide`'s `slotDir`, `slotScope`, `wrapRunner` and `commonDir`.
- `group-lanes-limits.test.ts`: the `group.low` directory check is now `group.low.0.lock`.
- `user-config.test.ts`: the reader's results carry `groupSlotScope`; a new case reads `"user"` and a later edit.
- `idle-gc-daemon.test.ts`, `drain-wait.test.ts`: real daemons now take the slow permit in the repository's directory (default scope), so the test holds that one.

## Found, not fixed (019-16's, now user-visible)

With the default `"repository"` scope the daemon's default `slow` group takes its permits in `<slot dir>/repo.<key>/`. Until 019-16 lands:

- `Slow slot:` in status (`src/core/status/slot-holders.ts`) reads `slowSlotDir()` itself and shows no holder.
- `squeal ps` counts slot permits in the base directory only (`src/core/ps/host.ts`), so it counts none of a repository's.
- The held-slot note still says "another daemon of this user"; under `"repository"` it is a daemon of this repository.

A user with `capacity.groupSlotScope: "user"` sees none of these.

## Not done

- The build: the brief says do not run it. `plugins/claude-code/dist` and the Pi and OpenCode bundles drift.
