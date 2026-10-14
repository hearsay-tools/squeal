# Wave 7: before the release

The human decided on 2026-10-14:
- fix 005-47 before the release;
- review 001's unreviewed test-only rows (001-352, 001-354) before the release;
- keep D8 off.

The two rows below touch disjoint files. Every full Vitest run uses `--maxWorkers=4`. Don't run `npm run build` in a worker tree. Run no model session and never the real `claude` or `codex`.

## 005-47 gate rewording never inverts or breaks a line

Use /worker.

**Outcome.** `squeal setup` rewords only lines that tell the agent to run the test command. Its rewording never lands inside a sentence, and a file that already holds hand-written Squeal instructions is named in the plan.

**Read.**
- Spec 005 D5 (`spec.md:132`) and D4.
- `lessons.md`, "Proposed Squeal rows" 2, and the Sessions bullet on the gate rewording.
- Cezar's lines, read only, never written: `git -C /home/agent/projects/cezar show 5dbb4b09:AGENTS.md`, lines 172, 185, 201, 237 and 326, plus cezar's own Squeal paragraph around line 185.

**Shape.** A repair.

**Seam.** `src/cli/setup/gates.ts`:
- `commandLines` (line 106) and `compound` (line 142) decide what is a gate line. A line that is negated (it says `do not`, `don't`, `never`, `instead of` or `avoid` before the command), or that names Squeal itself, is no gate line. Report it as a mention, as agent files' lines are.
- `reword` (line 163) appends its exit-3 sentence. It may append only when the line ends a sentence. A line that ends in a comma or mid-clause, or is a table row, is reported with a reason and not reworded.

The plan also names a file with Squeal instructions outside the managed block, as `instructions[].squealMention` with its line, or a name you choose and write down. The setup skill tells the agent to show that line to the user. The default for the block stays as it is.

**Owns.**
- `src/cli/setup/gates.ts`, `plan.ts` and `format.ts`;
- `test/cli/setup/gates.test.ts` and `plan.test.ts`;
- both copies of `plugins/*/skills/setup/SKILL.md`, kept identical and under 5,000 characters;
- `test/harness/setup-skill.test.ts`.

**Done when.**
- Each of cezar's 5 lines is a unit fixture: 185 is not proposed at all, and none of the 5 gets a broken sentence.
- This repository's own gate line (`CLAUDE.md`'s Verification line, which already names Squeal) is not proposed again.
- A plain gate such as "Run `npm test` before you finish." is still reworded.
- Lint, typecheck and the capped suite pass.

## 005-52 review of 001-352 and 001-354

Use /reviewer.

**Outcome.** `docs/specifications/001-core-loop/reviews/wave-005-52.md`, which reviews `0298c91b` (001-352) and `0cca04a8` with `caba8922` (001-354).

**Scope.** Only these three commits:
- 001-352: `test/daemon/slow-lane.test.ts` now renames its started file into place, instead of reading a half-written one.
- 001-354: `test/runners/vitest/overlap.test.ts`, a new regression, plus a research note.

Check the following:
- each test proves what its row claims;
- no test can pass on a broken product;
- the rename is atomic on Linux and macOS;
- the note claims nothing the probes don't show.

Write the file within 15 minutes of starting, then extend it.

**Rules.**
- Run no model session and never the real `claude` or `codex`.
- Run each touched file 5 times under load with `--maxWorkers=4`.
- Run one full `npx vitest run --maxWorkers=4`.
- Don't run `npm run build`.
- Commit the findings file only.

## 005-54 narrow review of 005-47

Use /reviewer.

**Outcome.** `reviews/wave-7.md` on `970af7ba..32168eec` (005-47), at 0.1.160. Write it within 15 minutes of starting, then extend it.

**Check.**
- No gate line that is negated, names Squeal, or describes the command is reworded.
- No rewording leaves a broken sentence, and the fallback sentence follows the command's own sentence.
- A plain gate is still reworded, D5's first example is reworded exactly, and this repository's line is not proposed again.
- `squealMentions` in the plan and the skill sentence match what setup does.
- The two skill copies are identical.

Look for a realistic instruction line that is still mis-reworded. Use this repository's `docs/`, the skills and cezar's `AGENTS.md` through `git -C /home/agent/projects/cezar show 5dbb4b09:AGENTS.md` as a corpus, and report every line setup would reword along with its result.

**Rules.**
- Run no model session and never the real `claude` or `codex`.
- Never write to cezar.
- Run exactly one `npx vitest run --maxWorkers=4`.
- Don't run `npm run build`.

## Wave 7.5: 005-55 gate rewording by allow-list (005-54 B1 to B3)

Use /worker.

**Outcome.** Setup proposes rewording only for a line that plainly tells the agent to run the test command. Every other line holding the command becomes a mention that the plan shows. This turns 005-47's deny-list round the other way: 005-54 showed that listing exceptions misses real prose.

**Read.**
- `reviews/wave-7.md`, B1 to B3 and its corpus appendix;
- spec 005 D5;
- `src/cli/setup/gates.ts` at 0.1.160.

**Shape.** A repair.

**Seam.** `src/cli/setup/gates.ts`, `scanGates`, `commandLines`, `reword` and their helpers. A line is a gate only when all of the following hold:
- (a) The sentence holding the command starts, after an optional list marker or a bold or `Label:` prefix such as `Verification:`, with an imperative from a short list: `Run`, `Use`, `Execute`, `Verify with`, `Before you finish, run`. Choose the final list from the corpus and write it in the comment.
- (b) The line does not continue a sentence begun on the line before.
- (c) No negation precedes the command in its sentence: `e.g.`, `i.e.`, `etc.`, `vs.` and a dot inside parentheses never end a sentence.
- (d) The fallback goes right after that sentence's real end.

Anything not matched is a mention: the plan lists it with the reason "not an instruction to run it". `--gate <id>=reword` is refused for it.

**Owns.**
- `src/cli/setup/gates.ts`;
- `test/cli/setup/gates.test.ts`, `init-flags.test.ts` and `plan.test.ts`;
- both setup skill copies, if their wording on gates changes, and `test/harness/setup-skill.test.ts`.

**Done when.**
- Each B1 to B3 fixture from the review is a regression test.
- Every proposal in the review's corpus appendix is either a true instruction, reworded exactly, or a mention, and a test pins a sample of 10 from it.
- These are still reworded exactly: D5's first example (`VITEST_GATE`), "Run `npm test` before you finish.", and "Do not commit generated files. Run `npm test` before you finish.".
- Lint, typecheck and the capped suite pass.

**Rules.**
- Run no model session and never the real `claude` or `codex`.
- Read cezar only through `git show`.
- Run every full Vitest run with `--maxWorkers=4`.
- Don't run `npm run build`.
