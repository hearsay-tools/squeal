# 011-163 notes: a departure drain ends when its slow files wait

Worker W4 of wave 26, 2026-10-23. Row 011-163; 011 C9 and 004 D2 as amended 2026-10-23; `research/drains.md` option (a′).

## What changed

- `src/core/daemon/lifecycle.ts`: the departure check asks `slowWaiting` while a drain runs. When the drain's slow lane has waited `DRAIN_SLOW_WAIT_MS` (60 s), the daemon exits with reason `sessions-gone` and one note: `daemon stopped: no slow file ran for 60 s once the fast work pending when its last session ended was done; N slow files left queued for the next daemon in this worktree: <paths>`. The paths go through `listPaths` (5, then "and N more").
- `src/core/scheduler/scheduler.ts`: the new reader `slowWaiting()` and its field `#drainBusyAt`; `pauseBacklog` clears the field. Nothing else in the file.
- `src/core/scheduler/slow-tier.ts`: `ended()` stamps `endedAt`, the time a slow run last ended (recorded, discarded or put back).
- By agreement with coordinator 04a258b0 (request 569ed56c, option a), commit `c216c6985`: the `SlowWaiting` type and `Scheduler.slowWaiting` in `src/core/types/scheduler.ts`, and the one `slowWaiting` entry in `daemon.ts` `#startTimers`. That commit typechecks only with the next one (`50f3c4bad`).

## Seam map

- The departure check (`startTimers`, `departure`) polls every `presenceMs` (250 ms). The drain starts in it (`pauseBacklog(true)`), and it is the only caller of `slowWaiting`.
- "The drain's fast work" is what the slow tier's `#fastFirst` waits for during a drain: `#editPending()` or `!#fastIdle()`. With the backlog paused, `Ledger.fastQueued` counts only the drain's files (an edit's work, promoted files, the explicit checkpoint's, re-runs), so `#fastIdle` is that rule. A backlog tier in flight at the drain's start is fast work until it ends.
- A slow tier in flight is `#lanes().some(isSlowLane)`. Only one runs at a time (`#slowMayStart`).
- `SlowTier.ended()` is the one place every slow run's end passes: `TierRecords` calls it through `slowEnded`, and `#requeue` calls it.

## Decisions the spec did not settle

1. **When the 60 s start.** The spec says "a drain whose fast work is done ends once its slow files have had no run for 60 s". The count starts at the latest of: the drain's first check, the last check that found fast drain work or a slow run in flight, and the last slow run's end. So fast work longer than 60 s does not end the drain at its end; the slow files get 60 s after it. The scheduler test and the first real-daemon test pin this.
2. **Resolution.** The end of fast work is known to one departure check (250 ms), since the scheduler has no event for "the drain's fast work is done". A slow run's end is exact (`endedAt`), so a run shorter than a check still restarts the count.
3. **No slow file queued** is no wait: `slowWaiting` is `null`, and the drain ends by the old rules (drained, or the bound). So the note always names at least one file.
4. **Owed work that is slow** (an open checkpoint's slow files, a slow file's re-run) is left with the slow files. The checkpoint stays owed to the next daemon, as at the bound.
5. **Hold:** `slowWaiting` is `null` on hold, like `slowPending` and `owedWork`.
6. The reason why the slow files wait (the slot, the load guard, the pool, another worktree's claim, the quiet window) does not matter: each is "no run".

## Type changes

- New `SlowWaiting { since: EpochMs; paths: readonly RelativePath[] }` and `Scheduler.slowWaiting(): SlowWaiting | null` (`src/core/types/scheduler.ts`). Additive. No fake implements the whole `Scheduler`, so the member is required.
- New `TimerContext.slowWaiting?` (optional) and the export `DRAIN_SLOW_WAIT_MS` in `lifecycle.ts`.
- `SlowTier.endedAt` getter.

## Tests

- `test/daemon/drain-timers.test.ts`: two cases with a stand-in `slowWaiting` and the timers' test clock: the exit at 60 s and its note text, and a registration that ends the drain and its wait.
- `test/scheduler/slow-waiting.test.ts` (new): the reader on a real scheduler with a fake runner. It counts from the drain's first check while the slow files wait at the slot; a running slow file is no wait, and the count restarts at its end; an edit's fast work is no wait. Two mutations failed it as they should: dropping `endedAt`, and dropping the fast-work condition.
- `test/daemon/drain-wait.test.ts` (new, about 180 s): real daemons under `lookup-only`, with the test holding the fixture's one slow permit. (1) An edit's held fast file runs to its end; the daemon exits at least 50 s after its release with the note; the slow row stays `queued`; a next daemon resumes it (011-33) and stores a pass. (2) A slow file that gets the slot 20 s into the drain runs past the 60 s, and the drain exits drained as before.
- Readiness under `lookup-only`: an edit written before the daemon's start ended is absorbed into the start scan and never runs. The test syncs first with `squeal status --wait 1000` (`#requestSync` awaits `#starting`).

## For the next worker

- W1 makes `lookup-only` the default. The new tests set `baseline.onStart` explicitly, so the default does not move them.
- W3 adds `focus?` beside these lines in `types/scheduler.ts` and `daemon.ts`; the integration merge should be textual only.
- The real-daemon tests in `drain.test.ts` (004-29) still pass unchanged. Its first case (a slow file running at the departure, released after 5 s) stays; `drain-wait.test.ts` case (2) covers a file that gets the slot during the drain.
