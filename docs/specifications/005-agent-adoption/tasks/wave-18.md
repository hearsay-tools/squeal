# 005 wave 18: late and caught-up messages; no second primer in one session

Rows 005-97 and 005-95, approved by the human 2026-11-17. Coordinator: session 4d2ecbfc. Two workers on disjoint files: W1 owns `src/core/delivery/**` and `evals/lib/**`; W2 owns `src/harness/shared/**` and the registration's parked record. Neither edits the other's files; a needed change there is a question to the coordinator.

Rules for both (lessons of `status.md`, 2026-11-17): no version raise, no `pnpm run build` in your worktree, no full suite. A text change greps ALL of `test/`, `evals/lib` and the skill copies for every sentence it changes or removes. `test/e2e/**` is outside Squeal's coverage here: run each e2e file that reads a text you change directly, one at a time, `timeout 900`, from a scratch worktree build. A new line under `src/core/store/**` needs a validity case: run `test/keys/key-format.test.ts`. Before you report, read Squeal's complete verdict on your changed paths (`squeal status --wait 60000 <paths>`, repeated until none is pending). Write `~`, never a `/home/<user>/` path.

## W1: 005-97, late and caught up

Use /worker. Shape: finish. Outcome: an agent hears once when the results for its own edits are late, and once when Squeal has caught up; nothing else changes.

The work exists on `origin/wip/005-93` (built on 0.1.529): `src/core/delivery/late.ts`, `late-format.ts`, the wiring in `delivery.ts` and `edits.ts` (`tellEdits`, `lateNotes`, `boundary`, `once`), the `edits-late:` meta key, the tests `test/delivery/late.test.ts` and `late-paths.test.ts`, the path table in `tasks/005-93/worker-notes.md`. Its message side passed review (`reviews/0.1.530-r2.md`: B1 to B5 closed). Main has since changed under it; carry the late parts onto main, do not copy files whole:

- The bound and the scheduler's record are on main (0.1.535, row 005-96): `src/core/delivery/late-bound.ts`, `late-timings.ts`, `src/core/scheduler/edit-timings.ts`. Use them as they are; change nothing under `src/core/scheduler`.
- The own count is on main (0.1.534): `since` moves only when a delivered header showed the count with no file owed (`tell(shown)`, `ownShown`); a peek counts (`ownNotes`). The late state must fit that rule: write in your notes, as a table, what each delivery path does to the late state and to `since` (tool boundary refined and unrefined, Stop quick and waiting, Stop at another revision, turn end, peek, the idle waiter, UserPromptSubmit, registration and leaving, a hold, the daemon down, no test group at edit, an empty late state), with a test for each cell.
- The texts are on main in their new forms (0.1.537): "affect", "passes stay silent unless they follow a failure", UTC named. The late and caught-up texts follow `tasks/005-93/design.md` section 4 in those words.
- While the consumer has owed files, the late message says the late-feed and unlisted facts; the news header then leaves those sentences out (as on the wip branch).
- Two inputs from the scheduler row's reviews: configured group lanes record no timings (`../011-core/reviews/0.1.535.md` N1), so a file that only a group lane runs reads width 1 and no first start: test that the bound is then never shorter than the files' own durations, and say so in the notes; do not add a recorder. No late form at all with no test group at `edit`.

Owns: `src/core/delivery/{late,late-format,delivery,edits,header,format,content-title}.ts`, `src/core/types/{delivery,store}.ts` (the `edits-late:` registry line only), their tests, `test/store/worktree-meta.test.ts` if the registry needs it, `evals/lib/{squeal-text,grade}.mjs` and their tests, the skill `reports.md` copies (the late and caught-up lines only), the e2e text readers. Leave alone: `src/core/scheduler/**`, `src/core/store/**`, `late-bound.ts`, `late-timings.ts`, `src/harness/**`.

Done when: the wip branch's late tests pass on main's record, reworked where main changed; a test per path-table cell; no late without an owed file, one late and one caught-up per late state, no caught-up after a failure, none without a late; complexity of touched functions not newly over the threshold; the rules above.

Final message: the path table; each text as built; what you changed against the wip branch and why; check results.

## W2: 005-95, no second primer in one session

Use /worker. Shape: slice. Outcome: a session that already heard the primer gets its registration without it when it registers again at a tool boundary.

Read: row 005-95; `tasks/005-91/notes.md` section "(d)" (177 tool-boundary registrations: 87 after the consumer expired, 17 under 10 minutes with the cause not determined, 1 after a compaction, 72 first registrations); `src/harness/shared/deliver.ts` (`withPrimer` at `!isRegistered`), `session.ts`, `src/core/delivery/registered.ts` (`park`, the parked view), `expiry.ts`.

First, no code: name the cause of the 17 from the code and, read-only, from recent transcripts and stores (`dropGoneHarnesses`, `dropLeft` or another); write it in `tasks/005-95/notes.md`. If it is a defect of its own, stop there and report it.

Then: a record that this session heard the primer, which outlives the consumer's expiry and ends with the session (the parked view is a candidate; say what you chose and what removes it). A registration at a tool boundary for a session with that record sends no primer; a first registration keeps it; a compaction between clears the record, since compaction drops the primer from context. Every harness that shares `deliver.ts` behaves the same, or the notes say why not.

Owns: `src/harness/shared/{deliver,session,hook}.ts`, `src/core/delivery/{registered,expiry}.ts`, their tests, a new meta key's registry line if one is needed. Leave alone: `src/core/delivery/{delivery,edits,header,format,late*}.ts`, `primer.ts`, `src/core/scheduler/**`.

Done when: tests for expiry then re-registration (no primer), a first registration at a boundary (primer), a compaction between (primer), a subagent's first boundary (primer), unregistered and registered again in a new session (primer); the rules above.

Final message: the cause of the 17; the record and its lifetime; check results.
