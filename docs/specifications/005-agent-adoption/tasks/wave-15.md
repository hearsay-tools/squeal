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
