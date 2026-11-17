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
