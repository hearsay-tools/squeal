# 004 wave 7: the completion guidance states the slow-suite policy (2026-10-16)

One row, from hearsay-tools/squeal#5, decided by the human 2026-10-16 (`status.md`, D8 as amended that day). Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, key pins, `package.json` versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output; name any file that fails under load and passes alone. Do not run `npm run build` in your tree.

## W1: 004-62, the guidance says what this repository's "done" requires

Use /worker. Shape: slice. Read spec 004 D8 (its 2026-10-16 sentence) and D9, `research/issue-5.md`, issue #5 (`gh issue view 5`), and `docs/styleguide.md` on agent-facing text.

Outcome: an agent in a repository with `stop.requireSlowSuite: false` is never told to run the slow tier before it finishes, and one with `true` still is.

Contract:
- Primer, off: the slow tier is not required before you finish; say slow tests pass only when the latest `Slow tier:` line says every slow file is current, otherwise say how many are not; `run --slow --wait 60000` runs them now.
- Primer, on: today's before-done step, and that Stop waits for them.
- Skill step 4 (`plugins/{claude-code,codex,pi}/skills/squeal/SKILL.md`) and each `references/commands.md`'s `run --slow` sentence: the policy is read off the `Slow tier:` line's ending (`src/core/state/slow-text.ts:140`, `:144`); the same claim rule.
- Every primer form stays within `PRIMER_CAP_CHARS`.
- Stop, the `Slow tier:` line and the quiet wait line do not change.

Seam: `slowSentences` in `src/harness/shared/primer.ts`. Lead: carry `requireSlowSuite` in `Coverage.slow` (`src/harness/shared/coverage.ts:35`, filled in `coverageOf`).

Owns: those two files, the three `SKILL.md` and three `commands.md` copies, `test/harness/primer-coverage.test.ts`, `test/harness/skill.test.ts`, and new tests. `test/evals/*` quote the sentence: update a quote, never a rubric or measure (`evals/lib/` is 006's). Leave wave 17's files alone: `scheduler.ts`, `lifecycle.ts`, `change-feed.ts`, `daemon-loop/`, `store/connection.ts`. Write `tasks/004-62/notes.md`.

Done when:
- Primer tests for both values in each naming (`squeal`, the Codex CLI path, Pi, OpenCode): off names no before-done step, on names it.
- `npx tsx docs/specifications/004-slow-suites/research/probes/issue-5/probe.ts` prints different primers for `false` and `true`; its output is in the notes.
- The skill and `commands.md` texts are pinned, and the three copies agree.

## W2: 004-63, review of the candidate

Use /reviewer. Shape: review. Pinned to the `cand/<version>` SHA named in the spawn, over the range named there. Read W1, spec 004 D8 and D9, issue #5 and `tasks/004-62/notes.md`. Check that:
- each sentence is true under its policy value in every harness, and Stop does what each says;
- the claim rule holds under both values and agrees with 006's `current-before-claim` and `slow-through-squeal`;
- the skill's reading of the `Slow tier:` line matches both of its endings, and says what to do when the line names no policy because every slow file is current;
- no policy read changed outside the primer's input;
- each new test fails on the base.

Write `reviews/wave-7.md`; commit it.

## W3: 004-64, re-review of the repair

Use /reviewer. Shape: review, narrow, second and last round for this slice. Pinned to the repaired `cand/0.1.202` SHA named in the spawn, over `512eb255..<sha>`: the coordinator's repair `920828b6`, its bundles, and the round-one review file. Read `reviews/wave-7.md` B1 and S1. Check only that:
- the policy-on primer's ending is true where a waiting entry runs and where Stop holds at once (Pi, OpenCode, an untrusted Codex hook), in all four harness forms, within `PRIMER_CAP_CHARS`;
- the policy-off primer still names no completion requirement and no Stop;
- step 4's policy-off branch can no longer bind to the inner `while`, the three copies agree, and the skill is under its 5,000-character budget;
- the bundles match the build.

Write `reviews/wave-7.5.md`; commit it.
