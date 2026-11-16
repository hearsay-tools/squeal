# Wave 118: the pool's wait keeps its times on elapsed time (row 011-389)

Coordinator 4c0bbe28, 2026-11-17. Approved by the human on 2026-11-17 ("Row 389: Approve"). Base: main at 0.1.529. The candidate takes the next version after coordinator 4d2ecbfc's 0.1.530 (the number is settled with the live coordinators before the raise).

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-389

Use /worker. Shape: slice. Effort medium.

Outcome: after a calendar set-back or set-forward, the pool's wait (`PoolWaits` in `src/core/scheduler/pool-wait.ts`) shows fresh gate fields, refreshes its row on time and never logs negative seconds; the stored row keeps its shape and its calendar `since` and `at` for status.

Read: board row 011-389; `tasks/011-386/notes.md` "Effects and limits"; `reviews/0.1.529.md` (the pool probe); `tasks/011-377/notes.md` (Design: how wait owners keep elapsed time or move their kept times by a calendar step); `src/core/scheduler/calendar-steps.ts`.

Lead: test first, on the virtual clock with `shiftCalendar`: a refusal, a 1 h set-back, more refusals (today: old gate fields kept, negative seconds in the grant log), and a 1 h set-forward (today: a new wait starts). Then keep `last` and `#publishedAt` (the refresh and freshness limits) on elapsed time, or move them by the step as row 011-377's owners do; `since` stays the stored calendar fact. Owns: `src/core/scheduler/pool-wait.ts` and its tests (`test/scheduler/calendar-steps-rows.test.ts` or a new file). Leave alone: `src/core/capacity/` and `local-permits.ts` (card 10; `SLOT_WAITER_FRESH_MS` is theirs to read, not to change).

Done when: row 011-389's done-when; the new cases failed before; behaviour without a calendar change unchanged (no status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck, `squeal status --wait 60000` on the changed paths (report pending as pending); `tasks/011-389/notes.md`.
