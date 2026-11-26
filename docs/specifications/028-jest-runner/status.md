# 028 Jest runner: status

Stage: research
Started: 2026-11-26

## Decisions so far

- 2026-10-06, ADR 0001 (`docs/decisions/0001-typescript-vitest-claude-code.md`): Vitest was chosen over Jest for v0 because of its programmatic API, related-file selection, and warm watch mode.
- 2026-10-25, spec 016 (`016-extensions`): shipped the shared `RunnerAdapter` correctness kit (`test/kit/`), core-owned observed paths (`src/core/keys/observed.ts`), per-check runner identity, and clean runner boundaries (`test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`). Any new runner adapter lives in `src/runners/<runner>/` with a pack in `test/kit/packs/<runner>.ts`.
- 2026-11-26, the human: asked to make sure Squeal can run the tests in `~/projects/saas-boilerplate` (which has 17 Jest 29 projects covering 243 of its 311 test files) and approved researching a Jest runner adapter alongside Docker execution (spec 027).
- 2026-11-26, the coordinator (017fb3d3): opened spec 028 for research only (`research/README.md`, topic `jest-runner`). Dispatched `/researcher` on the standing researcher model (`claude`, `opus`, `high`). No product code or spec yet.
- 2026-11-26, wave 0 research `028-01` done (`research/jest-runner.md`, researcher `096b441e`, `claude` `opus` `high`):
  - On `saas-boilerplate` (`caa46d26`): 17 project configs list 202 test files via `--listTests`; root `jest.config.ts` is `{}` (running it picks up 8 non-tests without project transforms). Direct `jest --config packages/<p>/jest.config.ts <file>` works without Nx; Jest 29 `ts-node` upward-tsconfig lookup trap fixed via `TS_NODE_PROJECT`.
  - Observation inside Jest's VM sandbox: Node module hooks see zero test imports; a `runtime` subclass wrapping per-file `ScriptTransformer` (`transform`, `transformAsync`, `transformJson`) captures exact per-file module lists on both Jest 29.7.0 and 30.5.2 (including mocks, setup files, mapped aliases, computed requires; noise-level overhead). `recorder.cjs` is still needed for `fs`, `spawn`, and `ts-jest` `.d.ts` type inputs (requires a runner-neutral current-file global). `--findRelatedTests` misses setup files and all cross-package imports.
  - Execution: subprocess per batch ~2.0 s warm (+0.2 s/extra file, zero idle RAM); warm `createTestScheduler` host ~0.2 s/file after 1.3 s first file, but RSS grows ~18 MB/file (216 to 746 MB over 30 runs), requiring RSS recycling and context recreation on config/add/delete. `--watch` is not fit.
  - Streaming custom reporter (`onTestFileResult`) passes Kit K8 on 29 and 30, `--testLocationInResults` disambiguates duplicates, and `--coverage --coverageProvider=v8` exposes raw V8 coverage per file (+0.3 s, +75 MB). Loading all 17 projects in one host adds 0.2 s and 16 MB. `RunnerAdapter` fits unchanged.
  - Recommendation: list Jest projects by config path in `squeal.config.json`; ship subprocess-per-batch first, then add recycled warm host. Awaiting human decisions before writing `spec.md`.

## Open questions

1. Jest versions: support Jest 29 only first (`saas-boilerplate` pins `^29.7.0`), or Jest 29 and 30 together in the kit?
2. Execution order: ship subprocess-per-batch first (~2 s/batch, zero idle RAM) and add the recycled warm host (~0.2 s/file, 300 to 750 MB RSS) in a later wave, or go straight to the warm host?
3. Command interception: should Squeal intercept `pnpm nx run <p>:test` and `nx affected -t test`, or only plain `jest` / `pnpm exec jest` / `pnpm test` forms?
4. `ts-jest` type inputs: accept `recorder.cjs`'s wide fs input set (311 paths for one `tools` test file) so `.d.ts` edits re-key accurately, or recommend `isolatedModules`?
