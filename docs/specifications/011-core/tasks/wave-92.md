# Wave 92: rows 011-340 and 011-321

Coordinator fab00745, 2026-11-14. The human's answers of 2026-11-14: "Card 5: A: small card", "Shape: B: one stamped answer", "Rows: Approve, land, start"; row 011-321 joins this lane. The two rows share no file and run in parallel.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-340, one admission answer, behaviour preserved

Use /worker. Shape: slice (a move), test first. Runner claude, opus, effort high.

Outcome: one pure `admit(facts)` in `src/core/scheduler/admission.ts` answers for every lane, and the pump, the slow lanes, the import re-walk and the status answers act on it; nothing a user sees changes.

Read: `research/admission.md` (the spec for this row: Problem, Decisions, Coordinator's calls, Rows item 1); board row 011-340; `GLOSSARY.md` (Start facts, Admission, Lane, Request intake).

First edit: `test/scheduler/admission.test.ts`, the pure table with a `facts(overrides)` builder, written against the design's cases; then `admission.ts`; then `#facts()`, `#probe()` and the `Mutex` turn count; then one caller at a time (pump, `SlowHost`, re-walk, status answers).

Two failure modes from earlier move rows (`reviews/0.1.452.md` B1 and B2):
- **No parallel decision path.** No caller keeps its own copy of a rule beside `admit`, and the tests call the same `admit` the scheduler calls. The notes give the grep of the done-when.
- **Prove "behaviour preserved" with tests.** Each check order, each recheck after a wait and each width answer you move is covered by a table row or an existing scheduler test you name. A claim without a test is a gap in the notes, not a pass.

Keep the check order the design names. If the answer cannot hold an order, stop and report it before you change it. Differences 1 and 2 stay as pinned table rows; do not fix them.

Owns: `src/core/scheduler/scheduler.ts`, `slow-tier.ts`, `mutex.ts`, new `admission.ts`; `test/scheduler/admission*.test.ts`; the width-only cases of `test/scheduler/group-lanes-width.test.ts` and `slow-width.test.ts`; every test fake of `SlowHost` (grep for them; `test/scheduler/request-intake-probe.ts` is one).

Leave alone: `record.ts`, `tiers.ts` `selectTier`, `request-intake.ts`, `src/core/types/scheduler.ts` (row 011-339 edits it now; put the facts type in `admission.ts`), `install.ts`, `ledger.ts`, the remote lane.

Done when: the row's done-when; lint and typecheck pass; `squeal status --wait 60000` on the changed paths, with pending or unknown files named; `test/keys/key-format.test.ts` passes with no raise. Notes in `tasks/011-340/notes.md`: the grep, each moved read (file, function), the deleted width cases by file and name, the existing tests the table repeats, any changed coordinator's call.

## W2: row 011-321, the key alarm reaches the run evidence module

Use /worker. Shape: slice, test first. Runner claude, opus, effort medium.

Outcome: removing the observed-read change and touch check in `src/core/run-evidence/sources.ts` fires the key alarm.

Read: board row 011-321 (section "Run evidence"); `reviews/0.1.453-r2.md` N1; `research/run-evidence.md`; `test/keys/validity/notes.md`; `test/keys/validity/entries/global.ts` and `self-test.ts`.

First edit: a self-test case that deletes the check through an overlay and expects the alarm to fire; it fails today. Then add the module to `entries/global.ts` and a case that runs an observed-read change and touch through the record outcome and the per-file store decision.

Owns: `test/keys/validity/**`, `test/run-evidence/**`. Product code is not yours; if the module cannot be an entry without a product change, stop and ask.

Must not raise `KEY_FORMAT_VERSION`. If the alarm asks for a raise rather than a pin, stop and ask.

Done when: the row's done-when; lint and typecheck pass; the alarm tests you touched pass, run directly when Squeal does not cover them; notes in `tasks/011-321/notes.md` with the mutation result before and after.
