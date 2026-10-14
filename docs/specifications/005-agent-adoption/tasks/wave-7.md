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
