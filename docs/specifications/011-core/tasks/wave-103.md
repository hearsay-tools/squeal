# Wave 103: quality scan over card 7 (rows 011-351 to 011-357)

Coordinator 4c0bbe28, 2026-11-15. The human chose "Quality: Scan only" after card 7 shipped in squeal--v0.1.516: the scan, without the eval runs of `docs/process.md` 6b.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; never the real `HOME`; never make load on purpose; run any vitest with a timeout and make sure it ends. Edit nothing but the findings file.

## Q1: the scheduler after card 7

Use /quality. Read only.

Outcome: one findings file that says what in the scheduler is now dead, duplicated, misplaced or harder to follow than the human's goal for card 7 allows, with each finding a proposed row, a drop candidate or a small slice.

Stretch: main `bf650f995..72c736233` (squeal--v0.1.516), limited to `src/core/scheduler/`, `src/core/types/scheduler.ts`, `test/scheduler/`, `test/helpers/virtual-clock.ts`.

Read: `docs/vision.md`, `docs/styleguide.md`; the design record `../research/scheduler-step.md` (the human's goal in decision 1: one place to read what happens next, time as an input, decisions as data from closed lists, each rule in one module composed in one written order, glossary terms that match modules); `GLOSSARY.md` "Deciding what runs next"; `status.md` lines of 2026-11-15; `tasks/011-351/` to `011-357/notes.md`; the reviews `0.1.512.md` to `0.1.516.md` and `011-353*.md`.

Questions to answer, each with file and line evidence:
1. Does an agent reading `step.ts` find every decision of what happens next? List any decision still made outside the step or its named rules (for example in `scheduler.ts`, `slow-tier.ts`, the wake owners), and any rule the step calls through more than one hop.
2. What is left over: optional `now`/`wakes` parameters with defaults only tests use, `Clock.ticks()` beside `now()`, adapters with one caller, dead exports, comments that name removed code.
3. Do glossary terms match modules and names (Step, Scheduler event, Scheduler decision, Wake, Rest)? Name each mismatch.
4. Tests: which of the 229 real-time `test/scheduler/` files could move to `clock: "virtual"` with `rest()` first (by value: flake history, run time), and which test cases now duplicate a step-table row.
5. Size: `scheduler.ts` lines and methods before and after (the record says 1,578 lines, about 77 methods at `524c63be3`), and the complexity Squeal still flags (`TierScheduler.#pump` was 39).

Write `docs/specifications/011-core/quality/2026-11-15-card-7.md`, findings ordered by value, each tagged with the evidence kind (read in source code, measured, inferred). Commit it on your branch.
