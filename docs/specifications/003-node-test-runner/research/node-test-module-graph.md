# Research: node-test-module-graph

Researcher task for spec 003, board row 003-02. Versions: **Node 24.21.0 and 22.23.3**, tsx 4.23.15, es-module-lexer 3.0.3, oxc-resolver 11.24.2, enhanced-resolve 5.26.0, TypeScript 6.0.3 (7.0.2 is npm `latest` and has no in-process `resolveModuleName`), Jest 30.5.2, pytest-testmon 2.2.0. Linux x64, 24 cores, shared machine at load 6 to 50, so timings are ranges.

Probes: `probes/node-test-module-graph/` (throwaway, see its README; console output of every cited run is in its `results/`). Two generated fixtures shaped like the reference project: root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` tests run as `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts`, `packages/util` symlinked into `node_modules/@ref/util`, one file per resolution edge case. `fixtures/big` has 1,000 generated modules plus the edge cases; 903 are reachable from its 201 test files; 2,515 edges; median test-file closure 554 modules (min 34, max 649).

## Questions answered

| # | Short answer |
|---|---|
| 1 | es-module-lexer plus oxc-resolver gives exactly the observed closure for 200 of 201 test files; the last misses the one path behind a truly computed `import(p)`. 47 ms cold on the 1,000-module fixture. enhanced-resolve and TypeScript in `Bundler` mode match it at 4x and 2x the cost; TypeScript with the project's own `NodeNext` tsconfig misses 620 paths. Blind spots: computed specifiers, `fs` reads, child processes, and a `.js` next to a `.ts` imported from a JS file. |
| 2 | A `module.registerHooks` resolve hook in an `--import` preload records (parent, url) edges in every test process, under one process per file and under isolation none, with overhead inside noise. `module.register` (async) misses `require`. V8 coverage, `test:coverage` and `require.cache` give sets without edges, merged or partial. Preloads separate cleanly by reachability. |
| 3 | Yes: the key must use the static closure. The observed closure is the completeness check; a result whose observed closure holds a path the static one missed should be stored with that path and its hash, flagged incomplete, and inherited only when that hash matches too. |
| 4 | Yes. A full re-resolve of every closure, parses kept, costs 33 ms (oxc) on 1,000 modules, and a cleared cache gave 0 wrong closures in all four structural edits; a kept cache gave up to 200 wrong. |
| 5 | One map lookup per changed path from a path-to-test-files index: under 0.1 ms; the index builds in 47 ms. A reverse BFS without the index: 0.1 to 0.2 ms. |
| 6 | Node's `--test --watch` is observed-only (children report every loaded URL over IPC, keyed by test file). Jest's `--findRelatedTests` is static (regex extraction, resolve everything, backward fixed point). testmon is runtime coverage only and ignores what it cannot see. |
| 7 | Closure = static import closure from es-module-lexer plus oxc-resolver configured like tsx, plus the manifests resolution read; `affected` = full re-resolve on structural change, then reverse-index lookup split direct and transitive; observed closure from a sync hook checks it after each run. Costs and first fixture tests below. |

## Findings

### Q1. Static graph

Parser: es-module-lexer 3 lexes TypeScript directly, reports `import type` and `export type` with `typeOnly`, reports a template-literal `import()` as a glob (`./plugins/*.ts`) with `glob: true`, and a non-literal `import(p)` with `specifier: null`. It does not see `require`; the probe adds a regex. Parse of 902 files (184 KiB, in memory): es-module-lexer 1.9 ms, `ts.preProcessFile` 3.6 ms, oxc-parser 8.0 ms, `stripTypeScriptTypes` then lexer 25 ms (Node 24; Node 22: 2.0, 5.8, 8.8 and 25.9 ms). `verified by experiment` (`bench-static.mjs`), `read in official docs` (es-module-lexer README, "TypeScript" and glob sections).

Resolvers were configured like tsx: `extensionAlias` `.js -> .ts,.tsx,.js`, extensionless and directory `index` lookup, tsconfig `paths`, conditions `node, import` (or `require`), symlinks to real paths. Correctness against the observed closure on `fixtures/big` (`compare.mjs`, `verified by experiment`, identical on Node 24.21.0 and 22.23.3):

| Resolver | Missing (observed, not static) | Extra | Unresolved | Cold build, 903 modules (Node 24 / 22) | Notes |
|---|---|---|---|---|---|
| es-module-lexer + oxc-resolver | 1 (`var-target.ts`, via `import(p)`) | 1 | 0 | 47 ms / 54 ms | `tsconfig: 'auto'` finds each package's tsconfig; no probed-path list |
| enhanced-resolve | same 1 | 1 | 0 | 187 / 204 ms | reports `fileDependencies` (every `package.json` and `tsconfig.json` read) and `missingDependencies` (every absent candidate probed): D3's resolution candidates (`probe-candidates.mjs`) |
| TypeScript 6 `resolveModuleName`, `Bundler` | same 1 | 1 | 0 | 97 / 111 ms | needs `allowJs`, `resolveJsonModule`; reports `failedLookupLocations` |
| TypeScript 6, the fixture's own `NodeNext` tsconfig | 620 paths | 1 | 693 | n/a | refuses extensionless and directory imports in ESM, which tsx accepts |
| hand-rolled (~90 lines) | same 1 | 1 | 0 | 237 / 245 ms | slow because uncached `stat`; easy to make report candidates |

Every specifier form the brief names resolved: `.js` meaning `.ts`, extensionless, tsconfig `paths` (`~/edge/dir`), package `imports` (`#internal/*`), `exports` with subpath patterns, directory `index`, the symlinked workspace (resolved to `packages/util/src/...`, as Node does), `export ... from`, literal `import()`, JSON with `with { type: "json" }`, `require` through `createRequire`. The one extra path is `shape.ts`, imported without `type` but used only as a type: esbuild under tsx drops the import, so it never loads. Over-inclusion only costs runs. `verified by experiment`.

What every static approach misses (`verified by experiment` on `edge.test.ts`): the computed `import(p)`; the `readFileSync` of `fixture.txt`; the script run by `execFileSync` (`child-script.mjs`, `child-dep.mjs`). The observed graph misses the last two as well. A template-literal `import()` is covered by expanding its glob against the directory, which then belongs in the closure as a directory listing.

Precedence (`probe-precedence.sh`, `verified by experiment` on both versions): with both `a.js` and `a.ts` present, tsx loads `a.ts` for `./a.js` from a `.ts` importer and `a.js` from a `.mjs` importer. All four static resolvers pick `a.ts` from both. A project with compiled `.js` beside its sources and a JS importer gets a wrong edge unless the resolver varies `extensionAlias` by importer. Without tsx (native type stripping), the extensionless import fails with `ERR_MODULE_NOT_FOUND` on both versions, while an explicit `./c.ts` loads: the resolver configuration has to follow the loader chain in the script's flags. `inferred` beyond the probed cases.

### Q2. Observed graph

| Option | One process per file | Isolation none | Edges | Preload separable | Cost on 201 files (Node 24) | Verdict |
|---|---|---|---|---|---|---|
| `module.registerHooks` resolve hook via `--import` | yes, file per pid | yes: per-file closures by reachability equal the per-process ones for 201/201 files | yes (parent, specifier, url) | yes | 8.1 to 8.5 s against 7.9 to 9.0 s base; none 1.23 to 1.31 s against 1.19 to 1.27 s | use |
| `module.register` async hook | yes | yes | yes | yes | not timed | misses `require` (`legacy.cjs`, `legacy-dep.cjs`) on 22.23.3 and 24.21.0 |
| `NODE_V8_COVERAGE` | yes, attribute by the test file in the list | no: one file holds the union | no | no: preload files appear in every list | 9.1 to 15.3 s, +14 % to +94 % | sees grandchild processes but cannot link them to a test |
| `--experimental-test-coverage`, `test:coverage` | no: one event per run, `nesting 0`, `file null`, merged | no | no | no | not timed | Node 22 also lists the test files, Node 24 excludes them |
| `require.cache` | CJS only | CJS only | `children` | n/a | free | only the 2 `.cjs` files of the fixture |
| Node's own `WATCH_REPORT_DEPENDENCIES=1` plus an IPC channel | needs the test in the process Squeal spawned | yes, as a union | no | no | free | see Q6 |

All `verified by experiment` on both versions except where a cell says otherwise (`observe.mjs`, `bench-observe.sh`, `probe-*.mjs`; output in `results/observed-runs.txt`). Under isolation none the suite ran in 1.2 to 1.9 s against 7.9 to 9.5 s with a process per file.

Hook placement: after tsx, the hook misses what the first preload imported. First in the chain, it also records the preload's own import (`scripts/lib/git-env-helper.mjs`, parent the preload), and every test-file closure is unchanged. Reachability from the test file URL separates the preload's closure from the test's, as D3 separates setup files. `verified by experiment`.

Node 22.23.3 rejects `--test-isolation` and needs `--experimental-test-isolation`. Preloads run only in the test children, not in the `--test` parent, on both versions. `verified by experiment`.

### Q3. Which graph the key uses

The observed closure exists only after a run in the worktree that ran it, so goal 4 forces the static closure into the key (`inferred` from spec 001 goal 4 and the status decision). The static closure was a superset of the observed one for every test file but the `import(p)` one (Q1), so the observed closure works as a check. Keying on an observed-only path would make the key depend on store state, not files. Instead: store such paths with their hashes beside the result, set D3's `complete: false` with the reason ("loaded at run time, not statically reachable: `src/edge/var-target.ts`, `import(p)` in `computed-var.ts`"), count a lookup as a hit only when those hashes still match, and let a change to such a path schedule the file. `inferred`. The parse already flags every non-literal `import()` (`specifier: null`), so the closure is known incomplete before any run.

### Q4. Resolution changes

`bench-static.mjs`, 7 runs, medians, `verified by experiment`, Node 24.21.0 (Node 22.23.3 within 15 %, `results/bench-static-node22.txt`):

| Step | oxc | enhanced | TS Bundler | hand |
|---|---|---|---|---|
| Cold: read, parse, resolve, 903 modules | 47 ms (42 to 64) | 187 ms | 97 ms | 237 ms |
| Full re-resolve, parses kept, resolver cache cleared | 33 ms (30 to 36) | 165 ms | 82 ms | 218 ms |
| Warm re-resolve, cache kept | 23 ms | 111 ms | 45 ms | 212 ms |
| One edited file: re-parse and resolve its specifiers | < 0.1 ms | 0.1 ms | < 0.1 ms | 0.2 ms |

Four structural edits, each checked against a fresh build: delete `src/m010.ts` (changes 200 of 201 test closures); replace `paths-target.ts` by `paths-target/index.ts` (1 closure); retarget `exports["./str"]` in the workspace `package.json` (edges of 102 modules, counting newly reached ones); add a more specific tsconfig `paths` entry (edges of 1 module). With the resolver cache kept, oxc, enhanced-resolve and TypeScript were wrong on exactly the files the edit changed (up to 200 closures); the hand-rolled resolver was wrong on the `package.json` edit only. With the cache cleared, all four were wrong on 0 files, at 29 to 37 ms for oxc on both versions. So with no transform cache, D4's add, delete and `package.json` rules reduce to one rule: on any add, delete, `package.json` or `tsconfig.json` change, clear the resolver cache and re-resolve every closure from cached parses. oxc-resolver's `clearCache()` is all or nothing (`index.d.ts`, `read in source code`).

### Q5. Direct against transitive importers

Index from the oxc graph: `path -> test files that import it in one hop (or are it)` and `path -> test files whose closure holds it`: 903 paths, 112,360 entries, built in 42 to 50 ms. `affected` for a leaf module (`m000.ts`: 2 direct, 198 transitive), a top module (`m699.ts`: 11 direct, 0 transitive) and 10 random files (3 direct, 197 transitive): median under 0.1 ms per lookup over 1,000 repetitions. A reverse BFS over reverse edges, with no closure index, gives the same set in 0.1 to 0.2 ms median (max 2.1 ms). Both are one lookup in practice. `verified by experiment` on both versions.

### Q6. Prior art

**`node --test --watch`** (`lib/internal/test_runner/runner.js`, `lib/internal/watch_mode/files_watcher.js`, `lib/internal/modules/esm/loader.js`, `lib/internal/modules/cjs/loader.js` at v24.21.0, commit 955266b, and v22.23.3, commit 80dc632; `read in source code`). Watch mode spawns each test child with `WATCH_REPORT_DEPENDENCIES=1` and an IPC channel (runner.js 521 to 524 on 24). The ESM loader then sends `watch:import` with every resolved URL (esm/loader.js 529), the CJS loader `watch:require` with every loaded file and, on a miss, every extension tried (cjs/loader.js 320, 333). `FilesWatcher.filterFile` files each dependency under its owner test file; a change re-runs the owners only, or restarts the one process under isolation none. Observed-only: nothing is known before the first run; new test files are found by re-globbing only when no files were named. In `filterFile`, `#ownerDependencies.get(file)` reads where `owner` seems intended (line 146 on 24, 141 on 22); `inferred` to over-select, not run. Squeal can reuse the channel (`probe-watch-report.mjs`: works on both versions with an IPC parent under isolation none), but it carries no parent URL, so a shared process gives a union; the sync hook gives edges.

**Jest 30.5.2 `--findRelatedTests`** (`jest-haste-map/build/index.js` 1340 to 1384, `jest-resolve-dependencies/build/index.js` 47 to 151, `@jest/core` `SearchSource.findRelatedTests` 507; `read in source code`). The haste map extracts specifiers per file with regexes (`import`/`export ... from` without `import type`, literal `require(` and `import(`, `jest.requireActual`), cached with the file's metadata. At query time `resolveInverseModuleMap` resolves every file's specifiers with jest-resolve, silently drops unresolvable ones, and walks a fixed point backwards from the changed paths; a changed snapshot maps to its test file. Reusable: cached per-file extraction, the snapshot mapping. Not reusable: the silent drop, which D3 forbids.

**pytest-testmon 2.2.0** (commit dccc58d; `testmon/testmon_core.py` 59, 487 to 525, `testmon/db.py` 666 to 726; `read in source code`). Coverage.py per test, limited to the root minus library paths, stores checksums of the executed method blocks of each Python file; a test re-runs when one of them changes. Non-Python files are not tracked; installed packages and the Python version form an environment record (`packages_changed`). What it cannot see it ignores: no static fallback, no incompleteness flag. Reusable: checking a closure at run time, the environment record (already D3). Not reusable as the key: it needs a run first.

## Recommendation for Squeal

1. **Closure of a node:test file**: the test file, its transitive static closure from es-module-lexer (dropping `typeOnly` records) plus a `require` scan, resolved by oxc-resolver configured from the script's loader chain (with `--import tsx`: `.js -> .ts,.tsx,.js`, extensionless, `index`, `tsconfig: 'auto'`; without it: Node's rules), `node_modules` excluded, symlinks resolved; the files of every glob from a template-literal `import()`; the `package.json` and `tsconfig.json` each resolution read (oxc-resolver returns `packageJsonPath`, `read in source code` in its `index.d.ts`; tsconfig by upward lookup); policy `inputs`. Every non-literal `import()` marks the closure incomplete with its location. The closure of each `--import` preload goes into the environment hash, like `setupFiles`.
2. **`affected`**: on a content edit, re-parse that file (< 0.1 ms) and update its edges; on an add, delete, `package.json` or `tsconfig.json` change, clear the resolver and re-resolve every closure from cached parses (33 ms at 1,000 modules). Then look each changed path up in a reverse index: direct = the path's one-hop importers and the path itself if it is a test file; transitive = the rest of the closure index.
3. **Observed check**: install a `module.registerHooks` recorder as the first `--import` of every run, write (parent, url) edges per process, and compute each test file's observed closure by reachability. Any observed path outside the static closure is stored with its hash, the result is `complete: false`, and inheritance requires the stored hash to match. Do not use `module.register`, V8 coverage or `test:coverage` for this.
4. **Fresh worktree**: everything in 1 and 2 is computed from files on disk, so a cold build (47 ms here) gives every key before any run.
5. **Cost**: graph work stays under 50 ms at 1,000 modules; the run dominates (8 to 9 s for 201 files, a process each; 1.2 s under isolation none).

**First fixture tests** of the board row should assert, on a reference-shaped fixture, on Node 22 and 24: (a) `closure()` of the edge-case test file contains each specifier form above and equals the recorder's observed closure; (b) `import type` targets and the preload's closure are absent from the test closure, and the preload's closure is in `environment().files`; (c) a computed `import(p)` makes the closure incomplete, and after a run the loaded path is recorded and blocks inheritance when its content changes; (d) after deleting a low module, replacing a file by a directory `index`, editing a workspace `exports` or adding a tsconfig `paths` entry, `closure()` equals a fresh build's; (e) `affected()` of a leaf splits direct and transitive as the index says; (f) a cost assertion relative to the cold build, as 001 did (`structural-cost.test.ts`).

## Open questions

- tsx's precedence when `x.js` and `x.ts` coexist depends on the importer (Q1). Is per-importer `extensionAlias` worth it, or does the adapter report such pairs as an unsupported layout? Only the two cases probed are known.
- How should the adapter detect the loader chain from `--import` flags (tsx, `ts-node/esm`, native stripping, a custom loader)? Topic `node-test-runner-api` Q4 reads the flags; this topic only shows the resolver must follow them.
- The recorder must run in every test process. Through `--import` in Squeal's own command line it does; a test that spawns `node` itself is not covered unless `NODE_OPTIONS` carries it, which also reaches unrelated processes. Not probed.
- Memory and time of the reverse closure index at 10,000 modules (112,360 entries at 903) were not measured; the reverse BFS avoids it.
- Does Node's `ownerDependencies.get(file)` in `files_watcher.js` change which files `--watch` re-runs? Read, not run.
- Whether a `tsconfig.json` belongs in the closure of the files under it or in the environment hash: it changes resolution (Q4) and tsx's transform (`jsx`, `target`). Not decided here.

## Sources

- Node.js source at tags `v24.21.0` (955266bfdd854cd280dffd47548673914484e4c0) and `v22.23.3` (80dc632040e6bada37aac1220dde9c79581c9c22), https://github.com/nodejs/node: `lib/internal/test_runner/runner.js`, `lib/internal/watch_mode/files_watcher.js`, `lib/internal/modules/esm/loader.js`, `lib/internal/modules/esm/resolve.js`, `lib/internal/modules/cjs/loader.js`.
- Jest 30.5.2 from npm (`npm pack`): `jest-haste-map@30.5.1` `build/index.js`, `jest-resolve-dependencies@30.5.2` `build/index.js`, `@jest/core@30.5.2` `build/index.js`.
- pytest-testmon, https://github.com/tarpas/pytest-testmon at tag v2.2.0 (dccc58d2ed8edec98096ff1974acb7c07d3e3482): `testmon/testmon_core.py`, `testmon/db.py`, `testmon/pytest_testmon.py`.
- Package docs and typings as installed in the probe: `es-module-lexer/README.md` (3.0.3), `oxc-resolver/index.d.ts` (11.24.2), `enhanced-resolve/lib/ResolverFactory.js` (5.26.0), `typescript@7.0.2` `package.json` exports.
- Spec 001 D3 to D5: `../../001-core-loop/spec.md`; `../../001-core-loop/research/vitest-internals.md`; `src/core/types/runner.ts`; `../status.md`.
- Probes and run output: `probes/node-test-module-graph/` and its `results/`.
