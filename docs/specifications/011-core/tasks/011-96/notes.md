# 011-96 to 011-98: worker notes (W6 of `host-load-wave-2.md`)

Code rows of design 011-83 (`../011-83/design.md` sections 1, 2, 3.3 and 7, C10 as amended 2026-10-21), one commit each, in order. Worker f85aae0a, 2026-10-22.

## Seam map

| Row | Seam | Files |
| --- | --- | --- |
| 011-96 | `fairShares` loses its floor of 1; a share may be 0. `PermitPool.acquire` makes a daemon that holds nothing and gets nothing a waiter (`grant < max(entitled, inUse === 0 ? 1 : 0)`), marked with `since`. A refused look sets `#idleSince`, so a waiter that stops looking forgets its age after 30 s. `TierCapacity.refused()` tells the pump a look got nothing; the pump then waits for an event or `CAPACITY_RECHECK_MS` (2 s), `#capacityWake` in `scheduler.ts`. The slow tier's `WAIT_FOR_CAPACITY` branch no longer arms its own timer. | `share.ts`, `pool.ts`, `marks.ts`, `scheduler/capacity.ts`, `scheduler.ts`, `slow-tier.ts`, `tiers.ts`, `types/runner.ts` (doc) |
| 011-97 | `executeTier`'s `fileEnded` shrinks the lease to the files left (`lease.shrinkTo(left)`). `tierWidth(want, ceiling, floor)` in `runners/vitest/width.ts`: floor 2 only for a project that batches (`isolate: false`, not `vmThreads`/`vmForks`); projects that read the root's width share the root's floor. A tier's `least` is `fewest()` = min(files, the widest `tierWidth(ref, 1)`); `acquire(want, lane, least)` takes at least `least` or nothing; the mark carries `least`; `fairShares` raises a waiter's share to its `least` (`raiseToLeast`). | `pool.ts`, `share.ts`, `marks.ts`, `scheduler/capacity.ts`, `tiers.ts`, `runners/vitest/width.ts` |
| 011-98 | `capacity/cores.ts`: `createTreeCpu` measures the daemon's tree with 014-21's `measure` (daemon as its only row), tree listed from `/proc/<pid>/task/*/children`; `gatedPermits` is the gate. `PermitPool` reads the tree at each mark refresh and writes `cores` in its mark. `PermitPool.running(workers)` marks an edit's tier: want 0, its cores, no permit, no wait; `executeTier` calls it for a tier without a lease. `loadUserConfig` cuts `hostSlots` to the CPU count and returns `cut` for the note. | `cores.ts` (new), `pool.ts`, `marks.ts`, `scheduler/capacity.ts`, `tiers.ts`, `daemon/user-config.ts`, `types/capacity.ts` |

## The 011-97 risk check (Vitest's sequential group at maxWorkers 1)

Vitest 5.0.3 `groupSpecs` puts an isolated project whose resolved `maxWorkers` is 1 into the last, sequential group. At width 1 that is harmless: those files run one at a time anyway. The real hazard is Vitest's throw "Projects ... have different 'maxWorkers' but same 'sequence.groupOrder'". It fires when one tier holds an isolated project that reads the root's width (1) and an `isolate: false` project that sets its own floor (2). So projects that read the root's width share the root's floor, and the tier's `least` keeps the grant at or above the widest floor. `test/runners/vitest/width.test.ts` pins the mixed case. No sibling project on this host uses `isolate: false` (cezar, squeal, weryfikator-powolan, wiktor checked).

## Decisions the design left open

1. **Who is a waiter.** `grant < max(entitled, inUse === 0 ? 1 : 0)`: a daemon that holds nothing and gets nothing waits even at a share of 0, so it is served first at the next division. A daemon that holds permits and got its share is not a waiter.
2. **The pump's capacity wake** lives in `scheduler.ts` (`#capacityWake`), outside the brief's file list. Without it, a refused pump with nothing in flight restarted itself at once (`#hasWork()` stays true), a busy loop.
3. **`raiseToLeast`** is not in the design. A tier whose `least` is 2 at hostSlots ≤ daemons could otherwise wait forever, its share never reaching 2. In seniority order, a share above 0 and below its `least` is raised to it from the most junior shares. Where those hold too little it stays, and the tier waits until it is senior to enough of them.
4. **The offer is gated too.** `offer()` returns `min(target, gated)`, so a tier is sized to what the gate lets it take.
5. **Edit marks.** An edit-only mark has `want` 0 and is left out of `fairShares`; only its `cores` count, under the gate. `#publish` writes the raw want (no `max(1, want)`).
6. **A refused look's want** (`#pending`) stays in the mark when an edit's tier republishes it, so a waiter keeps its demand while its edit runs. It is forgotten with the waiter's age.
7. **No `/proc`, no gate.** `createTreeCpu` returns `null` where the daemon's own process cannot be read; then `running()` is a no-op and the pool counts processes only.
8. **`cut`, not a problem.** A `hostSlots` above the CPU count is not wrong input: the config keeps the rest of the file and the note says "it is cut to N" without "the defaults apply in their place". `LoadedUserConfig.cut` is a new optional field.
9. **A dead daemon's fresh mark counts.** Its `cores` stay in the gate until the mark is stale (30 s). `test/capacity/crash.test.ts` gives the survivor `cores: null` to test the permits alone.
10. **The edit mark ends with the edit.** When an edit's tier ends and no lease is held, the mark is cleared, a waiting mark too; the pump's next look (≤ 2 s) writes the waiting mark again.

## Tests

- 011-96: `test/capacity/share.test.ts` (no floor), `test/capacity/pool.test.ts` (shares 0, waiter age forgotten after 30 s without a look: fails without the `#idleSince` reset on a refused look), `test/scheduler/capacity-pool.test.ts`, `test/scheduler/slow-pool.test.ts`, `test/capacity/pool-failure.test.ts`, `test/capacity/crash.test.ts`, `test/scheduler/backlog-slots.test.ts` case 4 (another daemon's first look gets nothing, then a permit within one slot's file): red before, green after.
- 011-97: `test/scheduler/tier-holds.test.ts` (new: tail release; an `isolate: false` tier waits for 2), `test/runners/vitest/width.test.ts` (floors, mixed projects), `least` cases in `pool.test.ts` and `share.test.ts`. `test/keys/validity/adapters.test.ts` ("fires none for a change to Vitest's width hints") edits `width.ts`'s new width line.
- 011-98: `test/capacity/gate.test.ts` and `test/capacity/cores.test.ts` (new, red: no module), `test/scheduler/capacity-gate.test.ts` (new: an edit's tier starts beside a full pool and marks want 0 with its cores), `test/daemon/user-config.test.ts` (cut and its note).

## For the next worker

- `src/core/ps/host.ts` `hostSlotsOf` (014's file) does not cut `hostSlots` to the CPU count; `squeal ps` can show a larger figure than the daemons use.
- The scheduler test harness's recording runner does not forward `tierWidth`; a test that needs a floor sets `h.runner.tierWidth` itself (`tier-holds.test.ts`).
- `pool.ts` is 464 lines and `tiers.ts` 748, both over the 300-line guideline before these rows (354 and 726). The lease bookkeeping in `pool.ts` (`#activate`, `#deactivate`, `#forget`, `#cores`, `#gated`) is the natural piece to move out.
- Daemon tests that pin `hostSlots: 16` (`drain.test.ts`, `step-down-lanes.test.ts`, `stop-cancel.test.ts`) get the CPU count on a smaller host. Two slow files at `slow.maxWorkers` 2 need 4 permits, exactly a 4-CPU runner's.
- Two comments outside these rows' files still name the free worker; their tests pass: `test/scheduler/catch-up-turn.test.ts` ("gives way to the edit's tier ...", now the daemon's last permit) and `test/scheduler/slow-backlog.test.ts` ("runs a run --slow request at once ...").
- Bundles are not rebuilt (no build in W6): the three bundle-drift checks fail until the coordinator builds.
