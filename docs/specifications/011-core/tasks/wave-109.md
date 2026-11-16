# Wave 109: every decision in a step reads the step's one reading (row 011-372)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Row 372: Approve"). Evidence: `../reviews/0.1.518.md` S1 (the helpers that still read the clock inside a turn, with lines). Base: main at 0.1.519 (released). Candidate 0.1.520 (row 011-369, the wake loop's one time) is held for the human's clock-policy decision and touches `clock.ts` and `wakes.ts`; this row stays out of those files, and whichever lands second rebases.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-372

Use /worker. Shape: slice. Effort high.

Outcome: within one step's turn, every decision reads the step's one reading (`Turn.at`); clock reads that remain in the turn are action timestamps (a tier's start, a row's write) or wake bookkeeping, each named.

Read: board row 011-372; `reviews/0.1.518.md` S1; `step.ts`, `step-live.ts`, `beside.ts` (`besideFiles` reads `context.now()` at line 36 and calls `ledger.orderedBatches()` without the reading at line 51), adoption, claim and deadline reads, slow-release bookkeeping; `test/scheduler/step-reading.test.ts`.

Seam: test first. Lead: extend `step-reading.test.ts` with a virtual clock whose `now()` counts its reads during one step's turn, and pin the decision reads to the step's one; then pass `at` through `besideFiles`, `orderedBatches` and each decision helper the count finds. Keep start and write timestamps and wake bookkeeping as their own reads and list them in the notes.

Owns: `src/core/scheduler/` decision helpers that take a reading (`beside.ts`, `ledger.ts`, `queue.ts`, `claims.ts` read paths, `step-live.ts`, and others the count finds; name each), `test/scheduler/step-reading.test.ts` and new tests. Leave alone: `clock.ts`, `wakes.ts`, `options.ts` (row 011-369), `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`.

Done when: row 011-372's done-when; `tasks/011-372/notes.md` lists each remaining read and why it stays; behaviour preserved (no tier, order, width, status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass; the model test passes once when the load is below the CPU count.
