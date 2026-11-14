# Vitest loaded-modules probe: results

Vitest 5.0.3, Vite 8.3.2, Node v26.13.0, Squeal commit 2856d26e8, 2026-11-14. Raw data: `results.json`.
Fixtures lived under `$TMPDIR/lm-vitest`; scripts and re-run steps in `README.md`.

"Loaded set" below = files of the nodes in `__vitest_worker__.evaluatedModules.idToModuleMap` with
`evaluated: true` at the test file's end (setup-file `afterAll` recorder), minus builtins (`fs`, `path`) and
Vitest's own `vitest/dist/index.js`, which every set holds. "Import graph" = static and dynamic imports,
literal `require`, glob patterns, judged by reading the fixture. Squeal's extra closure inputs (setup and
config closure, observed reads, declared inputs) are named where they would apply; not run here.

## A. Soundness

Every row: run 1 passed (except 12), one edit, run 2. All verified by experiment.

| Case | Edit | Run 1 → run 2 | Edited path in run-1 loaded set? | In import graph? | Notes |
|---|---|---|---|---|---|
| 1a resolve dir then file | add `util.ts` beside `util/index.ts` (`import "./util"`) | pass → fail | no (did not exist) | no (graph held `util/index.ts`) | Vite resolves the file before the directory |
| 1b extension priority | add `util.js` beside loaded `util.ts` | pass → fail | no | no | `.js` precedes `.ts` in Vite's resolve order |
| 1c glob gains a file | add `plugins/b.ts` under `import.meta.glob("./plugins/*.ts")` | pass → fail | no | the pattern yes, the new file no | only a closure that keeps the glob pattern catches it |
| 1d new `__mocks__` file | add `__mocks__/dep.ts` beside automocked `dep.ts` | pass → fail | no | no | Vitest's manual-mock lookup, not an import |
| 2a `vi.mock` with factory | `dep.ts` changes value and throws at top level | pass → pass | no (node present, `evaluated: false`) | yes | result cannot change: the original never runs |
| 2b factory with `importOriginal` | `dep.ts` value | pass → fail | yes | yes | |
| 2c automock `vi.mock("./dep")` | `dep.ts` primitive export | pass → fail | yes, under id `mock:<abs>/dep.ts` (file = `dep.ts`); the plain `dep.ts` node is `evaluated: false` | yes | the original IS evaluated to build the automock; a recorder must count `mock:` nodes by their `file` |
| 3a `fs.readFileSync` of JSON | `data.json` | pass → fail | no | no | Squeal's observed reads may cover it (not checked) |
| 3b `?raw` import | `a.txt` | pass → fail | yes (id `a.txt?raw`, file `a.txt`) | yes | |
| 3c JSON import | `data.json` | pass → fail | yes | yes | contrast to 3a |
| 4a `test.env` in config | `vitest.config.ts` | pass → fail | no | no | config closure |
| 4b `.env` file → `import.meta.env.VITE_FOO` | `.env` | pass → fail | no | no | Vitest loads `.env` files; no module |
| 4c shell environment | `LM_X=1` → `LM_X=2`, no file | pass → fail | n/a | n/a | no file edit at all |
| 5 child process | `lib.mjs` imported by `node child.mjs` | pass → fail | no (`child_process` builtin only) | no | other process |
| 6a setup file's import | `setup-helper.ts` imported by `setupFiles` entry | pass → fail | yes; `setup.ts` and `setup-helper.ts` are in every file's set | no (setup closure yes) | setup files run in each test file's module runner |
| 6b config `define` | `vitest.config.ts` | pass → fail | no | no | config closure |
| 6c config `globals` | `vitest.config.ts` `globals: true → false` | pass → fail (`test is not defined`) | no | no | config closure |
| 6d `globalSetup` `provide` → `inject` | `gs-helper.ts` imported by the global setup | pass → fail | no | no | main process; config closure only if it follows globalSetup imports |
| 7a untaken dynamic import | `heavy.ts` changes value and throws | pass → pass | no | yes | result cannot change |
| 7b flip the branch | `flag.ts` `false → true` | pass → fail | yes | yes | the set catches it |
| 8a `import type` | `types.ts` gains a top-level `throw` | pass → pass | no | elided in the transform | not evaluated |
| 8b `import { T }` of an interface, no `type` keyword | same | pass → pass | no | elided | oxc drops imports used only as types |
| 8c `export type { T }` re-export | same | pass → pass | no | elided | |
| 8d `export { T }` re-export of an interface | same | pass → fail (`boom`) | yes | yes | an isolated transform keeps it, so `types.ts` runs |
| 9 snapshot file | `__snapshots__/a.test.ts.snap` | pass → fail | no | no | read by snapshot state through `fs` |
| 10a package in `node_modules` | `node_modules/fakepkg/inner.js` (imported by its `index.js`) | pass → fail | no; `fakepkg/index.js` is in the set as an externalized node, `inner.js` is not | n/a | Node's loader loads `inner.js`; the runner sees only the entry |
| 10b `file:`-style symlinked package | `linkpkg-src/inner.js` | pass → fail | yes (`index.js` and `inner.js` by real path) | yes | real path is outside `node_modules`, so it is inlined |
| 11a `createRequire` of `.cjs` | `c2.cjs` required by `c.cjs` | pass → fail | no (neither file) | no | Node's CJS loader |
| 11b plain `require("./c.cjs")` in an ESM test | `c2.cjs` | pass → fail | no (neither `c.cjs` nor `c2.cjs`) | `c.cjs` yes (literal require) | the runner's `require` is Node's |
| 11c `import c from "./c.cjs"` | `c2.cjs` (required inside `c.cjs`) | pass → fail | `c.cjs` yes, `c2.cjs` no | `c.cjs` yes | the inner `require` is Node's |
| 11d `tsconfig.json` | `useDefineForClassFields: false → true` | pass → fail | no | no | transform input |
| 11e `package.json` `imports` (`#u`) | retarget `#u` from `u1.ts` to `u2.ts` | pass → fail | no (neither `package.json` nor `u2.ts`) | no | resolution input |
| 11f `worker_threads` Worker | `wlib.mjs` imported by the worker script | pass → fail | no | no | other module loader |
| 12 load failure in run 1 | fix `b.ts` that threw at load | fail → pass | setup `afterAll` recorder: no record at all; runner recorder (`onAfterRunFiles`): `a.test.ts`, `a.ts`, `b.ts` all `evaluated: true` | yes | record from the runner, not a setup file |
| 13 `vi.resetModules()` in `afterEach` | `dep.ts` | pass → fail | evaluated-flag set: no (it is EMPTY, even the test file); node presence: yes | yes | `resetModules` sets `evaluated = false` on every node and keeps them |

Kinds that change a result with no edit to a loaded module (all verified): new files a resolution, glob or
`__mocks__` lookup finds (1a to 1d); files read by `fs` (3a, 9); environment from config, `.env` and shell
(4a to 4c); child processes and worker threads (5, 11f); config, `define`, `globals`, `globalSetup`
(4a, 6b to 6d); `tsconfig.json` and `package.json` as transform and resolution inputs (11d, 11e);
anything Node's own loader loads: packages' inner files, `require`, `createRequire` (10a, 11a to 11c).
Edits that cannot change the result and the set skips correctly: factory-mocked module (2a), untaken
dynamic import (7a), type-only modules (8a to 8c).

## B. Recording

### What `evaluatedModules` holds (verified by experiment)

- One node per module id the module runner fetched: project files (inlined), `mock:<path>` nodes for
  mocked modules, query ids (`a.txt?raw`), builtins (`fs`, `node:child_process`, type `builtin`) and
  externalized entries (`vitest/dist/index.js`, `node_modules/fakepkg/index.js`, with `meta.externalize`).
- Externalized modules appear only as the entry the runner handed to Node; what Node's loader loads from
  there (`fakepkg/inner.js`, `require`d `.cjs`) does not appear (cases 10a, 11a to 11c).
- A node can be present and never evaluated: a factory-mocked module (2a). A node can be evaluated and
  then reset to `evaluated: false` by `vi.resetModules()` (13). Read in source code:
  `vitest/dist/chunks/utils.DYj33du9.js:27-41` (`resetModules` sets `promise`, `exports` undefined,
  `evaluated = false`, clears `importers`, keeps the node; skips `/vitest/dist/` and, unless resetting
  mocks, `mock:` ids); `vitest/dist/chunks/index.C4tKZ0yW.js:7446-7447` (`vi.resetModules` calls it).
  So the flag alone undercounts; presence overcounts only by never-evaluated nodes like 2a's.
- With `experimental.viteModuleRunner: false` the map is empty (verified, `native-mode.mjs`); read in
  source code: `vitest/dist/chunks/base.DhkQeZwd.js:117` switches to `NativeModuleRunner`.
- A record from a setup file's `afterAll` is missing when the file fails to import (12). A custom runner's
  `onAfterRunFiles` runs after collection whatever its outcome: read in source code
  `vitest/dist/chunks/run.BTlFXlnv.js:4166-4170` (`collectTests` → `runFiles` → `onAfterRunFiles`);
  verified by experiment in case 12.

### Isolation (verified by experiment; `isolation.mjs`, three files: a imports shared + onlyA, b imports shared, c imports nothing; `maxWorkers: 1`)

| Pool | isolate | Same worker? | a's set | b's set | c's set |
|---|---|---|---|---|---|
| forks | true | new process per file | a, onlyA, shared | b, shared | c |
| threads | true | same pid | a, onlyA, shared | b, shared | c |
| forks | false | one process | a, onlyA, shared | **a, b, onlyA, shared** | **a, b, c, onlyA, shared** |
| threads | false (also with `fileParallelism: false`) | one thread | same as forks false | same | same |
| vmThreads | n/a | same pid | a, onlyA, shared | b, shared | c |
| vmForks | n/a | same pid | a, onlyA, shared | b, shared | c |

Both recorders (setup `afterAll` and runner) agree. With `isolate: false` sets do not undercount, they
accumulate: each file's record is the union of every file before it in that worker, because the map is
module-level per worker (read in source code: `base.DhkQeZwd.js:107` `const evaluatedModules = new
VitestEvaluatedModules()`, `:177` `state.evaluatedModules = evaluatedModules`) and only `isolate: true`
resets it per file (`base.DhkQeZwd.js:83-85`). That union is also what the file could depend on (state
leaks between files), but it depends on which files shared the worker and in what order, which can differ
next run. With `isolate: true` under the runner recorder, the runner file and its own imports show as
`evaluated: false` (reset before the file), so they drop out of a flag-based set.

### Vite's server module graph (verified by experiment; `server-graph.mjs`)

Tests ran in the `ssr` environment (`__vitest__` and `client` graphs were empty). The graph is one per
environment, not per test file: `heavy.ts` lists both `a.test.ts` (an untaken dynamic import, from the
transform's import list) and `b.test.ts` as importers; `dep.ts` (factory-mocked) is a node with no
transform. Edges are transform-time imports, so a walk from a test file gives the import closure, and
"transformed" is the union over the whole run. It cannot say which file loaded what.

### Squeal's coverage records, for comparison (read in source code at 2856d26e8)

- Worker side, `src/core/code/coverage/provider.mjs`: V8 precise coverage per worker batch; `takeCoverage`
  keeps scripts whose URL starts `file://` and does not contain `/node_modules/` (`kept`). No coverage
  under `isolate: false` (`startCoverage` returns) nor for files the daemon lists in `skip.json`.
- Main side, `src/runners/vitest/coverage.ts`: `coveredFiles` drops a batch of more than one test file;
  `executedSources` makes the "sources": each module id in the environment's server module graph that is
  a project file (`sourceOf`), equal to its file (so no `?raw` or other query ids), with a cached transform.
- `src/core/code/coverage/record.ts` `buildRecord`: a payload script with no such source is skipped
  (`if (executed === undefined) continue`). So a record's sources are project files Vite transformed that
  V8 saw run in that test file's worker: no node_modules, no files Node's loader loaded alone (`require`d
  `.cjs`), no `?raw`. Unlike the evaluated flag, V8 still lists a module after `vi.resetModules()`
  (inferred: the script stays compiled). Spec 020 D12's `children` option merges child processes'
  coverage (`mapper.ts` `withChildren`, read from disk by `ownRecord`), which `evaluatedModules` never sees.

### Cost (verified by experiment; `cost.mjs`: 300 generated modules, every test file loads all; 20 test files; `maxWorkers: 4`; recording runner writes JSON per file)

| Run | Wall ms (5 runs) | Mean | One-minute load during |
|---|---|---|---|
| without recorder | 2522, 2024, 2343, 2787, 2966 | 2528 | 10.65 to 12.89 |
| with recorder | 2288, 2368, 2402, 2338, 2031 | 2285 | 10.65 to 12.89 |

Each file's set had 303 nodes. Reading the map took 0.31 to 0.40 ms per file on average, at most 1.09 ms
(`readMs`, measured inside the worker, iteration only, not the JSON write). The wall-time difference is
inside run-to-run noise at this load; the recorder's cost is not measurable at this size.
