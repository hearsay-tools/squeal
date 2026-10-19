# 005-70 worker notes: the setup wizard proposes the runner's `exclude`

Brief: `../wave-9.md`. Spec: 005 D3 "Slow tests and build-output tests" as amended 2026-10-18, 004 D7 (`vitest.exclude`). Branch `cez/9920d411`.

## What changed

- `src/cli/setup/build-outputs.ts`: `testsBuildOutput(c)`, the D3 step 2 rule for an exclude candidate; and a new evidence source, `ignoredAncestors`: an existing directory a gitignore rule names above a path the group's strings read, even when git tracks it. That finds this repository's committed bundles (`plugins/codex/dist`, force-added past `dist/`), the spec's own example.
- `src/cli/setup/candidates.ts`: each slow group gains `buildOutputs` (the qualifying candidates with their evidence) and `exclude` (`{ glob, into }`, `null` without evidence).
- `src/cli/setup/plan.ts`: `SlowGroup.buildOutputs?`, `SlowGroup.exclude?`, `ExcludeProposal`; `missingKeys` gains `"vitest.exclude"`: an exclude candidate with a Vitest target, not declared slow, and no `vitest.exclude` key. Such a group no longer counts toward the missing `slow` key.
- `src/cli/setup/questions.ts`: an exclude candidate is asked first, default yes (`exclude` / `keep`). The question shows each build output with its evidence, says Squeal never builds and a result against a build it cannot see is tied to no code state, and names the keys a yes writes. No asks the slow question as before. `SetupAnswers.exclude`; `GivenAnswers.slow` carries `exclude`.
- `src/cli/setup/apply.ts`, `command.ts`, `flow.ts`: `--exclude <test glob>` on `squeal init` and `squeal setup`. It goes with `--slow` and `--input` as the answer to every group's questions, and is allowed beside `--slow none`. It is normalised as `--slow` is (bare directory as `<dir>/**`, refused when it selects no test file).
- `src/cli/setup/exclude.ts` (new): `excludeInto` (Vitest when Vitest lists a file; each node:test project that lists one, the glob relative to its `cwd`), `excludeKeys`, `addExcludes`. `addExcludes` writes the excludes and drops each `inputs` key whose test files the excludes all cover.
- `src/cli/setup/config-edit.ts` (new): `editConfig`, `readConfig` and `readOrEmpty` moved out of `apply.ts`, which keeps it under 300 lines.
- `src/cli/setup/format.ts`: a group's `tests build output <path>: <evidence>` lines and `default excluded (<keys>)`.
- Skill, both copies: the description, a table row for `--exclude`, the no-input sentence, and `--exclude` among the flags that answer every group together.
- Tests: `test/cli/setup/exclude-proposal.test.ts` (plan; the brief's first edit), `test/cli/setup/setup-exclude.test.ts` (terminal yes and no, `--yes`, no terminal, `--plan`, `--exclude` flags, cezarion's node:test target, a seed-only project). Existing tests updated where this repository's shape is now an exclude candidate; `SLOW_ONLY_E2E` in `fixture.ts` keeps the slow-path tests on a group that names no build output. Both new files are exempted in `test/version-sensitive.txt`, as the other setup tests that name `nodeTest` are.

## Decisions the spec did not settle

1. **What counts as evidence for an exclude.** The group's tests must name the directory (`named`), and it must be gitignored or written by a build script. Evidence from a manifest field alone does not count: `main` or `bin` can name sources (`lib/index.js`) that the tests name too, and a default-yes exclude there would drop coverage silently. Field evidence is still shown with the rest. Test: "takes a directory the manifest alone names as no evidence".
2. **A tracked directory a gitignore rule names counts as gitignored**, which `git check-ignore --no-index` already reports. That gives `plugins/codex/dist` here, so `squealShaped`'s `test/e2e` is now an exclude candidate and not a slow one, as D3's own example asks.
3. **Yes drops the group's `inputs` keys** whose test files the excludes all cover. Kept, `--check` called them "selects no test file" right after setup's own yes. The question says "their inputs entries go too" when the group has declared inputs.
4. **`missingKeys: "vitest.exclude"`** on the model of `slow`: the key's presence is the signal. A group answered no and then not slow leaves no trace and stays outdated, as a group answered not slow does today.
5. **node:test targets.** A project not in `squeal.config.json` yet (a seed: an existing config without `nodeTest`) gets a printed line naming the exclude to give it, not a write. Vitest is a target when the store or config lists any of the group's files. The store lists both runners, so a node:test-only group can get a harmless `vitest.exclude` entry when a daemon has listed its files.
6. **pytest is not reached.** Slow groups are built from Vitest and node:test files only (`candidates.ts`'s universe), so no group holds pytest files and `pytest[].exclude` is never proposed. Adding pytest files to the slow universe is a separate change to D3 step 1's detection.
7. **`squeal --help` (`src/cli/main.ts`) does not list `--exclude` for `squeal init`.** `main.ts` is a key-format guarded source (`test/keys/key-sources.ts`), so changing it would re-pin `KEY_FORMAT_VERSION` 13 for a help line. `squeal init`'s own usage (`SETUP_FLAGS_USAGE`) and `squeal setup`'s usage name it. Worth folding into the next guarded change.

No guarded source changed: `KEY_FORMAT_VERSION` stays 13.

## Type changes (all additive)

- `SlowGroup.buildOutputs?: readonly BuildOutputCandidate[]`, `SlowGroup.exclude?: ExcludeProposal | null` (plan JSON, schema version unchanged at 1: optional fields).
- `ExcludeProposal { glob; into: ({ runner: "vitest"; glob } | { runner: "nodeTest"; project; glob })[] }`.
- `ConfigFact.missingKeys` union gains `"vitest.exclude"`.
- `SetupAnswers.exclude`, `GivenAnswers.slow` gains `exclude`, `SetupChoices.exclude` (required on these internal types; every constructor updated).

## For the next worker

- This worktree's daemon is an older installed Squeal that reports `unknown key "vitest.exclude"`. It lists and runs `test/e2e` here, so `squeal setup --plan` in this repository still shows `test/e2e` as a group (17 files, evidence `dist` named by `"dist/**"`). After the 0.1.221 release the store drops them.
- The four bundle-drift tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`) fail on this branch because `src/cli/setup` changed and the brief says no `npm run build`. The coordinator rebuilds at integration.
- `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts` failed in the first checkpoint at a load average of 22 to 29 and passed alone (`npx vitest run` on both: 5 passed). They are outside this row.

## Verification

See below: lint, typecheck, and `squeal run --all --wait`.
