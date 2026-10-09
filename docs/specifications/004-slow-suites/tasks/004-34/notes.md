# 004-34 notes: the slow lane catches up

## The gate (D2 as amended)

- `TierScheduler.#editPending` (`src/core/scheduler/scheduler.ts`): runner work (a refinement in flight included), a recent fast entry queued (`RunQueue.hasRecent`), or an edit's tier in flight (a fast tier whose `cancel` is `null`). This is what holds the slow tier back; a backlog tier (it carries `cancel`) does not.
- `#fastIdle`: no runner work, no fast entry queued, only slow lanes in flight. It decides an idle tier's width, together with the guard's answer (`ranUnderLoad === null`: load at or below `slow.maxLoadPerCpu`).
- `#slowMayStart`: the pump asks `SlowTier.next()` when nothing is in flight (as before; that call also ends a drained pass: `#requested`, the budget, the activity), or when slow files are queued and no slow lane and no edit's tier is in flight.
- A fast tier that ends calls `SlowTier.preempt()`, so a load guard wait beside a backlog tier gives way and the backlog's next tier is selected; the wait resumes with the pass's remaining budget.

## Width and permits

- `SlowTier.next()` picks the triggered candidates of the first one's lane, waits for the guard, asks the slot for `min(maxParallel, candidates)` permits when idle, else one; `#select` re-checks idleness under the lock and `shrinkTo`s the permits it does not use.
- `acquireSlowSlot` (`src/core/slow/slot.ts`): `permits` and `want`, additive. Permit 0 is `slow.lock`, so a daemon before 0.1.61 (one slot) and a new daemon with `slow.maxParallel` 1 hold the same file; the others are `slow.<i>.lock`. During a mixed-version period an old daemon holding `slow.lock` and a new one holding `slow.1.lock` run beside each other.
- A non-idle one-file tier takes one permit, so with the default 4 up to four worktrees of one user run one slow file each at once (the brief's "a tier of k files holding k"; D2's older sentence "one slow tier at a time per user" now reads as one permit per file).

## Runners

- Vitest: the slow instance gets `max(slow.maxWorkers, slow.maxParallel)` workers (`src/core/daemon/daemon.ts`, read when the pass's instance is made). Not keyed: the slow instance's environment is never asked for.
- node:test: unchanged; a run's concurrency is `runner.tierSize` (default 4), so a slow tier wider than `runner.tierSize` runs that many files at once.

## Left open

- The running activity names the tier's first file only, with the longest known duration of its files; D8's line says "running <first file>" for a several-file tier (`src/core/state/slow-text.ts`, not this row's).
- `references/commands.md` (both skills) says `run --slow` runs "as soon as no fast work is pending"; it is now "no edit's fast work".
- The bundles are not rebuilt (wave rule).
