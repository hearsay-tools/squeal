# 003 wave 0 briefs

Both rows run in parallel with 002 wave 0. Workers read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/003-node-test-runner/spec.md` and `status.md` first.

## 003-10 `nodeTest` policy and the composite runner

Outcome: `squeal.config.json` accepts `nodeTest` projects, and the daemon can hold several runners behind one `RunnerAdapter`.

Read: spec 003 D1, D7, D8; spec 001 D11; `src/core/types/policy.ts`, `src/core/daemon/policy.ts`, `src/core/daemon/runner.ts`, `src/core/daemon/daemon.ts` lines 236 to 262, `src/core/types/runner.ts`.

Shape: slice.

Seam: `src/core/types/policy.ts`. First edit: add `NodeTestProject` (`name`, `cwd?`, `node?`, `argv`, `env`, `include`, `exclude?`) and `nodeTest: readonly NodeTestProject[]`, default `[]`. Then: the loader validates each entry as 001 D11 does (a bad entry is one problem, that project skipped, the rest kept); `squeal init` writes `"nodeTest": []`; the skill's `references/policy.md` documents the key; `src/core/daemon/composite-runner.ts` implements `RunnerAdapter` over a list, mapping project to adapter from `testFiles()` and `environment()`, concatenating those, fanning out `affected` and `invalidate` and merging their results, dispatching `run` by project and merging `RunReport`s, closing each; `src/runners/node-test/adapter.ts` exports a stub `createNodeTestAdapter(project)` that returns no test files and no environment, so configuration is accepted before wave 1 lands; `daemon.ts` builds the Vitest adapter when a Vitest config is detected and a stub per configured project, and emits the "project without Vitest" note only when neither exists.

Owns: `src/core/types/policy.ts`, `src/core/daemon/policy.ts`, `src/core/daemon/runner.ts`, `src/core/daemon/composite-runner.ts`, the runner construction in `src/core/daemon/daemon.ts`, `src/runners/node-test/adapter.ts`, `src/cli/init.ts` (the default config only), `plugins/claude-code/skills/squeal/references/policy.md`, `test/policy/**`, `test/daemon/composite-runner.test.ts`. Leave alone: `src/harness/**` (002-10), `src/runners/vitest/**`, `test/fixtures/node-test/**` (003-11), every other `src/core` module.

Done when: policy tests accept a valid list and note a bad entry; composite tests over two fake adapters cover every method, a `run` whose files span both adapters, and one adapter's `crashed` report; a config with one `nodeTest` project and no Vitest starts a daemon without the Vitest note (existing daemon tests stay green); lint, typecheck and the full suite green. Report every type change.

Use /worker.

## 003-11 fixtures

Outcome: the fixtures wave 1 tests run against exist and behave as designed under the project's own `node --test`.

Read: spec 003 Testing and D3 (the specifier forms); `test/fixtures/README.md`; `research/probes/node-test-module-graph/gen-fixture.mjs`, `fixtures/`, and `research/probes/node-test-runner-api/fixture.mjs`.

Shape: slice.

Seam: `test/fixtures/node-test/reference/packages/demo/package.json`. First edit: the two scripts in cezarion's shape (`node --import ../../scripts/preload.mjs --import tsx --test test/unit/*.test.ts`, and the same over `test/e2e/*.test.ts`), `scripts/preload.mjs` that imports one helper and sets a marker, two passing unit files and one e2e file, a workspace package under `packages/util` imported by name. Then `test/fixtures/node-test/edge/`: one test file holding every D3 form (`.js` meaning `.ts`, extensionless, directory `index`, tsconfig `paths`, package `imports` `#x`, `exports` subpath, symlinked workspace package, `export ... from`, `import type`, literal `import()`, template-literal `import()`, computed `import(p)`, `require` through `createRequire`, JSON with `with { type: "json" }`, a `readFileSync` of a fixture, a `child_process` script) with a README stating which the static closure sees; a failing file, a syntax-error file, a missing-import file, a busy-loop file, a duplicate-name file; `test/fixtures/node-test/gen-big.mjs` from the research generator (1,000 modules, about 200 test files, deterministic). Add `tsx` as a devDependency so fixtures resolve it from the repository's `node_modules`.

Owns: `test/fixtures/node-test/**`, `test/runners/node-test/fixtures.test.ts`, the `tsx` devDependency in `package.json` and `package-lock.json`. Leave alone: everything under `src/`, other fixtures.

Done when: `test/runners/node-test/fixtures.test.ts` runs each fixture with the current Node and asserts pass, fail, syntax error, missing import and a killed busy loop as designed; the generator runs under 2 s and its output is gitignored; lint, typecheck and the full suite green on Node 22 and 24 (nvm is installed).

Use /worker.
