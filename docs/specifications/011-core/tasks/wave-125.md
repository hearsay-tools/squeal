# 011 wave 125: a backlog tier's gate reads fresh CPU

Row 011-417. Coordinator 4abb5168, 2026-11-20. A defect against spec 011 C10 Size ("plus the cores its tiers use now; so a tier of its own that ended since counts no more"), found by row 011-413 (`research/run-width-design.md` section 1 and recommendation 1, probe `probes/run-width-design/stale-cores.ts`). One worker, one candidate, one review.

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. Every direct `vitest` run with `timeout` and `--maxWorkers=2`. Grep ALL of `test/` for changed paths; run any `test/e2e/**` match directly with `timeout 900`. Read `squeal status --wait 60000 <changed-path>...` before you report. Write `~`, never a home path. Notes in `tasks/011-417/notes.md` with the proposed C10 text.

## W1: 011-417 a backlog tier's gate reads fresh CPU

Use /worker. Shape: repair. Outcome: (1) when a lease ends or returns permits, its daemon counts the workers it still holds, not the ended tier's measured CPU, until a window that starts then is measured; (2) a backlog tier's gate re-reads the host's busy cores once the last reading is 1 s old, not 30 s. Effect: the next tier after a wide one ends gets its permits (8 of 9 in the probe, not 0 to 2), and a waiting daemon gets 9, not the 1-permit floor, once the other daemon's tier ends.

Read: `research/run-width-design.md` sections 1 and Recommendation 1; spec 011 C10 Size; spec 021 D18; `src/core/capacity/pool.ts` (`#measured`, `#busy`, the window freshness), `cores.ts`.

First edit: in `src/core/capacity/pool.ts`, reset the measured tree window when a lease ends or shrinks, and shorten the host reading's freshness for a backlog gate to 1 s.

Owns: `src/core/capacity/**`, their tests. Leave alone: `src/core/scheduler/**`, `src/cli/**`.

Done when: tests from the probe's cases A to C (a node:test slot open, a 9-wide tier at 9.5 / 8.2 / 7.2 cores ends, the next tier asks at once: 8 permits) and case E (a second daemon waits while the first holds 9; the first ends: the waiter gets 9 at that moment), each failing on the current code; existing capacity, ceiling and pool-wait tests pass.
