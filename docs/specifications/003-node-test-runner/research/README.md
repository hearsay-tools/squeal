# Research brief for spec 003: node:test runner

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made, spec 001 sections D3 to D5 for the rules a runner must satisfy, and `src/core/types/runner.ts` for the interface. `../../001-core-loop/research/vitest-internals.md` shows what the first runner gave Squeal for free; this runner gives none of it.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the Node version you looked at; run experiments on Node 22 and Node 24 where behaviour could differ (`nvm` is installed).
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README, with `node_modules` ignored. No product code anywhere else.
- A fixture should look like the reference project: `*.test.ts` files run through `node --import tsx --test`, one extra `--import` preload, a `packages/<name>` workspace layout.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/003-node-test-runner/research/`.

## Topic: node-test-runner-api

Squeal will run an explicit list of node:test files repeatedly, read per-test results with locations, tell a file-level import error from a failing test, and honour the flags the project's npm scripts pass to `node`.

1. Programmatic API: `run()` from `node:test`: its options (`files`, `isolation`, `concurrency`, `execArgv`, `setup`, `timeout`, `signal`, `testNamePatterns`, `only`, `watch`), and the `TestsStream` events (`test:enqueue`, `test:dequeue`, `test:start`, `test:pass`, `test:fail`, `test:diagnostic`, `test:stderr`, `test:stdout`, `test:coverage`, `test:summary`, others) with the fields each carries: name, nesting, file, line, column, duration, error details. Verify on the fixture.
2. Which Node runs the tests: Squeal's daemon runs on the Node its plugin installed with, while the project may pin another. Compare in-process `run()` against spawning the project's `node --test --test-reporter=<module> --test-reporter-destination=<path>` with a custom reporter. Which gives per-test results, exit codes, file-level errors and timeouts reliably, and which Node version and flags each ends up using?
3. Enumeration without running: is there a dry-run or collection-only mode? If not, what are the alternatives, and how stable is test identity across runs (full name with nesting; names built in loops; `describe` and `it` aliases; `only` and `skip`; `todo`)?
4. The project's npm scripts: how to take the `node` flags a script passes (`--import`, `--require`, `--experimental-*`, environment assignments) and the file globs from `package.json` without running the script, and what the reference project's two scripts need exactly, including a relative preload path from a workspace package. Should the adapter read scripts, or should `squeal.config.json` declare the command and globs? Name what each choice gets wrong.
5. Cost: with one process per file and tsx, on a 20-file fixture: per-file wall time, the effect of `concurrency`, and the floor for one file. `isolation: 'none'`: speed, and what goes wrong when a changed module is re-run in the same long-lived process.
6. Results in detail: per-file duration (is there a file-level pass event?), failure location (test line and column against the error's stack), file-level errors (a syntax error or a failing import in a test file: which events fire, what does the stream carry), `--test-timeout` and a test that never ends, `process.exitCode` after a run, and the `tap`, `spec` and `junit` reporters as fallbacks.
7. Sharp edges: workspaces, TypeScript through tsx against Node's own type stripping, ESM and CJS mixes, `--experimental-test-coverage`, snapshot tests (`t.assert.snapshot`, `--test-update-snapshots`), `--test-concurrency`, and `--test-only`.

## Topic: node-test-module-graph

Spec 001 D3 keys a result by the hashes of every project file in its test file's closure, and D5 runs, per revision, only the test files whose closure holds a changed path, direct importers first. Vitest gave Squeal the closure and the affected set from its transform graph. node:test has no graph, no transform cache and no warm instance.

1. Static graph: parse imports (static `import`, `export from`, `require`, dynamic `import()` with literal specifiers) and resolve them as the project's Node would, with tsx in the loader chain: `.js` specifiers that mean `.ts` files, extensionless specifiers, `tsconfig` `paths`, package `imports` and `exports`, directory `index` files, symlinked workspace packages. Compare at least two of: `es-module-lexer` plus `oxc-resolver`, `enhanced-resolve`, TypeScript's `resolveModuleName`, a hand-rolled resolver. Measure on a 1,000-module fixture. Name what each misses: computed specifiers, `fs` reads of fixtures, scripts run through `child_process`.
2. Observed graph: record which files a test file actually loaded, per test file, during a run. Options: a `module.register()` customization hook installed through `--import` that writes loaded file URLs per process; `NODE_V8_COVERAGE`; the `test:coverage` event of `--experimental-test-coverage`; `require.cache` for CJS. Which work with one process per file, which under `isolation: 'none'`, what each costs, and whether preload files (`--import`) are separable from the test's own closure, as spec 001 D3 separates setup files into the environment hash.
3. Which graph the key uses: spec 001 goal 4 needs the key computable in a fresh worktree before any run, so inherited results can be looked up. Does that force the static closure into the key, with the observed closure as a check on its completeness? What happens to a result whose observed closure holds a file the static closure missed: how would Squeal report the incompleteness (D3's `complete: false`)?
4. Resolution changes: spec 001 D4 and its waves 7 to 9 spent a great deal on which cached transforms an add, delete or `package.json` edit can make wrong. With no transform cache, is a full static re-resolve of every closure after such a change cheap enough on 1,000 modules to replace those rules? Measure.
5. Direct against transitive importers (D5 ordering) from a reverse index: confirm it is one lookup and measure.
6. Prior art: how `node --test --watch` decides which files to re-run (read Node's `lib/internal/test_runner/` and `lib/internal/watch_mode/` at the installed version), how Jest's `--findRelatedTests` builds its graph, and how testmon handles a closure it cannot see. One paragraph each; what Squeal can reuse.
7. Recommendation: the closure definition for a node:test file, the `affected` algorithm, their measured cost, how the key stays computable in a fresh worktree, and what the first fixture tests of a board row would assert.
