# 004-60 notes: the slow tier waits for its own daemon's fast backlog

Spec 004 D2 as amended 2026-10-14 (the human, from a cezar warm-up whose browser files ran beside its whole unit-suite baseline and failed four tab-coordination tests under the contention). Built in 001-386's worker as its own commit, since both touch `slow-tier.ts`.

## The seam

- `src/core/scheduler/slow-tier.ts`: a new private `#fastFirst()` is `editPending() || (!#requested && !fastIdle())`. It replaces `editPending()` in the three places that decided whether fast work goes first:
  - `#candidates`: no slow candidates; the activity is `waiting for fast`.
  - `#select`, after the guard and the slot: the pump plans again.
  - `ended()`: the activity after a slow run.
- `fastIdle()` (the scheduler's `#fastIdle`) already meant "no fast work at all": no runner work, no fast file queued and no fast tier in flight. A queued fast file is the baseline's, a checkpoint's or `run --all`'s backlog, so the slow tier now needs exactly that unless a request is open.
- **An open `run --slow` request** waits only for an edit's work, as before. It runs beside the backlog one file per tier, since `fastIdle()` is false, which is D2's idle width.
- **The idle trigger and `run --all`'s slow files** wait for the backlog to drain. A `run --all` checkpoint's slow files therefore run after its fast files.
- **The pump** (`scheduler.ts`) is unchanged: `#slowMayStart` still asks the slow tier while a backlog tier is in flight, and `#candidates` answers at once. The pump then waits for the next event, and a fast tier's end notifies it, so nothing polls. Only the comments changed.

## Decisions the amendment did not settle

1. **A backlog tier that arrives while a slow tier is in flight starts beside it.** No preemption: "a slow file in flight finishes" (D4). That keeps 004-34's "the backlog's next tier is not held behind the slow tier" for that window.
2. **Fast files queued behind another worktree's claim** (task 001-205) still count as queued backlog, so the slow tier waits for those claims too. The alternative, ignoring claimed files, would let the slow tier start beside a baseline that is about to resume.
3. **Under the 001-386 pool** a `run --slow` request beside this daemon's held backlog may find no permit (the backlog tier has the daemon's free worker). It runs ungranted rather than waiting for that tier, so "runs at once" holds (001-386 notes, S1).

## Tests

- **New:** `test/scheduler/slow-backlog.test.ts`, with one file per backlog tier so the baseline stays queued behind a held first tier.
  - "runs every fast backlog tier of a baseline with slow files first": while the first backlog tier is held, and with the idle trigger and zero load, no slow file runs and the activity is `waiting for fast`. After the release every fast run comes before the first slow run, and the slow tier takes both files at once (idle width).
  - "runs a `run --slow` request at once beside the held baseline": `hostSlots` 1, so the pool has no permit. Both slow files run while the backlog is still held, one per tier, without a grant.
  - **Discrimination check:** with `#fastFirst` reverted to `editPending()` the first test fails, because the slow runs started beside the held tier. The second passes either way, as its control.
- **Retired:** `slow-parallel.test.ts` "runs slow files one at a time beside a held backlog tier" asserted the behaviour this amendment reverses. Its helper went with it.
- **Adjusted:** `slow-activity.test.ts`.
  - Three tests waited for the first `waiting` activity. That is now `fast` while the baseline runs, so they wait for the reason they check (`idle`, `slot`, `load`).
  - Four tests hold one slow file per tier and assumed the first slow tier started beside the baseline (one file wide). They now set `slow.maxParallel: 1`, and the header test's committed policy says the same.
- Every `*slow*` test file outside fixtures passed after the change: 38 files, 315 tests (`npx vitest run $(find test -name "*slow*.test.ts" -not -path "*/fixtures/*") --maxWorkers=4`).

## Proposed wording

D2 as amended already says it ("It also waits while its own daemon's fast backlog … an explicit `squeal run --slow` still runs at once"). Its first sentence still says "background fast work (the baseline, an environment change, `run --all`) does not hold it back, and runs beside it in its own lane", which now contradicts the amendment. Proposed replacement: "background fast work (the baseline, an environment change, `run --all`) holds it back too (amended 2026-10-14, task 004-60) unless `squeal run --slow` asked; a backlog tier that arrives while a slow tier runs starts beside it in its own lane."
