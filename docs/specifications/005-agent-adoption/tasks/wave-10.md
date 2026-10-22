# 005 wave 10: what a toolkit-dev setup check missed

From the review of toolkit-dev session c92fddaf (2026-10-22). Its user asked whether anything was left to configure so that every test runs. On 0.1.258, `squeal setup --plan` printed `Runners: Vitest` while the daemon built no Vitest, hid the refused `test:node` script, and printed `Warm-up: runs all 88 test files, -55 without a current result`. Coordinator: session 7c21a5ae. 005-78 (the skill text) is the coordinator's commit on your baseline. No board edit; no `npm run build`; the coordinator raises the version at integration. The verdict is `squeal run --all --wait`.

## 005-79 and 005-80, one worker

Use /worker. Shape: slice. Outcome: the plan and the daemon agree on which runners run, and the plan names what the config leaves out or runs twice, each with its fix.

Read: 005 D3 step 2 and 003 D7, both as amended 2026-10-22; 003 D1 (the seed's exact form); 007 D1.

Fixture, shaped like toolkit-dev: a root `package.json` with scripts only (`"test:node": "node --test .github/scripts/*.test.js && npm --prefix tools/generator run test"`); `tools/generator/package.json` with `vitest` in `devDependencies` and its own `vitest.config.ts`; a root `pyproject.toml` with `testpaths = ["tests", "plugin-tools"]`; `plugin-tools/a/pyproject.toml` with its own tests; a config with `"nodeTest": []` and both pytest projects.

Seam: `src/cli/setup/plan.ts` (`readRunners`, `nodeTestProjects`), `format.ts`, `repo.ts` (`listTestFiles` dedupes paths but counts current results per project), `src/core/daemon/runner.ts` (`vitestDetected`) and its call in `daemon.ts`. First edit: a plan test on the fixture, red until `Runners:` leaves out Vitest. Setup and the daemon use one detection rule from one source. The daemon computes its note once at start, off the hook path.

Owns: `src/cli/setup/**`, `src/core/daemon/runner.ts`, the Vitest-runner block of `daemon.ts`, their tests, the setup skill's text where it names plan lines. Leave alone: the files of cand/0.1.261 (`plugins/*/bin/squeal-launcher`, `src/cli/start.ts`, `src/core/delivery/**`, `src/core/status/**`, `src/harness/shared/ensure.ts`, `src/core/daemon/open.ts`, `daemon.ts#register`) and the primer.

Done when:
1. On the fixture, `Runners:` has no Vitest, and one line names `tools/generator` as a Vitest Squeal does not run, why, and the fix. A repository with root Vitest prints as before.
2. The daemon on the fixture writes that note once. With root Vitest, it writes none.
3. The refused `test:node` shows the seed's note and template while the config declares no node:test project. A declared project hides it.
4. One line names the overlapping test files' count and both pytest projects.
5. The warm-up counts per project and file and is never negative.
6. `--check` exit status is unchanged; `--json` carries the new facts.
7. lint, typecheck, `squeal run --all --wait`.

Final message: the decisions the spec did not settle, and any type change.
