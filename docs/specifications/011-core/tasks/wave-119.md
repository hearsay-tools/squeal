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

## R1 (W1): review of cand/0.1.535

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.535` at `91010bc4c963aae7e330bd4f16dc6d0d36074ed3`; candidate CI run 43986958678. Range `6b28ff1e0..91010bc4c963aae7e330bd4f16dc6d0d36074ed3` (main at 0.1.531): worker 74012cb8's four commits (row 005-96: design, the write, notes, the lock-turn probe), cherry-picked without conflict, then the 0.1.535 raise and bundles (0.1.532 to 0.1.534 are other coordinators', not on main yet). Read: board row 005-96; this file's W1; `docs/specifications/005-agent-adoption/tasks/005-96/contract.md` and `notes.md`; `docs/specifications/005-agent-adoption/reviews/0.1.530-r2.md` R2-B1.

Check, each as proven, plausible or unverified:

1. **No stranded launch.** `recordEditTier` runs last inside `startTier`'s transaction through the new `started` callback, in its own savepoint, and catches every error: a busy or failing write loses only the sample and the tier still commits and flies; nothing sits between the start's commit and the flight. `tier-start-timings.test.ts` (R2-B1's two-connection probe, and a throwing write) failed on the wip placement and passes now. Is any error kind left that aborts the whole start (the notes name disk full and I/O errors, shared with the start's own writes)?
2. **The contract's five needs** hold (freshness after commit, no stranded launch, the start's stamp, 20 entries per list and one row per worktree removed with the other meta rows, only edit tiers write `firsts` and `tiers`), and `readEditTimings` reads what is written. The worker used `tier.startedAt` (the tier's own start stamp, row 011-372's action stamp) rather than the step's `at`: is that the contract's "start", and is it right?
3. **The lock turn.** The record adds about 0.1 ms inside the start's transaction (the notes' measurement, at load 34 to 52): is the method sound and the growth within card 7's "a few milliseconds"?
4. **Scope.** Only edit tiers from `act` record; slow-lane edit tiers (`slow-tier.ts` `#start`) do not, as on the wip branch: say if row 005-97 will need them. `late-bound.ts` and `late-timings.ts` come from the wip branch with the reader; nothing of `late.ts`, `late-format.ts` or the delivery paths.
5. **Behaviour preserved** apart from the new meta row: no tier, order, width, status payload, note text, CLI output or key change.

Coordinator at the candidate: lint, typecheck, `check:version origin/main` (0.1.531 to 0.1.535); `key-format` 12/12 alone; `version-sensitive`, `tier-start-timings`, `edit-timings`, `late-bound`, `worktree-meta`, the model test, `one-loop-source`, `untracked-promises` 46/46 at load 54. Worker: 16 files reaching `startTier` 165/165. CI is the full suite. Coordinator 4d2ecbfc reviews the read-side seam separately. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/0.1.535.md` (under `011-core`) and commit it on your branch; write `~` for home paths.

## W1 repair: after review 0.1.535 (FAIL)

Use /worker (worker 74012cb8, resumed). Shape: repair. Effort high. Read `reviews/0.1.535.md` (B1 and its fix scope). B1: a real `SQLITE_FULL` in the timing write rolls back the whole start transaction; `recordEditTier` catches it, the outer commit then throws, and the launch is stranded (no flight, a running key, no run row). Catching the sample's error cannot fix an automatic rollback.

Repair: record the timing facts after the flight owns the launch, in their own short write, best-effort (every error caught and logged; no busy wait that holds the flight back), from facts captured at the start (the tier's `startedAt` and its grant). Then no timing failure of any kind can touch the launch. Keep the competing-writer regression; add a real automatic-rollback regression (the review's `PRAGMA max_page_count` probe) that fails on the candidate and passes on the repair. Measure the lock turn again if the path changes. Do not broaden into pool or busy-resume changes. Review N1 (group lanes record nothing) is row 005-97's decision: leave it, name it in the notes.

Done when: both regressions pass and the new one failed before; the contract's five needs still hold; notes gain "Repair after review 0.1.535"; lint, typecheck, `key-format`, the model test once; `squeal status --wait 60000` on the changed paths (report pending as pending).

## R2 (W1 repair): narrow re-review of cand/0.1.535

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.535` at `ea5a6733dcd90f0bccd60d53204109fb3fe30fae`; candidate CI run 43993122038. Rebuilt on main `80641a0b9` (0.1.534): worker 74012cb8's four first-round commits (unchanged), its repair (`88ea38856` the fix, `d177b3764` busy-record's fault target, `7192e4c0b`, `0ff4cc358` notes), then the 0.1.535 raise and bundles. Narrow: the repair, against `reviews/0.1.535.md` B1. Read that review and `docs/specifications/005-agent-adoption/tasks/005-96/notes.md` "Repair after review 0.1.535".

Check, each as proven, plausible or unverified:

1. **B1.** The timing record is written in `startNext` after the run has flown, in its own short write, from facts captured at the start (`startedAt`, the grant through `grantOf`); `startTier` is back to its base code; no timing failure of any kind (busy, throw, `SQLITE_FULL` with automatic rollback) can touch the launch. The review's `max_page_count` case failed on `91010bc4c` and passes now; the competing-writer case still passes; a busy store loses the sample silently and another error adds one note per distinct text.
2. **The contract still holds** (freshness after the flight, 20 entries, one row per worktree, only edit tiers write `firsts` and `tiers`); the first-start delay still uses the tier's own start stamp.
3. **`busy-record.test.ts`** line 159 now targets the one-shot fault at `recordTier`: the case keeps its meaning (it was written to fail the tier record), and no card 9 source changed.
4. **Lock turn** measured again (the record's write 0.08 to 0.20 ms, outside the start's transaction now); `act` is at complexity 19.

Coordinator at the candidate: lint, typecheck, `check:version origin/main` (0.1.534 to 0.1.535); `key-format` 12/12 alone; `version-sensitive`, `tier-start-timings`, `edit-timings`, `late-bound`, `worktree-meta`, `busy-record`, the model test, `untracked-promises` 49/49 at load 49. Worker: write-fault scheduler files 38/38; Squeal 504 current, 398 pending. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running; write `~` for home paths. Write `reviews/0.1.535-r2.md` (under `011-core`) and commit it on your branch.
