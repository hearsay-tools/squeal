# Wave 5: the two setup defects before the release

The human's decision of 2026-10-13: fix 005-38 and 005-40 first, then re-run 005-17's real-CLI suite on the final main and release. Two workers on disjoint files. Code and text only: run no model session and never the real `claude` or `codex`. Every full Vitest run uses `--maxWorkers=4`. Don't run `npm run build` in a worker tree.

Read first:
- `research/e2e-setup.md`, Defects 1, 3 and 4;
- spec 005 D3, "Slow tests and their inputs";
- `research/wave-0-checks.md`, question 7.

## 005-38 the default input is the best-supported artifact

Use /worker.

**Outcome.** The input question's default holds only the built artifact the evidence supports, never a source directory. The "named" evidence counts a test file only when one of its strings lies under that candidate.

**Shape.** A repair.

**Seam.**
- `src/cli/setup/artifacts.ts` `namedCandidates` (line 139), where defect 3 starts: a string matches a candidate only when it begins with the candidate's path, relative to the test file or the root, followed by `/`.
- `src/cli/setup/questions.ts` `inputQuestion` (from line 153): the default.
- Choose the ranking yourself and write it in the code comment and in your final message. Every candidate stays offered as a choice, and so does `none`.

**Owns.** `artifacts.ts`, `questions.ts`, `candidates.ts`, `test/cli/setup/candidates.test.ts` and `plan.test.ts`.

**Leaves alone.** `apply.ts`, `command.ts`, `plan.ts`, `flow.ts`, `harnesses.ts`, `plugins/**`, `test/real-cli/**` and the board. These belong to 005-40 or the coordinator.

**Done when.**
- Unit tests cover both fixture shapes in `test/cli/setup/fixture.ts`:
  - this repository's shape without declared inputs defaults to `plugins/**`;
  - cezarion's shape defaults to a choice that holds `packages/cezar/dist/**` and not `packages/cezar/scripts/**`;
  - neither shape gets root `dist` counted as "named" by a string under `plugins/*/dist`.
- Lint, typecheck and the capped suite pass.

## 005-40 setup refuses a slow or input glob that selects nothing

Use /worker.

**Outcome.** No answer that selects nothing is written silently, and `--check` names one already written.
- A `--slow` or `--input` test glob that selects no test file is refused with a message naming it.
- A bare directory (`test/e2e`) is taken as `test/e2e/**` and said so.
- `--input <glob>=none` means "no input" and writes nothing.

**Shape.** A repair.

**Seam.**
- `src/cli/setup/apply.ts`, where the flags are read and written (around line 42).
- `src/cli/setup/plan.ts` `outdated` (line 265): a `slow.include` entry or an `inputs` key that selects no test file.
- `src/cli/setup/harnesses.ts:43`: the Codex install hint printed twice when Codex already has the plugin.
- Both copies of `plugins/*/skills/setup/SKILL.md`, kept identical: say how to answer an input "none" and that a slow glob ends in `/**`. Keep under the size limit `test/harness/setup-skill.test.ts` sets.

**Owns.** `apply.ts`, `command.ts`, `plan.ts`, `harnesses.ts`, both setup skill copies, `test/cli/setup/init-flags.test.ts`, `setup-flow.test.ts` and `setup-changes.test.ts`, and `test/harness/setup-skill.test.ts`.

**Leaves alone.** `artifacts.ts`, `questions.ts`, `candidates.ts`, `test/real-cli/**` and the board.

**Done when.**
- Each of the two session flag sets in `research/e2e-setup.md` defect 4 is refused or normalized, in a unit test.
- `--check` exits 1 naming a written key that selects nothing.
- Lint, typecheck and the capped suite pass.
