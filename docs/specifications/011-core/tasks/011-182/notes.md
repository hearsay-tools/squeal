# 011-182: on a busy host, a backlog tier takes permits only below half the slots

Worker 3dd9fc58, 2026-10-24, wave 32 W13. Brief: `tasks/wave-32.md` W13. Spec: 011 C10 Size as amended 2026-10-24. Evidence: `research/host-load/011-139.md` findings 3 and 5, recommendation 2. The brief names the research file as `research/host-load/011-139.md`; it is under this spec's folder, `docs/specifications/011-core/research/host-load/011-139.md`.

## What changed

- `src/core/capacity/cores.ts`: `gatedPermits(marks, own, hostSlots, want, busy = null)`. The CPU sum starts at the larger of the marks' cores, the daemon's own included, and `busy`. `null` adds nothing. A new `HostCpu` reader, `createHostCpu({ root, now })`, gives the host's busy cores since its last read. It reads `/proc/stat` through `squeal ps`'s source (`cpuTime`): busy is every CPU time except idle and iowait, so `%nice` (Squeal's niced tests), irq, softirq and steal count. Ticks per second come from `clockTicks()`, over the reader's monotonic clock. It is `null` where `/proc/stat` cannot be read.
- `src/core/capacity/pool.ts`: `PoolCapacity.host?: HostCpu | null`. When it is omitted, the pool reads the host's `/proc/stat`. `null` gates every tier on the marks' CPU alone. A pool that cannot read its tree (`cores: null`) reads no host either. New: `PoolTierKind = "backlog" | "checkpoint"`, `acquire(want, lane, least, kind = "checkpoint")`, `offer(want, lane, kind = "checkpoint")`, `HOST_WINDOW_MIN_MS = 1_000`. `#gated` passes `busy` only for `"backlog"`.
- `src/core/scheduler/capacity.ts`: `TierCapacity` passes `host` through. `take(want, lane, least, kind = "checkpoint")` and `offer(want, kind = "checkpoint")`. The new `poolKind(open, picked?)` names a tier's kind.
- `src/core/scheduler/tiers.ts`: the backlog offer passes `poolKind(ledger.checkpoints.active)`. The take passes `poolKind(ledger.checkpoints.active, picked)`.

Every type change is additive: one optional field, one new type, optional trailing parameters, two new exports, one new function.

## Seam map

- The pool reads the tree and the host together (`#read`), at four points: when the pool is made (the first window starts), in `#activate` after `tree.reset()`, at each mark refresh, and at a backlog gate whose window is stale. A read stores a window only when both readers give a value. The first tree read after a reset gives none.
- A window holds `max(0, host − tree)`: what the host used beyond this daemon's tree. A backlog gate adds the daemon's cores now (`#cores()`: as measured, else one per worker). While its tier runs, that equals the host's busy cores. At a tier boundary its own ended tier counts no more.
- A window is fresh for `SLOT_WAITER_FRESH_MS` (30 s), the same time as a mark. A stale window is read again at a backlog gate, over the time since the last read, but at the soonest `HOST_WINDOW_MIN_MS` after that read. With no window, `busy` is `null` and the gate is today's.
- Only `tiers.ts` asks for a backlog kind. `slow-tier.ts` (the slow lane) and the edit's `running()` are unchanged.

## Done-when, and the checks

| Done-when | Check |
|---|---|
| A backlog acquisition's CPU sum starts at the larger of the marks' CPU and the host's busy cores over the refresh window | `test/capacity/host-gate.test.ts`: `gatedPermits` cases (null, above the slots, below them, the larger and never the sum); the pool "busy host shrinks a backlog acquire and offer" and "a host busy at the slots" (coordinator item 4: 4 beside 2 held, below half of 12) |
| A checkpoint tier and an edit's tier are unchanged | the same two pool tests: the checkpoint's grant equals a pool with `host: null`; `test/scheduler/host-gate.test.ts`: a `run --all --force` tier runs at 4 of 4 slots while the host reads 23.9 cores, and a backlog tier at 2. The edit's tier takes no permit (`running()`, no change); `test/scheduler/capacity-gate.test.ts` still passes |
| Where the host's CPU cannot be read, today's gate holds | "where the host cannot be read" (`host: null`, and a read that gives `null`); `createHostCpu` without `/proc/stat` is `null` |
| A host where Squeal is the load is unchanged | "a tier of its own that ended counts no more" (10 again, not 6); "the larger ... never their sum"; "a daemon's own running tier counts beside what the host used beyond its tree" (2, not 6) |
| The kind reaches the pool | `poolKind` cases in `test/scheduler/host-gate.test.ts`, and that file's scheduler test. By reasoning, not run: with either kind forced on every tier, one of its two width assertions fails |
| The reader | "the host's busy cores": a fixture `/proc/stat` over 2 s gives 8.5 cores; nice counts, idle and iowait do not |
| The window | "a window older than a mark's freshness is read again": fresh to 30 s, read again once stale, a checkpoint's offer reads nothing, a read 999 ms after a read that gave nothing is not made |
| No key-format raise | the key-format alarm tests pass (below); this row changes no key input |

## Decisions the spec did not settle

1. **A daemon's own ended tier.** The window that the gate reads at a tier boundary holds the tier that just ended. A naive "host busy cores" would halve each next backlog tier of a daemon that runs consecutive tiers on an idle host: 11 busy cores at 12 slots leave 6, where today gives 10. That breaks "a host where Squeal is the load is unchanged". So the gate reads the host's busy cores beyond this daemon's tree, over the same window, plus the daemon's cores now. During a tier this is the host's busy cores. Test: "a tier of its own that ended counts no more".
2. **Freshness and the first window.** A window is fresh as long as a mark is (30 s). A stale one is read again at a backlog gate over the time since the last read. After a long idle time this is a long average. That is better than nothing, because the research shows the outside load lasting minutes (finding 3, 11:53 to 12:02). It is never read sooner than 1 s after the last read, because shorter windows of `/proc/stat` at 100 ticks a second are noise. So a daemon's first backlog tier, when it comes less than 1 s after the pool is made, gets today's gate. The pool is made with the scheduler, before the bootstrap.
3. **Which tier is the checkpoint's.** While the open checkpoint is explicit (a `run --all` among its records, `Checkpoints.active.explicit`), a tier that holds a file it requested is the checkpoint's. So is the offer before the pick. A tier that holds none of its files is the backlog's, and its smaller grant trims the pick as a grant below the offer does today. A baseline checkpoint's tiers are the backlog's.
4. **The backlog's turn** (after four tiers of the first group) is the backlog's: it runs the backlog's files.
5. **The slow lane** (`slow-tier.ts`) keeps the marks' CPU. C10 Size and the brief name no change there.
6. **Test pins** (coordinator decision, reply to request `7e30249e`): the product default reads `/proc/stat`. A test pool reads no live host CPU through the gate. Pins, each in a test-only commit apart from the src change:
   - `test/scheduler/helpers.ts:353` (`openHarness`): every scheduler-test pool gets `host: null` unless the test passes a reader. Before the pin, `capacity-pool.test.ts:180` got 1 permit, not 2, on this host.
   - `test/scheduler/catch-up-fixture.ts`: its own `createScheduler` with a real pool. Before the pin, `edit-cut-route.test.ts` case 6 saw 2 node:test slots active, not 4.
   - `test/scheduler/wall-fixture.ts` and `test/scheduler/fresh-worktree-durations.test.ts`: the same `createScheduler` with a real pool, and both budget backlog tiers at the pool's offer. They passed on this host. They are pinned because their widths depend on the live host in the same way, so CI could fail them.
   - No `test/daemon/*` file passes pool options, and none failed. The daemon tests that write a user config (`drain`, `step-down-lanes`, `stop-cancel`, 16 slots) run real daemons, which read the live host by the product default. There is no config key that pins it.

## Known limits

- Another daemon's tier that ended inside the last window: its CPU is still in the host's busy cores, but its mark is gone. On a host where only Squeal runs, a daemon that starts a backlog tier within about one refresh (10 s) of another daemon's tier end can get a smaller grant. The tier keeps that grant to its end. The tree correction covers only the daemon's own tree.
- Spawned daemons in integration and e2e tests read the live host, as the product does. Their outcomes must not depend on backlog widths. `test/integration/capacity-project.test.ts` caps the project at 2 of 8 slots, and half of 8 is 4, so it is not affected.
- Pools that tests build without `host` read `/proc/stat` when made and when a tier starts. Only a backlog gate uses the value, and only `tiers.ts` asks for one. So no test outcome depends on it.

## Proposed spec wording (C10 Size)

The amended sentence now reads: "For a backlog tier, the CPU compared with the slots is the larger of the fresh marks' CPU and the host's busy cores over the same window." Proposed:

> For a backlog tier, the CPU compared with the slots is the larger of the fresh marks' CPU and the host's busy cores, `%nice` included, that the daemon read beside its tree over its last window, less what its tree used in that window, plus the cores its tiers use now; so a tier of its own that ended since counts no more. A window is fresh for 30 s, as a mark is. A stale one is read again at the backlog tier's gate over the time since the last read, never sooner than 1 s after it. A tier that holds a file an open `squeal run --all` requested, and the offer before its pick, keep the marks' CPU alone. So do an edit's tier, the slow lane's tiers, and a daemon that cannot read the host's CPU or its own tree. The backlog's turn after four tiers of the first group is a backlog tier.

## Checks run

See the worker's final message for the pasted output of lint, typecheck and `squeal run --all --wait`.
