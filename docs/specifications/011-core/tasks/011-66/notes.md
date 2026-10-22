# 011-66: a tier that crashes while its daemon stops is queued once more, worker notes (2026-10-22)

Brief W1 of `../wave-13.md`, base `a5901f2bf` (0.1.261). Evidence `../../research/issue-50.md`, symptom 2 and its Recommendation. Spec 011 C4, C9 and D12's no-loop rule.

## What changed

- A tier whose run ends `crashed` after the daemon's stop began queues its uncompleted files again, at the key each ran under, instead of marking them UNKNOWN. Their rows stay `queued`, so the successor's `handover` (011-33) runs them under any `baseline.onStart`.
- Once per key: the key of each file's last such re-queue is kept in `meta` as `interrupted:<worktree>` (`src/core/scheduler/interrupted.ts`). A second crash while stopping, of the same file at the same key, records as before: UNKNOWN, out of the queue. A crash outside the stopping phase is unchanged.
- The stopping phase is the daemon's own: `SchedulerOptions.stopping`, which the daemon sets to `phase === "stopping"`. `#shutdown` sets that phase first, before `loop.close()`. Without the option, the scheduler's own close counts.
- A stopping scheduler starts no tier (`#stopping()` in the pump). Before, the pump ran until `scheduler.close()`, which `loop.close()` calls only after the watcher closed. In that window a re-queued file could start again and crash a second time.

## Seam map

- `src/core/scheduler/scheduler.ts` `#record`: builds `requeue` for `recordTier` from the withholds, a stop's cancel (`unfinished`) and now `interruptedFiles`. It is computed inside the record's transaction, because `interruptedFiles` writes the `meta` row.
- `recordTier` (`tiers.ts`) and `storeDecision` (`store-decision.ts`) are unchanged. A file in the `requeue` set decides `requeue` and is enqueued with its class, as an install move's files are. `store-decision.ts` is on the key-format alarm's path (row 011-40), so leaving it alone keeps every version where it is.
- A stop's cancel (`squeal stop`, a step-down) already re-queues what it cut short, without a limit (task 001-367). `interruptedFiles` leaves those runs alone (`stopping && !cancelled`), so a cancel never uses up a file's one re-queue.
- `WORKTREE_META_ROWS` gains `interrupted`, owner `scheduler/interrupted`; `WorktreeRepo.remove` drops it with the worktree. `interruptedFiles` forgets the files the ledger no longer holds on each write.

## Decisions the spec did not settle

1. "A second such crash at the same key" is counted per file, not per tier, and over the file's whole life at that key. A file that crashed while stopping, then passed at the same key, and is forced to run again and crashes while stopping again is UNKNOWN the second time. The other reading, consecutive crashes only, needs a write on every stored result.
2. A crashed run's completed files keep their results, as D12 has them today; only the uncompleted files are queued again. Vitest's pool crash completes none.
3. Only `crashed` counts. A `timed-out` run while stopping is unchanged: no stop causes a timeout.

## Type changes (additive)

- `SchedulerOptions.stopping?: () => boolean` (`src/core/scheduler/options.ts`).
- `WORKTREE_META_ROWS.interrupted` (`src/core/types/store.ts`).

## Tests

`test/scheduler/stopping-crash.test.ts`, three cases with the catch-up fixture's runner, its runs turned `crashed` with Vitest's pool error: the crash while stopping leaves the files queued and the successor runs them; a second crash at the same key is UNKNOWN and a third daemon runs nothing; a crash outside the stopping phase is UNKNOWN and unqueued, as before.
