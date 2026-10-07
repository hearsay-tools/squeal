# 003 node:test runner: status

Stage: approved (2026-10-07, by the human; waves on `docs/board.md`, briefs under `tasks/`)
Started: 2026-10-07

## Decisions so far

- Node's built-in test runner is the second runner, ahead of pytest, because the human's projects run their unit and e2e suites through it behind npm scripts (ADR 0004, 2026-10-07). Cezarion, the reference project: `test:unit` is `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts`; `test:package` is the same over `test/e2e/*.test.ts`; `test` is `vitest run`, which spec 001 already covers.
- The product promise holds (human, 2026-10-07): only the needed tests run, and only the delta reaches the agent. A design that cannot select affected test files per revision, such as running a whole npm script on every change, does not meet it and is out.
- The adapter implements `RunnerAdapter` from `src/core/types/runner.ts`: `invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment`, `run`, `close`. A finding that seems to need an interface change is an open question for the spec, not a decision.
- Check keys must be computable in a fresh worktree without running anything (spec 001 goal 4, inherited baselines), so the closure definition has to be deterministic from files alone.
- Researched and built in parallel with 002 (Codex adapter). The two cross only at `squeal init` and the policy file; that seam is one later row.
- Slow suites that should run at checkpoints rather than on every revision (the e2e blocker) are spec 004, after this one. This spec makes e2e files runnable; it does not decide when.

## Amendments after approval

- 2026-10-07, at approval: the human confirmed that one daemon validates Vitest and node:test projects of one repository together (goal 8, D7). Open questions decided by the coordinator: 1 (`.js`/`.ts` pairs under tsx are noted as an unsupported layout, re-opened only if the wave-1 fixture shows a real project needs them); 2 (`tsconfig.json` enters the closure through resolution reads only, never the environment hash); 3 (a test that spawns `node` itself is not observed past the spawn; such suites declare `inputs`, and spec 004 decides their cadence); 4 (a non-literal test name is one `templated` entry). 5 is measured in wave 1; 6 is later.

## Research

Complete 2026-10-07: `research/node-test-runner-api.md`, `research/node-test-module-graph.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0002-content-keyed-shared-store.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Spec 001 D3, D4, D5, the rules this runner must satisfy: `../001-core-loop/spec.md`
- Prior findings on affected-test selection: `../001-core-loop/research/result-fingerprinting-prior-art.md`, `../001-core-loop/research/vitest-internals.md`
