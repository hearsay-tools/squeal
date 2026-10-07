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

- 2026-10-07, wave 0 (003-10): D7 amended. Vitest is detected by its config files or a `vitest` dependency at the root, never by resolution; a run across adapters merges reports with the worst end and per-part completed files; the `RunReport` doc comment says so. `nodeTest` entries: `name` unique and non-empty, `include` required, `argv` default `[]`, `env` default `{}`, unknown keys and a `cwd` outside the worktree reject the entry. `run --all` retries only the Vitest part. Additive types: `NodeTestProject`, `Policy.nodeTest`.
- 2026-10-07, wave 0 (003-11): fixtures under `test/fixtures/node-test/` (reference workspace with committed workspace symlinks, edge-case forms, failure files, a deterministic 1,000-module generator); `tsx` 4.23 is a devDependency. On Node 22 a killed run keeps the pass file's wrapper completion but not its inner `test:pass`, so D5's completed-files rule reads the wrapper.
- 2026-10-07, before wave 1 (coordinator): D3, D5, D6 and goal 6 amended. The plugin is an esbuild bundle with no `node_modules`, and oxc-resolver and oxc-parser are native per-platform addons, so the graph uses enhanced-resolve (bundled; research measured the same closures at 187 to 204 ms cold for 903 modules, against 47 ms), enumeration uses `module.stripTypeScriptTypes` plus acorn, and the reporter and recorder are dependency-free `.mjs` copied into each plugin's `dist/node-test/`. Goal 6's cold-build bound moves from 100 to 300 ms at 1,000 modules; the promise is unaffected, since refinement never blocks a revision.

- 2026-10-07, during wave 1 (coordinator, asked by 003-14 and 003-13): D2 and D5 amended. Suites are never checks; a test with subtests is a check and so is each subtest; a parent failing only by `subtestsFailed` records pass. One `node --test` process per test file, up to the tier size at once, because Node 22 and 24 before 24.18 forward child events in report order and a hung file hid later files' results under one process per tier; completion is an exited process with the wrapper's `test:complete` and the final `test:summary`; the deadline stays per tier. The `RunReport.failure` comment now allows a completed run to name a file that did not complete.

- 2026-10-07, wave 1 (003-12, 003-13, 003-14), 0.1.16, not yet wired into the daemon: `createNodeTestGraph` (closures as bitsets over strongly connected components, about 10 ms to rebuild the index at 1,000 modules; cold build 152 to 168 ms min at load 40, 170 to 379 ms at load 50 to 78, so goal 6 holds at calm load and the cost test asserts ratios), `runNodeTest` (one process per file, `NODE_TEST_CONTEXT` removed), `identify` and `suffixDuplicates`, `enumerate` (acorn after `stripTypeScriptTypes`, which prints one `ExperimentalWarning` per process on Node 22 and 24: 003-16 decides). Dependencies `acorn`, `enhanced-resolve`, `es-module-lexer` are bundled.

- 2026-10-07, review 003-15 (`reviews/wave-1.md`, PASS at 626b616): no blocker; three proven closure misses, each `complete: true` while tsx loads a file the closure lacks. D3 amended: `extends` paths rebase onto their defining file (S1); conditions follow the module format tsx gives the importer (S2); bare-specifier preloads resolve, inside the worktree they root the preload closure (S3, the one stale-pass path, landing with 003-16). D3 amended by the coordinator: observed-only paths persist in a `meta` key per project and enter `closure()`, so their hashes enter the key with no schema step, instead of being stored beside each result. S1 to S3 with N3, N6, N7 are row 003-20; N1, N2, N4, N5 and the review's inputs go to 003-16. Crossing with 001-105 (per-package dependency keys, other session): the node:test adapter reports no package entries until a later row, so its files keep the whole-lockfile fingerprint.

- 2026-10-07, wave 2 (003-20, 003-23), 0.1.19: the three closure misses of `reviews/wave-1.md` fixed, each a fixture test equal to the recorder's observed closure (`test/fixtures/node-test/monorepo/`); a computed `require(x)` marks the closure incomplete; absent `node_modules` directories are no candidates. Decided by the worker: a dynamic `import()` in a module tsx compiles to CommonJS keeps the `import` conditions (verified), and `.tsx`/`.jsx` follow the package `type`. Open question 5 closed: at 10,000 modules and 2,000 test files the closure index is 5.9 MB and builds in 188 to 378 ms under load, but the module table and enhanced-resolve caches retain about 140 MB, 123 MB of it resolver caches; a follow-up candidate (drop the caches after a build). `squeal init` seeds `nodeTest` from scripts of the exact form `node [flags...] --test <globs...>` in the root and `workspaces` packages (not `pnpm-workspace.yaml`); flag values are recognised by a fixed list of value flags, so an unlisted one gets a template.

## Research

Complete 2026-10-07: `research/node-test-runner-api.md`, `research/node-test-module-graph.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0002-content-keyed-shared-store.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Spec 001 D3, D4, D5, the rules this runner must satisfy: `../001-core-loop/spec.md`
- Prior findings on affected-test selection: `../001-core-loop/research/result-fingerprinting-prior-art.md`, `../001-core-loop/research/vitest-internals.md`
