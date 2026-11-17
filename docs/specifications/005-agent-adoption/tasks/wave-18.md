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

## Review of cand/0.1.538

Use /reviewer. Shape: review. Pinned to the `cand/0.1.538` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 005-97: two commits of worker 5a844516 (cherry-picked with `-x`) and one coordinator commit (the release 0.1.538 with bundles and this section). Read row 005-97, this file's W1 section, `tasks/005-97/notes.md` (the path table and what changed against the wip branch), `tasks/005-93/design.md` ("Decided", sections 1, 2, 4, 5), `reviews/0.1.530.md` and `reviews/0.1.530-r2.md` (the five blockers closed on the wip branch: check each is still closed here), `reviews/0.1.534.md` (the own count's rule: `since` moves only when a delivered header showed the count), `../011-core/reviews/0.1.535.md` and `-r2.md` (the scheduler's record), `docs/vision.md` principle 1.

Judge:
- The path table is true to the code for every cell you probe (tool boundary refined and unrefined, Stop quick and waiting, Stop at another revision, turn end, peek, the idle waiter, UserPromptSubmit, registration, leaving and expiry, a hold, the daemon down, no test group at `edit`, an empty late state).
- Late: only at a tool boundary; never without an owed file, an unread edit or an unlisted revision; once per late state; none while the daemon is down or stopping, during a hold, or with no test group at `edit`.
- Caught up: never without a late before it; never after a failure delivered during the delay, on any path; names the revision; not while a file is owed or the latest revision is not refined; the same-call edit is not claimed.
- The count's start (`since`) with the late state: no path restarts the count while a late state is open or without a header that showed the count; no path leaves a late state that never closes; a consumer that leaves or expires takes its late state with it.
- The bound: uses main's `late-bound.ts`, `late-timings.ts` and the scheduler's record unchanged; a file that only a group lane runs (no timings recorded) gets a bound never shorter than twice its own durations run one after another; with nothing measured the stand-in holds.
- Texts: as `tasks/005-93/design.md` section 4 in 0.1.537's words ("affect", "passes stay silent unless they follow a failure", UTC named); the news header leaves the late-feed and unlisted sentences out only while the late message can say them.
- Parsers and skill: `evals/lib/squeal-text.mjs` and `grade.mjs` round-trip the real formatters; caught up with an unknown result never parses as a pass; the skill copies agree.
- No change under `src/core/scheduler` or `src/core/store`; the `edits-late:` key is in the registry; complexity not newly over the threshold.

No full suite and no full-suite checkpoint; candidate CI is the full suite: name its run and result (a red `test/e2e/pi.test.ts:190` or `pi-wake.test.ts` "never armed" alone is the known defect of board row ci-43987606521). `test/e2e/**` is outside Squeal's coverage: say which e2e files you ran directly. Write `reviews/0.1.538.md` and commit it on your branch. Write `~`, never a `/home/<user>/` path.

## Re-review of cand/0.1.538 (the one round)

Use /reviewer. Pinned to the new `cand/0.1.538` SHA named in the message. On top of the SHA you reviewed: your review file (cherry-picked) and one coordinator repair commit for B1: `registerNow` in `src/core/delivery/delivery.ts` reads the consumer's view before the registration replaces it; when a still-registered consumer's registration reports a failing check its view did not hold as failing (`reportsNewFailure`), it ends the late state (`endLate`) in the same transaction. Tests in `test/delivery/late-paths.test.ts`: your regression (no caught-up after the registration reported B), and the two controls (no new failure; a failure told before the late notice): both keep the late state and say caught up. Bundles rebuilt.

Judge only: B1 is closed for your own proof; the controls hold; first registration, leaving, expiry and the prepared-report handoff are unchanged; no new defect; the bundles match. Write `reviews/0.1.538-r2.md` with PASS or FAIL and commit it on your branch. No full suite, no build. Name the candidate CI run and its state (a red `test/e2e/pi.test.ts:190` or `pi-wake.test.ts` "never armed" alone is the known defect of board row ci-43987606521). Write `~`, never a `/home/<user>/` path.
