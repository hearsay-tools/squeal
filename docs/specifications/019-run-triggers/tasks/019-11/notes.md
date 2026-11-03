# 019-11 notes: a slot per group, pool order by priority

Worker 192ba246, 2026-11-03. Residue for 019-10 (scheduler lanes), which calls these interfaces, and for 019-16 (texts).

## What changed

- `src/core/slow/slot-files.ts` (new, split out of `slot.ts`, which `slot.ts` re-exports): `slotFiles(group?)` names a group's slot files. Default and `"slow"`: `slow.lock`, `slow.<i>.lock`, waiter marks `slow.wait.<hash>`, as before. Any other name: `group.<name>.<i>.lock` and `group.<name>.wait.<hash>`. The waiter functions moved here and take `group` as their last parameter.
- `src/core/slow/slot.ts`: `SlowSlotRequest.group?: string`. `acquireSlowSlot`, `slowSlotHeld` and `heldPermits` use the group's files.
- `src/core/capacity/pool.ts`: `poolLaneOf(priority: CheckPriority): PoolLane`. `"low"` is `"slow"` and `"normal"` is `"fast"`. The pool and its mark are unchanged.
- Follow-up slice (the human's scope decision, 2026-11-03): `slotFiles(group?, scope?)`, scope default `"repository"`. `SlotFiles.dir(base, commonDir)` is `base` under `"user"` (today's directory and files) and `repo.<key>` in `base` under `"repository"`. The key is the first 16 hex digits of the SHA-256 of `repositoryId(commonDir)`, as the daemon's scratch directory is keyed. `acquireSlowSlot` makes a missing base private before a repository's directory (`isRepositorySlotDir`), so the pool still accepts the base.
- `src/core/daemon/user-config.ts`: `capacity.groupSlotScope: "user" | "repository"`, default `"repository"`. Another value is the problem `"capacity.groupSlotScope" must be one of "user", "repository", got ...` and keeps the default. Type `GroupSlotScope` and `UserConfig.capacity.groupSlotScope` in `src/core/types/capacity.ts`. `resolveCapacity` now takes only `hostSlots` and `projects`.

## How 019-10 calls them

- Directory: `slotDirOf(group, base)` (019-10's `src/core/scheduler/group-limits.ts`) becomes `slotFiles(group, scope).dir(base, commonDir)`, with `scope` from `loadUserConfig(...).config.capacity.groupSlotScope`. The daemon reads the host config through `capacityReader`, whose `Capacity` does not carry the scope yet.
- Slot: `acquireSlowSlot({ dir, owner, permits: maxParallel, want, group: group.name })`, `slowSlotHeld({ dir, permits, group })`, `markSlotWaiter(dir, worktreeId, group)`, `clearSlotWaiter(dir, worktreeId, group)`, `othersWaitingForSlot(dir, worktreeId, undefined, group)`.
- Pool: `capacity.take(want, poolLaneOf(group.limits.priority), least, kind)`.
- The slot-held note in `slow-tier.ts` names `SLOW_LOCK_FILE`. For a group, the first file is `slotFiles(name).permit(0)`.

## Decisions the spec did not settle

1. **A configured group's first permit is `group.<name>.0.lock`.** It has no unnumbered file. `slow.lock` is unnumbered only so that a daemon of one permit, or a release before permits, holds the same file. No older daemon knows a configured group, so the contract's `group.<name>.*.lock` holds for every permit.
2. **The name `slow` always takes today's files.** 019-07 does not let a `checks` entry take the name `slow`, so this is the default group only. A `tests` group with `limits.maxParallel` takes `group.tests.*`.
3. **The name is checked in `slotFiles`** against 019-07's form `[A-Za-z0-9][A-Za-z0-9_-]*`, before any file is made, since it becomes part of a path. The rule is a copy: `policy-checks.ts` does not export its `NAME`. Names have no `.`, so one group's prefix never matches another group's files.
4. **Priority is a mapping, not a wider `PoolLane`.** The callers that pass `"fast"` and `"slow"` today (`TierCapacity.take`, lint's `parts.ts`) stay as they are. The pool mark keeps its `slow` flag, so an older daemon reads a low waiter as a slow one, and a new daemon reads an older slow waiter as low.
5. **Scope** (superseded by the human's answer, 2026-11-03, follow-up slice). One directory per repository holds every group's files, the `slow` group's included, with the same names as under `"user"`. The pool's files (`pool.<i>.lock`, `pool.mark.*`) stay per user in `base`: 011 C10's pool is the host's. The key hashes the repository's random id, not the common dir's path, as the scratch directory does: a repository cloned again at the same path gets a new slot (review wave 7.7, B1).
6. **Names kept.** `acquireSlowSlot`, `slowSlotHeld`, `SlowSlotRequest` and the "slow slot directory" error text keep "slow" though they now serve every group. A rename touches callers in 019-10's and the status files. It is left for a quality pass.

## Found, not fixed (outside 019-11's files)

- `squeal ps` counts slot permits by `^(pool\.\d+|slow(\.\d+)?)\.lock$` (`src/core/ps/host.ts:66`) in the base directory only. A configured group's `group.<name>.<i>.lock` is not counted as held, and under the `"repository"` scope no slot file in `repo.<key>/` is, the `slow` group's included. No wave 2 row owns `src/core/ps/`.
- `Slow slot:` (`src/core/status/slot-holders.ts`) reads `slowSlotDir()` itself. Under the `"repository"` default it must read `slotFiles("slow").dir(slowSlotDir(), commonDir)`, or it shows no holder; a group's holders need `heldPermits({ dir, permits, group })`. Texts are 019-16's.
- `plugins/claude-code/dist` drifts: `cli/squeal.mjs` and `cli/ps.mjs` bundle the slot code. This row does not own the build.
