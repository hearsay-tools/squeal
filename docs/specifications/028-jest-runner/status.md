# 028 Jest runner: status

Stage: research
Started: 2026-11-26

## Decisions so far

- 2026-10-06, ADR 0001 (`docs/decisions/0001-typescript-vitest-claude-code.md`): Vitest was chosen over Jest for v0 because of its programmatic API, related-file selection, and warm watch mode.
- 2026-10-25, spec 016 (`016-extensions`): shipped the shared `RunnerAdapter` correctness kit (`test/kit/`), core-owned observed paths (`src/core/keys/observed.ts`), per-check runner identity, and clean runner boundaries (`test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`). Any new runner adapter lives in `src/runners/<runner>/` with a pack in `test/kit/packs/<runner>.ts`.
- 2026-11-26, the human: asked to make sure Squeal can run the tests in `~/projects/saas-boilerplate` (which has 17 Jest 29 projects covering 243 of its 311 test files) and approved researching a Jest runner adapter alongside Docker execution (spec 027).
- 2026-11-26, the coordinator (017fb3d3): opened spec 028 for research only (`research/README.md`, topic `jest-runner`). Dispatched `/researcher` on the standing researcher model (`claude`, `opus`, `high`). No product code or spec yet.

## Open questions

1. Which execution architecture best fits Jest in Squeal: warm runner-host over `@jest/core`, subprocess per batch with Jest's transform cache, or another shape?
2. How should Squeal compute accurate closures and affected-test sets for Jest (including `moduleNameMapper`, `tsconfig` paths, `@nx/jest`, transforms, and observing modules loaded inside `jest-runtime`'s VM sandbox)?
3. How should multi-project Jest monorepos (like `saas-boilerplate`'s 17 Nx projects) be discovered, configured in `squeal.config.json`, and run without excessive memory or startup cost?
4. What Jest versions (29, 30) and gaps (if any) belong in the Spec 016 kit pack?
