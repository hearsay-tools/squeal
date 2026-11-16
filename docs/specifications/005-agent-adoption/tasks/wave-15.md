# 005 wave 15: late and caught-up messages for the agent's own edits

Row 005-93, one worker. Design, decided by the human 2026-11-16: `tasks/005-93/design.md` (read "Decided" first, then sections 1, 2, 4 and 5). Rule: `docs/vision.md` principle 1, "Silence has to stay readable"; `status.md`, 2026-11-16. Coordinator: session 4d2ecbfc. Builds on 0.1.527 (rows 005-90, 005-91: content titles in `content-title.ts`, the 60 s heartbeat rule in `liveness.ts`, group lines by name).

No version raise, no `pnpm run build`, no full suite. Verify with `squeal status --wait 60000 <changed-path>...`. `test/e2e/**` is outside Squeal's coverage here: run directly, one at a time, with `timeout 900 node_modules/.bin/vitest run <file>`, the e2e files that pin delivered text: `run-triggers-control.test.ts` (add each intended difference from 0.1.393 to its `accepted` list), `lifecycle.test.ts`, `transitions.test.ts`, `run-triggers.test.ts`. They copy the committed bundles, so build in a scratch git worktree for them, never in yours. Grep `test/e2e` and `evals/lib` for every sentence you change.

## 005-93

Use /worker. Shape: slice. Outcome: passing results stay silent; an agent hears once when the results for its own edits are late, and once when Squeal has caught up; a change delivery counts the agent's own test files, not the worktree's queue.

Seam: `src/core/delivery/edits.ts` (`editNotes`, the consumer's edit state), `delivery.ts` (`onToolBoundary`), `header.ts` (`newsLine`), `format.ts` (`editLines`, `settledLine`, `sawSettledLine`), `content-title.ts`. First edit: a delivery test with a fake clock, red until an owed file older than the bound sends the late message once.

Commit per part:

1. **The bound.** Results are late when the oldest owed edit is older than `2 × (start + Σ over tiers of (overhead + wallEstimate(tier)))` (design section 1): `wallEstimate` is the scheduler's own (`src/core/scheduler/backlog.ts`); `start` and `overhead` are this worktree's medians from its stored runs, 0 before any run; a file with no stored duration counts the median of the known ones. Owed files: every test file the consumer's edits affect that has no result at its key (the set `editNotes` reads). One named constant for the factor. A pure function with its own tests.
2. **Late, once.** At a tool boundary only (not Stop, not the idle waiter): the title and text of design section 4, both forms (files to count; nothing read or listed yet). Said once per late state. A stopped, stopping or absent daemon keeps its own liveness message and sends no late message.
3. **Caught up, once.** Only after a late message, when no owed file is left and the latest revision is the one named and is refined: design section 4's text, naming the revision, with the unknown form. A failure delivered during the delay ends the late state and no caught-up follows.
4. **The own count.** The news header counts the consumer's own files in place of the worktree's pending, stale and unknown counts and the "Test files without checks" clause (design section 4); a consumer with no edit since it registered gets no count. `squeal status` and the full form (registration, Stop) are unchanged. The owed-counts delivery (011-205) stays.
5. **What they replace.** The settled line (001-223) and its joined form go: the own count and caught-up say it. In hooks, while the consumer has owed files, the late-feed and unlisted sentences are said by the late message, not by the header. The first-edit line (001-224) stays; reword only "re-keyed" to "affects" where it is in a line you touch.

Owns: the files above, their tests, `evals/` parsers these texts move (round-trip the real formatters, old and new text), the `accepted` list of the 0.1.393 control, new stored state for "late was said" beside the edit state. Leave alone: failure blocks, the registration and Stop full header, `primer.ts`, `liveness.ts`' 60 s rule, group lines.

Done when: a test per part, red first; no late without owed files; no caught-up without a late; one of each per late state; the same-call edit of design section 2 is not claimed by caught-up; complexity of the functions you touch does not rise over the threshold (`squeal code <file>`); lint, typecheck, affected tests current; the four e2e files pass.

Final message: each text before and after; the bound's formula as built and three worked examples from its tests; what the eval parsers needed; every e2e file you ran with its result; anything in the design you could not build as written.

## Review of cand/0.1.530

Use /reviewer. Shape: review. Pinned to the `cand/0.1.530` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 005-93: seven commits of worker 3501dac2 (cherry-picked with `-x`) and one coordinator commit (the release 0.1.530 with bundles and this section). Read row 005-93, this file, `tasks/005-93/design.md` ("Decided", sections 1, 2, 4, 5), `tasks/005-93/worker-notes.md` (the choices the design did not settle), `docs/vision.md` principle 1, `status.md` 2026-11-16.

Judge:
- The bound: built as the design's formula with factor 2; from this worktree's stored runs and the files' durations, no host-tuned number. Judge the stand-in when nothing is measured (`FEED_LATE_MS`, 60 s) and the tier width a hook assumes (4) as accepted deviations or findings.
- Late: only at a tool boundary, never at Stop or to the idle waiter; never without an owed file (or an unread or unlisted edit); once per late state; none while the daemon is stopped, stopping or absent, while a hold is on, or with no test group at `edit`.
- Caught up: never without a late message before it; names the revision; not sent while an owed file is left or the latest revision is not the one named and refined; a failure during the delay ends the late state and no caught-up follows; the same-call edit of design section 2 is not claimed.
- Owed means no result at the file's key: a confirmation run at the same key owes nothing (the worker changed review wave 13v B1's tests in `edits-confirmation.test.ts`: judge that no agent is told its files ran while a result it needs is outstanding).
- The own count: the news header counts the consumer's own files and nothing of the worktree's queue; a consumer with no edit gets no count and nothing that reads as a pass; registration, Stop and `squeal status` unchanged. The settled line is gone from every harness's texts; no parser or skill text still promises it.
- Store: `RunRepo.recentTimings` is a read only, bounded (20 runs), on the hook path: judge its cost against the hook's time budget.
- Parsers: `evals/lib/squeal-text.mjs` and `grade.mjs` round-trip the real formatters, old and new headers; a header with no count never reads as a pass.
- Every new sentence against the human's test: it is for the agent in the session, and it names a next step.

No full suite and no full-suite checkpoint; candidate CI is the full suite: name its run and result. `test/e2e/**` is outside Squeal's coverage: say which e2e files you ran directly (control, lifecycle, transitions, run-triggers). Write `reviews/0.1.530.md` and commit it on your branch.

## Re-review of cand/0.1.530 (the one round)

Use /reviewer. Pinned to the new `cand/0.1.530` SHA named in the message; the candidate was rebuilt on main at 0.1.529, so the range is from the base named there. On top of what you reviewed: five worker commits that answer `reviews/0.1.530.md` B1 to B5 (the late state on every delivery path and no late form with no test group at edit; the bound reads the scheduler's own tier size, widths, parts and first edit starts; a file that ran with no result reads as unknown in the own count and in the evals parser), a path table in `tasks/005-93/worker-notes.md`, and a new release commit with rebuilt bundles.

Judge only: each of B1 to B5 is closed for your own proofs; the path table is true to the code for the cells you probe (Stop quick and waiting, peek, the idle waiter, an unrefined revision, a hold, a daemon down); the repair introduces no new defect; any new line under `src/core/store/**` has its validity case and `test/keys/key-format.test.ts` passes with no raise; the bundles match. Write `reviews/0.1.530-r2.md` with PASS or FAIL and commit it on your branch. No full suite, no build. Name the candidate CI run and its state. This is the last round: on FAIL say plainly what remains and whether one owner module for the late state would replace what the repairs patched.
