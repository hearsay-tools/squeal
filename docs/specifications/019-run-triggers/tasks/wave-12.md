# Wave 12: follow-ups of 0.1.411 (rows 019-51, 019-52, 011-305)

Approved by the human, 2026-11-06 ("Go"). Two workers on disjoint seams, in parallel. One candidate, 0.1.412, one review.

## W1: rows 019-51 and 019-52 (slice). Use /worker.

**Outcome.** `squeal --help` names `squeal run <group>` and `squeal run <group> <path>...`. A named `status --wait <path>...` that leaves a group's files names the narrow run with the wait's own paths. The deadline line of a wait whose files wait for an install no longer says their runs go on in the daemon.

**Read.** Spec 019 D6 ("Status", "Command", "Narrow run"); `reviews/0.1.411.md` "Non-blocking gaps"; `reviews/0.1.411-r2.md` line 59.

**Seams (leads).**
- 019-51: `src/cli/main.ts`, the help block beside `run --all`, `--fast`, `--slow` (about line 123). Match the wording of the skill's `commands.md` sections for both forms.
- 019-52: `leftGroupText` in `src/cli/status-wait-groups.ts` and its caller in `src/cli/status-wait-lines.ts` (about line 334). The wait's paths reach it through `status-wait-paths.ts` / `status-paths.ts`. Name `squeal run <group> <path>... --wait 60000` with the paths the agent gave, as given; with more than 3 paths, keep `<path>...`. A `stop` group's "this repository requires them before you finish" stays. The whole-group command stays named once, for the rest of the group.
- r2 note: find the generic deadline sentence ("their runs go on in the daemon") that an install-pending wait prints; when every left file waits for an install, it names the install hold instead.

**Owns.** The files above, `plugins/*/skills/squeal/references/*.md` where they quote these lines, and their tests. **Leave alone:** `docs/`, versions, bundles, everything under `test/hash` and `test/keys` (W2's). No `pnpm run build`.

**Done when.** Help text test pins both forms. Text tests: a stop group and a manual group left by a named wait, 1 and 4 paths, Claude Code and Codex CLI naming; an install-pending deadline. Lint, typecheck, `squeal status --wait 60000 <changed paths>` reported (bundle drift failures are expected).

## W2: row 011-305 (repair, test-only). Use /worker.

**Outcome.** The two tests that failed at random on cand/0.1.411 wait for the state they read, and nothing in `src/` changes.

**Read.** Board row 011-305. The failures: run 42273791548 (`test/hash/git-index.test.ts:64`, timeout 5,006 of 5,000 ms) and run 42278432508 attempt 1 (`test/keys/validity/compare.test.ts`, `SyntaxError: Unexpected end of JSON input` in `coverageOf`, `test/keys/validity/coverage.ts:32`).

**Seams (leads).**
- git-index: the test runs several `git` commands under a 5 s default. Measure its time locally; give it an explicit bound that fits a CI runner, or cut its `git` calls. Do not raise the global timeout.
- coverage: `coverageOf` reads every `.json` under the side's `NODE_V8_COVERAGE` directory (`sides.ts:181`, `:304`). A process that has not finished writing leaves a partial file. Find which process writes late (a child not awaited, or a detached one). Fix the wait at its source; skip-on-parse-error only if the late writer cannot be awaited, and then say why.

**Owns.** `test/hash/git-index.test.ts`, `test/keys/validity/*`, and test helpers they alone use. **Leave alone:** `src/`, `docs/`, everything W1 owns.

**Done when.** Each test passes 5 runs in a row locally (`pnpm exec vitest run <file>`, one run at a time; never add load on purpose), with the cause of each failure named in the report. Lint and typecheck pass.
