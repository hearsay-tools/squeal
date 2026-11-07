# Notes: rows 011-308 and 011-309 (wave 72, W1)

Worker W1, 2026-11-07. Design `design.md` (D1, D2). Commits: 011-308 first, then 011-309.

## What changed

**011-308 (D1).** `selectTier` (`src/core/scheduler/tiers.ts`). A batch's tier asks the pool as before. When the pool refuses it, or grants fewer workers than an edit's tier of its first `runner.tierSize` files runs with (`narrowerThanEdit`: the grant below `widest` of those files), the grant goes back and the selection runs again with `SelectPass.asEdit`. That pass takes at most `runner.tierSize` batch files, longest first, with no wall budget, no offer and no grant. The tier is still `kind: "backlog"` and `promoted: true`, and `batchStarted` runs for it at a width of its file count. It has no lease, so `executeTier` states its workers to the pool with `TierCapacity.running`, as an edit's tier does (row 011-98). The `asEdit` pass skips the focused tier and the post-batch turn, which the first pass already decided. A pool that grants at least an edit's width keeps row 011-268's one wide tier.

**011-309 (D2).**
- The pool records what each look read (`PermitPool.gate()`, `src/core/capacity/pool.ts`): the cores the CPU gate counted (`gatedCores`, `cores.ts`), the host's CPUs (`availableParallelism`), `hostSlots`, and the permits other daemons' marks hold.
- `TierCapacity.take` takes a fifth argument, `waitsIn`: the scheduler lane of a tier whose files wait while it is refused. `selectTier` passes its lane, except for a batch's tier, which goes on as an edit's (011-308) and holds nothing.
- `PoolWaits` (`src/core/scheduler/pool-wait.ts`, new) keeps one wait per lane. A wait starts at a refusal and goes on while the refusals come no more than 30 s apart (`SLOT_WAITER_FRESH_MS`, the pool's own waiter freshness). A grant in its lane ends it. The daemon's log gets one line at the start and one, with the seconds, at the grant; a recheck writes nothing.
- The waits are published in a new `pool-wait:<worktree>` meta row: `{ at, lanes: { <lane>: { since, busyCores, cpus, hostSlots, grants } } }`. It is written at a wait's start and end, at most every 10 s while a wait goes on (`POOL_WAIT_REFRESH_MS`), and dropped when no wait is left or the scheduler closes. Worktree removal deletes it with the other registered rows.
- Status (`src/core/status/standing.ts`) reads the row as it reads the quiet row: none older than the live daemon's start, and none older than 30 s. A queued, unpromoted file with no tier in its lane, in a lane the row names, gets `pool` on its `queued` standing. The quiet wait is checked first and wins.
- `queuedStep` (`next-step.ts`) words it as D2: `queued, waiting for CPU since HH:MM:SS: the host is busy (N of M cores in use; Squeal's daemons hold G of S test slots); the daemon asks again every 2 s`. The named line and the deadline line both read it. `--json` has it in each `wait.testFiles` entry's `reason` and `pool`, and in `outstanding[].standing.pool`.

## Edits outside the brief's ownership (agreed with the coordinator)

- `src/core/daemon/daemon.ts`: `log: this.#log` in the `createDaemonLoop` call (request 574e7cf6). `SchedulerOptions.log` is new and optional.
- `src/cli/named-file-lines.ts`: `pool?: PoolWait` on `NamedFileEntry` and its spread in `yieldFields` (request dcd7ef81).
- `src/core/types/store.ts`: `poolWait` in `WORKTREE_META_ROWS` (request fca7ec08).

## Type changes (all additive)

- `PoolGate`, `PoolWait` (new, `types/standing.ts`); `Standing` `queued` gains `pool?: PoolWait`.
- `PermitPool.gate(): PoolGate | null` (new method on the interface; `LockFilePool` is its only implementation).
- `TierCapacity` constructor gains `waits: PoolWaits | null = null`; `take` gains `waitsIn: string | null = null`.
- `SelectPass.asEdit?: boolean`; `SchedulerOptions.log?: (line: string) => void`; `NamedFileEntry.pool?: PoolWait`.
- `WorktreeMetaRow` gains `"poolWait"`.

## Deviations and choices the design did not settle

1. **"Grants other daemons hold".** `grants` counts other daemons' marks only, as D2 says. This daemon's own permits in another lane are not in it, though the gate counts them. "Squeal's daemons hold G" can then read lower than the gate's own count.
2. **Busy cores.** `busyCores` is the gate's count: the larger of the marks' cores (own included) and the host's busy cores. It is rounded and capped at the CPU count, so overcounting marks never read "30 of 24". Where no CPU is read (no `/proc`, so no tree), the line leaves out the cores part: `the host is busy (Squeal's daemons hold G of S test slots)`.
3. **Per lane, not per file.** The row names lanes, not files. Every queued, unpromoted file of a refused lane with no tier running reads the line, not only the refused tier's picks. A lane whose backlog tier is refused takes no tier, so all its queued files wait for the pool; the turn's refusal lets an edit's tier go, and its files then read "behind" that tier.
4. **What a wait is.** Refusals no more than 30 s apart, ended by a grant in that lane. A wait that ends without a grant (the lane's queue emptied) writes no end line; its row entry leaves at the next write, and status ignores the row after 30 s.
5. **The pool's waiter mark after a batch's refusal.** The pool still marks this daemon a waiter after the refused batch asked ("the batch asks the pool as today"). While the permit-free tier runs, that mark reserves for this daemon up to 30 s after its last look, as before D1.
6. **Slow and group tiers.** `slow-tier.ts` passes no lane: their refusals are not published or logged. Their files read `slow` with the slot holders, as before.
7. **Log wording.** Start: `the pool refused the vitest lane's tier: it waits for CPU (21 of 24 cores in use; Squeal's daemons hold 7 of 12 test slots); the daemon asks again every 2 s`. Grant: `the pool granted the vitest lane's tier after 63 s of waiting for CPU`. A batch's fallback writes no line.

## Spec sentences to amend (coordinator)

- C10 Capacity, "A pool wait is told": name the published fields as the code has them: `since`, `busyCores` (the gate's count, the larger of the marks' cores and the host's busy cores), `cpus`, `hostSlots`, `grants` (other daemons' permits). Add that a wait is refusals no more than 30 s apart, ended by a grant in its lane.
- C15 "A batch on a busy host": the line applies to every queued, unpromoted file of the refused lane with no tier running there, not only the refused tier's files; and without a CPU reading it leaves out the cores part.
- C15 "What the wait says" and C4 step 5, as the design's "Spec changes on approval" lists.

## Checks

See the final report of W1 for the commands and their results. The bundle drift tests (`test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`) fail as expected: `plugins/*/dist` are not rebuilt here (brief: no `pnpm run build`).
