# Wave 107: settle-bound tests, two CI flakes, small clean-ups (rows 011-368, 011-358 with 011-359, 011-370)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-15 (rows 011-358 to 011-371). Base: main with 0.1.518 plus cand/011-363-367 (in review; `settle` in `tier-yields-fixture.ts` and `test/scheduler/drive-fixture.ts` come from it). The three workers own disjoint files.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the one-minute load with every timing. Stop your Squeal daemon before you finish. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-368

Use /worker. Shape: slice. Effort medium.

Files (quality file R6): `tier-ended-files`, `editor-scratch`, `editor-scratch-observed`, `tier-yields-fairness`, `batch-tier`, `backlog-quiet`, `catch-up-quiet`, `group-lanes-guards` (it waits a real 5 s `maxDeferMs`). Same pattern as row 011-363 (`tasks/011-363/notes.md`): `clock: "virtual"`, `settle`/`rest()` instead of polls, pauses and `idle()`; a "nothing happened" settle becomes an exact check. Test files only (`src/` gaps are a message to me). Done when: row 011-368's done-when; each file 3 of 3; `tasks/011-368/notes.md` gives the sleep removed and wall time before and after with load.

## W2: rows 011-358 and 011-359

Use /worker. Shape: survey, then slice if a cause is found. Effort medium.

Two CI timing failures outside the scheduler: `test/status/why-unknown-standing.test.ts:135` ("keeps every standing record of more than 1,024 across worktrees through a prune", 5 s Vitest timeout, main CI 43709724871, Node 26 2/3) and `test/daemon/lifecycle.test.ts:83` (a SIGKILL replacement's serve time against 3 times a cold start, 2365 against 918 ms, main CI 43748848817, Node 22 2/3). Both passed on rerun. Find each cause from the test and the code it drives: setup cost that the bound does not account for, a bound that compares unlike things, or a real slowdown. A fix keeps the case's meaning and derives any bound from the work, never a host-tuned number (memory: fixes fit users' machines). A proven product slowdown is a proposed row with a failing test, not a fix here. Owns: those two test files and their helpers. Done when: both rows' done-when; `tasks/011-358/notes.md` names each cause with evidence and the change.

## W3: row 011-370

Use /worker. Shape: slice. Effort medium.

The quality file's slices S2, S3, S5, S6, S8, S9, S10, S11 (S7 moved to row 011-366 and is done): dead exports (`tierKeys`, `fileKeys`, `queueSlowSuite`, `SchedulerEventKind`); six comments that name removed code; the intake's `cutTiers` hook name; `#notify` to `#post`; `GLOSSARY.md` text for Scheduler decision and Scheduler event to match `step-events.ts`; two needless `export`s; the five `step.test.ts` rows that repeat `decide-yields.test.ts`; `tier-yields-running` merged into `tier-yields-text`; the repeated `tier-yields-bound` case and an unused test clock. Re-check each against main first: earlier rows may have done some. Behaviour preserved; `key-format` without a raise. Owns: the named `src/core/scheduler/` lines, `GLOSSARY.md` (that section only), `step.test.ts`, `tier-yields-running.test.ts`, `tier-yields-text.test.ts`, `tier-yields-bound.test.ts`. Leave alone: W1's and W2's files. Done when: row 011-370's done-when; `tasks/011-370/notes.md` lists each item as done or dropped with the reason. This changes `src/`, so the candidate gets a version raise.

All: lint, typecheck and `squeal status --wait 60000` on the changed paths; report pending checks as such.
