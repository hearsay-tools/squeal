# 011 wave 125: a backlog tier's gate reads fresh CPU

Row 011-417. Coordinator 4abb5168, 2026-11-20. A defect against spec 011 C10 Size ("plus the cores its tiers use now; so a tier of its own that ended since counts no more"), found by row 011-413 (`research/run-width-design.md` section 1 and recommendation 1, probe `probes/run-width-design/stale-cores.ts`). One worker, one candidate, one review.

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. Every direct `vitest` run with `timeout` and `--maxWorkers=2`. Grep ALL of `test/` for changed paths; run any `test/e2e/**` match directly with `timeout 900`. Read `squeal status --wait 60000 <changed-path>...` before you report. Write `~`, never a home path. Notes in `tasks/011-417/notes.md` with the proposed C10 text.

## W1: 011-417 a backlog tier's gate reads fresh CPU

Use /worker. Shape: repair. Outcome: (1) when a lease ends or returns permits, its daemon counts the workers it still holds, not the ended tier's measured CPU, until a window that starts then is measured; (2) a backlog tier's gate re-reads the host's busy cores once the last reading is 1 s old, not 30 s. Effect: the next tier after a wide one ends gets its permits (8 of 9 in the probe, not 0 to 2), and a waiting daemon gets 9, not the 1-permit floor, once the other daemon's tier ends.

Read: `research/run-width-design.md` sections 1 and Recommendation 1; spec 011 C10 Size; spec 021 D18; `src/core/capacity/pool.ts` (`#measured`, `#busy`, the window freshness), `cores.ts`.

First edit: in `src/core/capacity/pool.ts`, reset the measured tree window when a lease ends or shrinks, and shorten the host reading's freshness for a backlog gate to 1 s.

Owns: `src/core/capacity/**`, their tests. Leave alone: `src/core/scheduler/**`, `src/cli/**`.

Done when: tests from the probe's cases A to C (a node:test slot open, a 9-wide tier at 9.5 / 8.2 / 7.2 cores ends, the next tier asks at once: 8 permits) and case E (a second daemon waits while the first holds 9; the first ends: the waiter gets 9 at that moment), each failing on the current code; existing capacity, ceiling and pool-wait tests pass.

## W2: 011-418 a narrow backlog tier is short

Use /worker. Shape: slice. Approved by the human on 2026-11-20 (card of coordinator 4abb5168: "Yes, with the fix"). Outcome: a backlog tier's wall budget (`BACKLOG_TIER_BUDGET_MS`, 120 s, or half `runner.timeoutMs` when less) is scaled by the offer's share of the background ceiling, at most 1, so a tier offered 1 of 9 workers selects about 13 s of files and its width is chosen again soon; a tier offered the full ceiling is unchanged. The trim at a grant below the offer uses the grant's share.

Read: `research/run-width-design.md` (section 2 and recommendation 2, arm (c+d)), spec 011 C4 step 5, spec 021 D18. The VM-only patch of arm c is under `research/probes/run-width-design/`.

First edit: where the backlog tier's budget is applied (`src/core/scheduler/backlog.ts`, `BACKLOG_TIER_BUDGET_MS`) and where the offer is known (`tier-pick.ts`).

Owns: `src/core/scheduler/{backlog,tier-pick,tier-plan,tier-width}.ts`, their tests. Leave alone: `overrun.ts`, `yields.ts` (W3), `src/core/capacity/**` (W1, integrated).

Done when: tests: an offer of 1 of 9 selects at most about 13 s of files by last-known duration; an offer of 9 of 9 selects as today; a grant below the offer trims by the grant's share; a file with no known duration still makes progress (at least one file per tier).

## W3: 011-419 the stuck-file rule counts from the tier's last progress

Use /worker. Shape: repair. Approved by the human on 2026-11-20 (card of coordinator 4abb5168: "Yes"). Outcome: a tier overruns (row 011-399) only after none of its files has ended for the threshold, counted from its last progress (the later of its start and its last ended file, calendar-stepped as today), not from its start. A narrow tier whose files keep ending never overruns; a truly hung file still does after `max(10 × its last-known time, 60 s)` without progress.

Read: `research/run-width-design.md` section 3, spec 011 C4 step 5 and C6, rows 011-399 and 011-405 (`tasks/011-405/notes.md`), `reviews/0.1.567*.md` on B2 (one elapsed-time basis for threshold, age and deadline).

First edit: `src/core/scheduler/overrun.ts` `overrunAt` and `reportedOverrunAt` (`steppedStart`): count from the tier's last progress; `Tier.ended` already records which files ended, so record when.

Owns: `src/core/scheduler/{overrun,yields,yield-waits,tiers}.ts` where the end time is recorded, status overrun texts if their age wording changes, their tests. Leave alone: W2's files, `src/core/capacity/**`.

Done when: tests: a 60-file narrow tier whose files end every 5 s runs 120 s with no overrun and no beside tier; a tier with one hung file and the others ended overruns at the threshold after its last ended file; the 011-399 and 011-405 tests pass (adjust only an expected age that now counts from the last progress, and say so in notes).

Benchmark (process step 6c): the coordinator runs `ref,wt-3,load-50` on squeal--v0.1.572 and on the candidate (W1 to W3 together) and compares them in `tasks/011-417/bench.md`; workers do not run it.
