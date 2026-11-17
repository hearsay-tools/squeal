# Wave 119: the scheduler records what the late bound reads (row 005-96)

Coordinator 4c0bbe28, 2026-11-17. Row 005-96 is spec 005's, approved by the human on 2026-11-17 (card option A, through coordinator 4d2ecbfc); the scheduler's coordinator owns and briefs it because the write lives in `src/core/scheduler/`. Base: main at 0.1.531 (released). The read side is coordinator 4d2ecbfc's: its contract is `docs/specifications/005-agent-adoption/tasks/005-96/contract.md`; row 005-97 (the late messages) reads the record later and is not this row.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures and scratch `HOME`; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`. Write `~` for home paths in docs and notes.

## W1: row 005-96

Use /worker. Shape: slice. Effort high.

Outcome: at each edit tier's start the scheduler records the tier size, each project's width and part, the revision's first-start delay and the tier's estimate, in the contract's meta row, so that a failed or blocked write loses at most that sample and never strands a launch.

Read: the contract (all of it); `docs/specifications/005-agent-adoption/reviews/0.1.530-r2.md` R2-B1 and "Inputs for the coordinator" (why the wip write is wrong: it ran after `startTier` committed and before the run flew, so a busy store left a file marked running with no run in flight) and `0.1.530.md` B2, B3; `origin/wip/005-93`: `src/core/scheduler/edit-timings.ts`, the call in `tier-start.ts` `act`, `src/core/delivery/late-timings.ts` (`pastBound`, the reader's user) and the three tests the contract names; `GLOSSARY.md` "Scheduler step"; `research/scheduler-step.md` (the step's lock turn); `tasks/011-372/notes.md` (decisions read the step's one reading; action stamps).

Design first, in `tasks/005-96/notes.md`: where the write goes. It must never sit between a tier's start commit and its flight. Options to weigh: inside the same store transaction that writes the tier's start (one commit: both or neither), or after the run has flown (a lost sample is acceptable). Say which, why, and what the step's lock turn costs: measure the turn that starts an edit tier before and after (card 7's method, `tasks/011-357/notes.md`; fake runner, scratch `HOME`, the host's real load stated). A growth above a few milliseconds is a message to me before landing.

Then test first: the R2-B1 two-connection probe (a competing store writer while an edit tier starts) as a regression that fails on the wip placement and passes on yours; the contract's three tests from the wip branch. Bring from `origin/wip/005-93` only what the record and those tests need (`edit-timings.ts`, the reader `readEditTimings`, `late-timings.ts` if `pastBound` lives there, the registry entry in `src/core/types/store.ts`); nothing of `late.ts`, `late-format.ts` or the delivery paths (row 005-97).

Owns: `src/core/scheduler/edit-timings.ts` (new), the write's call site (`tier-start.ts` or where the design puts it), the registry line in `src/core/types/store.ts`, `src/core/delivery/late-timings.ts` only if the tests need it, and their tests. Leave alone: `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`.

Done when: the contract's five write-side needs hold, each with a test; the start stamp is the step's reading; only edit tiers write `firsts` and `tiers`; both lists stay at 20; the row is removed with the worktree's other meta rows; behaviour otherwise preserved (no tier, order, width, status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck, the model test once, `squeal status --wait 60000` on the changed paths (report pending as pending); the lock-turn measurement in the notes.
