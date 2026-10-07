# node-test-module-graph probes (THROWAWAY)

Throwaway experiments for `../../node-test-module-graph.md` (board row 003-02). Not product code. Do not import from here.

- Node 24.21.0 and 22.23.3 (nvm), tsx 4.23.15, es-module-lexer 3.0.3, oxc-resolver 11.24.2, enhanced-resolve 5.26.0, TypeScript 6.0.3 (installed as `ts6`; TypeScript 7.0.2 has no in-process `resolveModuleName`), oxc-parser 0.153.0. Linux x64, 24 cores, shared and loaded.
- `npm install` here. `node_modules/`, `fixtures/` and `results/*.json` are git-ignored. Fixtures are generated.
- `node gen-fixture.mjs fixtures/ref 6 4 4` and `node gen-fixture.mjs fixtures/big 700 300 200`: a reference-project layout (root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` with `test/unit/*.test.ts` run by `node --import ../../scripts/test-git-env.mjs --import tsx --test`, `packages/util` symlinked into `node_modules/@ref/util`), plus one file per resolution edge case under `packages/core/src/edge/`. `big` has 1,000 generated modules and 201 test files.

| Script | Question |
|---|---|
| `static-graph.mjs` | Q1: parser (es-module-lexer + `require` regex) and resolvers `oxc`, `enhanced`, `ts`, `ts-bundler`, `hand`; BFS from test files |
| `recorder-sync.mjs`, `recorder-async.mjs` (+ `-hooks`) | Q2: observed graph from `module.registerHooks` / `module.register`, written per process to `$RECORD_DIR` |
| `observe.mjs <fixture> <out.json> [--isolation=none] [--recorder=async] [--recorder-first]` | Q2: observed closure per test file |
| `compare.mjs <fixture> <observed.json> [resolvers] [--types]` | Q1, Q3: static closure against observed, per resolver |
| `probe-v8-coverage.mjs`, `reporter-coverage.mjs`, `probe-watch-report.mjs`, `probe-require-cache.mjs` | Q2: `NODE_V8_COVERAGE`, `test:coverage`, Node's own `WATCH_REPORT_DEPENDENCIES`, `require.cache` |
| `probe-candidates.mjs` | Q1, Q4: which resolver reports probed paths (D3 resolution candidates) |
| `probe-precedence.sh [node]` | Q1: `x.js` next to `x.ts`, tsx against the static resolvers |
| `bench-static.mjs [fixture] [runs]` | Q1, Q4, Q5: cold build, full re-resolve, one-file edit, stale resolver caches, reverse index |
| `bench-observe.sh <node> <runs>` | Q2: suite wall time without recorder, with recorder, with V8 coverage |

`results/` keeps console output of the runs cited in the findings. `bench-static.mjs` edits files under `fixtures/big` and restores them in `finally`; if it crashes, regenerate the fixture.
