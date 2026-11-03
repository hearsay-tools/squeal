# 019-11 notes: a slot per group, pool order by priority

Worker 192ba246, 2026-11-03. Residue for 019-10 (scheduler lanes), which calls these interfaces, and for 019-16 (texts).

## What changed

- `src/core/slow/slot-files.ts` (new, split out of `slot.ts`, which `slot.ts` re-exports): `slotFiles(group?)` names a group's slot files. Default and `"slow"`: `slow.lock`, `slow.<i>.lock`, waiter marks `slow.wait.<hash>`, as before. Any other name: `group.<name>.<i>.lock` and `group.<name>.wait.<hash>`. The waiter functions moved here and take `group` as their last parameter.
- `src/core/slow/slot.ts`: `SlowSlotRequest.group?: string`. `acquireSlowSlot`, `slowSlotHeld` and `heldPermits` use the group's files.
- `src/core/capacity/pool.ts`: `poolLaneOf(priority: CheckPriority): PoolLane`. `"low"` is `"slow"` and `"normal"` is `"fast"`. The pool and its mark are unchanged.

## How 019-10 calls them

- Slot: `acquireSlowSlot({ dir, owner, permits: maxParallel, want, group: group.name })`, `slowSlotHeld({ dir, permits, group })`, `markSlotWaiter(dir, worktreeId, group)`, `clearSlotWaiter(dir, worktreeId, group)`, `othersWaitingForSlot(dir, worktreeId, undefined, group)`.
- Pool: `capacity.take(want, poolLaneOf(group.limits.priority), least, kind)`.
- The slot-held note in `slow-tier.ts` names `SLOW_LOCK_FILE`. For a group, the first file is `slotFiles(name).permit(0)`.

## Decisions the spec did not settle

1. **A configured group's first permit is `group.<name>.0.lock`.** It has no unnumbered file. `slow.lock` is unnumbered only so that a daemon of one permit, or a release before permits, holds the same file. No older daemon knows a configured group, so the contract's `group.<name>.*.lock` holds for every permit.
2. **The name `slow` always takes today's files.** 019-07 does not let a `checks` entry take the name `slow`, so this is the default group only. A `tests` group with `limits.maxParallel` takes `group.tests.*`.
3. **The name is checked in `slotFiles`** against 019-07's form `[A-Za-z0-9][A-Za-z0-9_-]*`, before any file is made, since it becomes part of a path. The rule is a copy: `policy-checks.ts` does not export its `NAME`. Names have no `.`, so one group's prefix never matches another group's files.
4. **Priority is a mapping, not a wider `PoolLane`.** The callers that pass `"fast"` and `"slow"` today (`TierCapacity.take`, lint's `parts.ts`) stay as they are. The pool mark keeps its `slow` flag, so an older daemon reads a low waiter as a slow one, and a new daemon reads an older slow waiter as low.
5. **Scope.** Every group's slot is per user, in `slowSlotDir()`, as the slow slot is. No scope constant is added. `slotFiles` is the one place that names the files. A per-repository scope (spec open question 8) would add a repository key to those names, and the request would need to carry the repository's id.
6. **Names kept.** `acquireSlowSlot`, `slowSlotHeld`, `SlowSlotRequest` and the "slow slot directory" error text keep "slow" though they now serve every group. A rename touches callers in 019-10's and the status files. It is left for a quality pass.

## Found, not fixed (outside 019-11's files)

- `squeal ps` counts slot permits by `^(pool\.\d+|slow(\.\d+)?)\.lock$` (`src/core/ps/host.ts:66`). A configured group's `group.<name>.<i>.lock` is not counted as held, and its holder is not shown. No wave 2 row owns `src/core/ps/`.
- `Slow slot:` (`src/core/status/slot-holders.ts`) reads the `slow` group only. A group's holders would need `heldPermits({ dir, permits, group })`, a text for 019-16.
- `plugins/claude-code/dist` drifts: `cli/squeal.mjs` and `cli/ps.mjs` bundle the slot code. This row does not own the build.
