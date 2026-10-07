# 003 wave 1 briefs

Three rows in parallel, on disjoint files under `src/runners/node-test/`, with 002 wave 1. Read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/003-node-test-runner/spec.md` (as amended 2026-10-07: enhanced-resolve, acorn, runtime `.mjs`) and `status.md` first. None of these rows wires the adapter: `createNodeTestAdapter` stays the stub until 003-16. Dependencies go in `dependencies` with `npm install --save`; the coordinator merges lockfiles. The plugin is an esbuild bundle with no `node_modules`, so nothing native: anything you add must bundle (check with `esbuild` into a temp directory using `bundleOptions` from `src/harness/claude-code/build.ts`; never into `plugins/`). Do not run `npm run build`.

## 003-12 graph builder, closure and affected

Outcome: the static closure of every node:test file, its reverse index and `affected`, from files alone.

Read: spec 003 D3, D4, goal 6; `research/node-test-module-graph.md` (Q1, Q3 to Q5, Recommendation); `research/probes/node-test-module-graph/static-graph.mjs` (the `enhanced` resolver and the `require` scan); `test/fixtures/node-test/` (003-11) and `gen-big.mjs`.

Shape: slice. Test first.

Seam: `src/runners/node-test/graph/resolver.ts`. First edit: one enhanced-resolve resolver per `(tsconfig, import|require)`, configured from the loader chain read out of the project's `argv` (tsx or `tsx/esm`: `extensionAlias` `.js -> .ts,.tsx,.js` and twins, extensionless, `index`, the importer's `tsconfig` by upward lookup; native stripping: explicit extensions, `.ts` allowed; unknown loader: Node's rules plus one note), a `CachedInputFileSystem`, and the read `package.json`/`tsconfig.json` and absent candidates recorded per resolution. Then `parse.ts` (es-module-lexer, `typeOnly` dropped, literal `require`, globs from template-literal `import()`, `specifier: null` marks incomplete), `graph.ts` (build, closure per test file within the worktree, preload closures apart, reverse index, `affected` split direct and transitive), `invalidate` (content edit re-parses one file; add, delete, `package.json` or `tsconfig.json` clears the resolver and re-resolves everything from cached parses). Export one `createNodeTestGraph(options)` from `src/runners/node-test/graph/index.ts`.

Owns: `src/runners/node-test/graph/**`, `test/runners/node-test/graph*.test.ts`, the two dependencies in `package.json` and the lockfile. Leave alone: `src/runners/node-test/adapter.ts`, `run/`, `runtime/`, `identity.ts`, `enumerate.ts`, `test/fixtures/**` (ask the coordinator if a fixture needs a change), everything else.

Done when: the spec's graph tests (a) to (f) on Node 22 and 24 (nvm is installed), with (a)'s observed closure taken from a run of the fixture under a `module.registerHooks` recorder kept in the test; cold build under 300 ms at 1,000 modules, re-resolve no slower, a plain edit under five percent of the cold build (asserted as ratios, as `structural-cost.test.ts` does); a `.js`/`.ts` pair under tsx yields one note naming the pair; the CLI bundles with both dependencies inlined; lint, typecheck, full suite green.

Use /worker.

## 003-13 run, reporter, recorder, identity and deadline

Outcome: one function runs a tier of node:test files under the project's own Node and returns a `RunReport` plus each file's observed closure.

Read: spec 003 D2, D5; `research/node-test-runner-api.md` (all, and `probes/node-test-runner-api/evidence.md`); `research/node-test-module-graph.md` Q2; `src/core/types/runner.ts`, `src/core/types/check.ts`; `src/runners/vitest/results.ts` for the duplicate suffix format (`name (line N)`, then `name (line N, k)`); `test/fixtures/node-test/edge/` and its README.

Shape: slice. Test first.

Seam: `src/runners/node-test/runtime/reporter.mjs`, dependency-free: every `TestsStream` event as one NDJSON line with non-enumerable error fields serialized (the fixture `reporter.mjs` shows how). Then `runtime/recorder.mjs` (a `module.registerHooks` resolve hook appending `(parent, url)` per process to a file named by an environment variable), `runtime.ts` (locates both: from a bundled CLI at `<plugin>/dist/cli/`, `../node-test/`; from source, `runtime/`), `identity.ts` (full names joined with ` > `, from `nesting` and declaration order on Node 22 and `parentId` on Node 24; skip and todo directives; the duplicate suffix from source-mapped lines), and `run/run.ts`: `runNodeTest({ root, project, files, logDir, timeoutMs, concurrency, env })` spawning `<node> --enable-source-maps --import <recorder> <argv...> --test --test-reporter=<reporter> --test-reporter-destination=<logDir>/events.ndjson --test-concurrency=<n> <files...>` in its own process group from the project's `cwd`, stdout and stderr to `logDir`, Squeal's deadline (SIGTERM to the group, SIGKILL 2 s later, `timed-out`), completion by the file wrapper's `test:complete` at nesting 0, `FileLevelError` text from that file's `test:stderr`, `crashed` when no wrapper completed, observed paths per test file by reachability with preloads apart.

Owns: `src/runners/node-test/run/**`, `src/runners/node-test/runtime/**`, `src/runners/node-test/runtime.ts`, `src/runners/node-test/identity.ts`, `test/runners/node-test/run*.test.ts`, `test/runners/node-test/identity.test.ts`, recorded event streams under `test/fixtures/node-test/streams/`. Leave alone: `graph/`, `enumerate.ts`, `adapter.ts`, the rest of `test/fixtures/node-test/`, everything else.

Done when: tests on recorded streams from Node 22 and 24 and on live runs map skip, todo, nesting and duplicates; a syntax error and a missing import each become one `FileLevelError` with the stderr text; a busy loop is killed at the deadline and the pass file beside it keeps its result; a process killed before any wrapper is `crashed`; markers prove `argv`, `cwd`, `env` and the preload reach the child; the observed closure of the reference fixture separates the preload; identity is stable across two runs; lint, typecheck, full suite green.

Use /worker.

## 003-14 static enumeration

Outcome: `enumerate(testFile)` lists a file's checks before it has ever run, in the same names a run produces.

Read: spec 003 D2, D6; `research/node-test-runner-api.md` Q3; `src/core/types/runner.ts` (`EnumeratedCheck`); `src/runners/vitest/results.ts` for the suffix format; `test/fixtures/node-test/edge/` and `reference/`.

Shape: slice. Test first.

Seam: `src/runners/node-test/enumerate.ts`. First edit: `module.stripTypeScriptTypes` on the file's source (mode `strip`), then acorn (`ecmaVersion: "latest"`, `sourceType: "module"`, locations on); walk calls to `test`, `it`, `describe`, `suite` and `t.test`/`s.test` on the callback's first parameter, with `.skip`, `.todo`, `.only` and the `{ skip, todo }` options, a string or no-substitution template first argument; names joined with ` > ` from the call nesting; duplicates suffixed `name (line N)`, then `name (line N, k)`, with a local helper that 003-16 replaces by `identity.ts`; a non-literal name is one `templated` entry; a file that does not strip enumerates nothing.

Owns: `src/runners/node-test/enumerate.ts`, `test/runners/node-test/enumerate.test.ts`, the `acorn` dependency in `package.json` and the lockfile. Leave alone: everything else under `src/runners/node-test/` and the fixtures.

Done when: enumeration of the reference and edge fixtures equals the names a run produces for literal calls, the expected names derived from a recorded event stream in the test by the D2 rule; `duplicate.test.ts` yields the four suffixed names with original lines; a loop-built name is one `templated` entry; a file with an `enum` enumerates nothing; enumeration of 200 generated test files under 200 ms; lint, typecheck, full suite green.

Use /worker.
