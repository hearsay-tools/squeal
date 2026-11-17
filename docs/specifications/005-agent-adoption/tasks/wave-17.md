# 005 wave 17: the wording pass

Row 005-94, one worker. The texts are decided: `tasks/005-94/texts.md` with its "Decided" section (the human, 2026-11-17). Rule: `status.md`, 2026-11-16 (a hook carries what the agent can use) and `docs/vision.md` principle 1. Coordinator: session 4d2ecbfc. Builds on 0.1.534 (the own count in the news header).

No version raise, no `pnpm run build` in your worktree, no full suite. Write `~`, never a `/home/<user>/` path, in notes and probes. Verify with `squeal status --wait 60000 <changed-path>...`. Run directly: `test/keys/key-format.test.ts`; and, one at a time with `timeout 900` from a scratch worktree build, the four e2e files that pin delivered text (`run-triggers-control` with its `accepted` list, `lifecycle`, `transitions`, `run-triggers`). Grep `test/e2e` and `evals/lib` for every sentence you change.

## 005-94

Use /worker. Shape: slice. Outcome: every hook text of `tasks/005-94/texts.md` reads as its "After", in the forms the human chose.

Read `texts.md` whole first; its probe (`tasks/005-94/probe/`) holds a draft `primer-after.ts` you may start from. Commit per part:

1. **The registration (C1: R1).** No counts line, no Inherited, Imported, "test files without checks", checkpoint sentence or `· sha + N, dirty` suffix. `Known failures: N; X of Y test files are current (run on the files as they are now), and \`squeal status\` counts the rest.`; a group or slow-tier line stays when the agent must act on it; no slow-tier line at 0 slow files (C5). The unlisted forms of texts.md item 3. `squeal status` and `status --full` keep every removed fact: a test proves each is still printed there.
2. **Stop (C2).** Stop's header takes the registration's form; no `Known failures: 0` line while the test files are not listed and none failed; no "A daemon is starting; results are as of revision 0." there.
3. **The primer.** The three sentences of texts.md item 2; the path wait in every primer that fits, tried before the plain wait, with 005-89's drop order; no "or a checkpoint, `squeal run --all --wait`" (C3); the revision definition unchanged (C7). `test/harness/primer-over-cap.test.ts`'s "fits today, unchanged" rule is replaced: say so in its comment. Every coverage of that test's matrix within `PRIMER_CAP_CHARS`.
4. **The late-feed sentence (C4).** UTC with "UTC", and the next step; the same sentence in `squeal status`.
5. **Words.** "re-keyed" becomes "affect" in `status --wait`'s output (C6) and skill step 3; the recovery clause in the first-edit lines; the skill sentences of item 6 in all skill copies except `plugins/codex/seed`; nit N1 of `reviews/0.1.534.md` (`test/harness/skill.test.ts` passes an explicit absent count).
6. **Spec text.** Amend 005 D1 and D6 and 001 D6 and D7 where texts.md "What the code must also change" names them, each with a dated line.

Owns: `src/harness/shared/{primer,text,stop-text}.ts`, `src/core/delivery/{header,format}.ts` (the full form and the registration only; leave the news line's own count and `edits.ts` alone), `src/core/status/{format-status,feed-late}.ts`, `src/cli/status-wait-lines.ts`, `src/core/text.ts` (`timeText` or a UTC twin), the skill copies, `evals/lib/squeal-text.mjs` and its tests (round-trip the real formatters, old and new registration), the `accepted` list of the 0.1.393 control, their tests, the spec sections above. Leave alone: `src/core/scheduler/**`, `src/core/store/**`, `src/core/delivery/{edits,delivery}.ts`.

Done when: a test per changed text, red first; each removed fact still printed by `squeal status` or `status --full`; primer lengths for texts.md's three coverages printed in your notes; no function newly over the complexity threshold (`squeal code`); lint, typecheck, affected tests current; key-format and the four e2e files pass.

Final message: each text before and after as built, where it differs from texts.md and why; the primer lengths; every e2e file you ran with its result; what the atomic eval's parser needed.

## Review of cand/0.1.537

Use /reviewer. Shape: review. Pinned to the `cand/0.1.537` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 005-94: six commits of worker 8ac2fa50 (cherry-picked with `-x`) and one coordinator commit (the release 0.1.537 with bundles and this section). Read row 005-94, this file, `tasks/005-94/texts.md` ("Decided" first), `tasks/005-94/notes.md` (the decisions the texts did not settle), `status.md` 2026-11-16 and 2026-11-17, `docs/vision.md` principle 1.

Judge:
- Each hook text against `texts.md`'s "After" and the human's choices (C1 R1, C2 Stop takes the same form, C3 no checkpoint clause, C4 UTC named, C5 no slow-tier line at 0 slow files, C6 "affect" in `status --wait`, C7 the revision definition unchanged). Each of the worker's own decisions in `notes.md`: accept, or a finding.
- No fact is lost: the counts, the checkpoint, Inherited, Imported, "test files without checks" and the `· sha + N, dirty` suffix are still printed by `squeal status` or `status --full`, with a test for each.
- The registration and Stop never read as a pass they do not have: `X of Y test files are current` is true to the header's counts for every validity mix; the unlisted and no-daemon forms; a stored failure is always said; the cap (10,000 characters) still holds with many failures.
- The primer: every coverage of the test matrix within `PRIMER_CAP_CHARS`; the path wait wherever it fits; Codex's long CLI path still named at the wait (004-78); `trailingPrimer` still finds every primer; no sentence an eval cell depends on is lost without a note.
- The late-feed sentence: UTC is what the clock prints, on a host in another zone too; "asks it to read them" is what `status --wait` does.
- Parsers: `evals/lib/squeal-text.mjs` and `grade.mjs` round-trip the real formatters, old and new registration and Stop; a registration with files not current never parses as all current.
- The spec edits (005 D1, D6; 001 D6, D7) say what the code does.
- Complexity: no function newly over the threshold.

No full suite and no full-suite checkpoint; candidate CI is the full suite: name its run and result (a red `test/e2e/pi.test.ts:190` or `pi-wake.test.ts` "never armed" alone is the known defect of board row ci-43987606521: say so, do not count it). `test/e2e/**` is outside Squeal's coverage: say which e2e files you ran directly. Write `reviews/0.1.537.md` and commit it on your branch. Write `~`, never a `/home/<user>/` path.

## Re-review of cand/0.1.537 (the one round)

Use /reviewer. Pinned to the new `cand/0.1.537` SHA named in the message (the branch was rebuilt on main; the range is from the base named there). On top of what you reviewed: three worker commits that answer `reviews/0.1.537.md` (B1: `test/e2e/worktrees.test.ts` reads the inherited results in `status --full`, `test/delivery/ignored-paths.test.ts` reads the commit as status names it; S1: the e2e quiet point waits for open test file runs, `expectAgrees` compares strictly, a regression in `test/delivery/e2e-agree.test.ts`; N1: 001 D6 narrowed) and a new release commit with rebuilt bundles.

Judge only: B1, S1 and N1 are closed; S1's finding (a test race: the re-run of a new failure was open when the hook read) is what the code shows, and no check that would catch a registration claiming more than status was weakened; no new defect; the bundles match. Write `reviews/0.1.537-r2.md` with PASS or FAIL and commit it on your branch. No full suite, no build. Name the candidate CI run and its state (a red `test/e2e/pi.test.ts:190` or `pi-wake.test.ts` "never armed" alone is the known defect of board row ci-43987606521). Write `~`, never a `/home/<user>/` path.
