# Review: wave 1, 003-12 to 003-14 (task 003-15)

Reviewer task 003-15 for spec 003, 2026-10-07. Range: the 003 commits of `68aeb58..f9b55f4`. That covers `1516ea2`, `548ac74` (003-14), `197f420`, `f05c753`, `19d4ecb`, `c254276` (003-12), `d235cdd`, `4b5355f`, `63823a0` (003-13), and `6b09ae9` (D2/D5 amendment, `RunReport.failure` comment). It also covers the 0.1.16 rebuild `7a56a92` as far as it ships `dist/node-test/`. The files are `src/runners/node-test/`, `test/runners/node-test/`, `test/fixtures/node-test/streams/`, the `RunReport` comment in `src/core/types/runner.ts` and the three dependencies in `package.json`. The 002 commits in the range belong to 002-14. I read the range against spec D2 to D6 and goal 6, both as amended, and against the three briefs in `tasks/wave-1.md`.

Nothing in `src/` outside `src/runners/node-test/` imports the graph, `runNodeTest` or `enumerate`. The adapter is still the stub, so no finding below is user-visible in 0.1.16. Each one is about what 003-16 will wire.

## Verdict

**PASS at `626b616`.** Counts: 0 blockers, 3 should-fix, 7 nits.

- **Can a stale or incomplete closure pose as current?** Yes, in three layouts outside the fixtures. All three are proven below, and each yields a static closure that says `complete: true` while missing a file tsx loads:
  - tsconfig `paths` inherited through `extends` (S1);
  - an `exports` target picked by the `require` condition in a CommonJS-typed package (S2);
  - a preload named by a bare specifier that resolves into the worktree (S3).

  The D3/D5 observed-path net catches S1 and S2 after the first run, if 003-16 wires `recordObserved` and stores observed hashes. Nothing catches S3, because the observed closure files those paths under `preloadPaths` and the graph's `preloads()` is empty. Other cases are fine:
  - the `.js`/`.ts` pair note;
  - `extends` targets entering the closure as reads;
  - `tsconfig.*.json` and read files counting as structural in `invalidate`;
  - symlinked workspaces resolving to real paths.
- **Can a run report a pass it did not see?** I found no way:
  - Completion needs an exited process plus the wrapper's `test:complete` plus the final `test:summary`.
  - The deadline kills the whole group. Probe: no `busy-loop` process left after a timed-out run.
  - A failed wrapper with no failing check is a `FileLevelError`.
  - A parent's own hook failure wins over `subtestsFailed` on Node 22 and 24. Probe: `failureType` `hookFailed` on the parent.
  - Duplicate suffixes agree between enumeration and a run.
- **Does it bundle?** Yes. I bundled the graph, `enumerate` and `runNodeTest` with the shipped `bundleOptions` into `/tmp/.../dist/cli/`, with the runtime copied to `dist/node-test/` and no `node_modules` anywhere above. On Node 22.23.3 and 24.21.0 the bundle:
  - built the reference fixture's closures and preload closure;
  - enumerated `math.test.ts`;
  - ran both unit files to `completed`, with the preload's observed paths kept apart.

  Both shipped plugins carry `dist/node-test/{reporter,recorder}.mjs`.

## Verification

HEAD is `626b616`, one commit past the range's end `f9b55f4`. It changes only docs (`docs/board.md`, both specs' `status.md` and `tasks/wave-1.md`; `git diff --stat f9b55f4 626b616`). I ran everything at `626b616`.

```
$ git rev-parse HEAD
626b61684ec6863147c7f38bf1a866a64da0625d
$ npm ci
added 56 packages, and audited 57 packages in 1s ... found 0 vulnerabilities (install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 453 files in 129ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin
tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts   (exit 0)
$ git status --porcelain
(empty: the committed dist matches the build)
$ npx vitest run            (Node 24.21.0, host load average 30 on 24 cores)
 Test Files  2 failed | 155 passed (157)
      Tests  2 failed | 1320 passed | 7 skipped (1329)
 FAIL test/daemon/lifecycle.test.ts > ... exits after the idle period ...   daemon ready not met in 60000 ms
 FAIL test/harness/codex/plugin.test.ts > committed Codex plugin > has the bundles ...   Test timed out in 5000ms
$ npx vitest run test/harness/codex/plugin.test.ts test/daemon/lifecycle.test.ts
 Test Files  2 passed (2)
      Tests  24 passed (24)
$ npx vitest run test/runners/node-test test/fixtures/node-test            (Node 24.21.0)
 Test Files  10 passed (10)
      Tests  79 passed (79)
$ PATH=~/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/runners/node-test test/fixtures/node-test
 Test Files  10 passed (10)
      Tests  79 passed (79)
$ npx vitest run test/runners/node-test/graph-cost.test.ts --silent=false   (load 13 to 15)
 Node 24.21.0: cold 144.61 ms (min), median 151.38 ms, edit 0.27 ms
 Node 22.23.3: cold 159.14 ms (min), median 170.62 ms, edit 0.39 ms
```

The two full-suite failures are outside this range: a 001 daemon lifecycle test and a 002 Codex bundle test. Both timed out under load and pass in isolation, so this review counts them against nothing. CI's matrix is Node 22 and 24 (`.github/workflows`).

## Blockers

None.

## Should-fix

### S1. tsconfig `paths` from an `extends` base resolve against the wrong directory (proven)

`src/runners/node-test/graph/resolver.ts:106` passes the importer's `tsconfig.json` to enhanced-resolve as `{ configFile }`. When `paths` live in an extended base, enhanced-resolve resolves them relative to the extending file's directory. TypeScript and tsx resolve them relative to the file that defines them, when no `baseUrl` is set.

Probe (`/tmp`, deleted):
- `tsconfig.base.json` at the root has `"paths": { "~/*": ["./packages/app/src/*"] }`.
- `packages/app/tsconfig.json` extends it.
- `packages/app/test/a.test.ts` imports `~/x`.

Results:
- **Run:** tsx loads `packages/app/src/x.ts`, and the test passes.
- **Static closure:** it lacks `packages/app/src/x.ts`. Instead it holds absent candidates `packages/app/packages/app/src/x.{ts,tsx,js,...}` and says `complete: true, incomplete: []`.
- **Before a run:** `affected(["packages/app/src/x.ts"])` is `{ direct: [], transitive: [] }`.
- **What works:** `tsconfig.base.json` is in the closure as a read, so an edit to it re-resolves.

Monorepos with a root `tsconfig.base.json` are the common shape. D3 says the closure equals the observed one for this resolver configuration, and here it does not.

Fix (one worker, 003-12's files):
1. Add an `extends` case to `test/fixtures/node-test/edge/` (coordinator approval, the fixture is 003-11's).
2. In `resolver.ts`, read the `extends` chain and rebase each `paths` entry onto the directory of the file that defines it. Hand the result to enhanced-resolve as an explicit `baseUrl` and `paths`, or as `alias`.
3. Assert the closure equals the recorder's observed closure, as graph test (a) does.

### S2. `exports` conditions: an `import` in a CommonJS-typed package loads the `require` target under tsx (proven; spec gap)

D3 fixes the conditions at `node` and `import`, plus `require` for require edges. The resolver does that (`resolver.ts:100`). tsx compiles a `.ts` file in a package without `"type": "module"` to CommonJS, so its `import` resolves with the `require` condition.

Probe:
- `packages/app/package.json` has no `type`.
- `@w/dual` has `exports: { ".": { import: "./src/esm.mjs", require: "./src/cjs.cjs" } }`.

Results:
- **Run:** loaded `packages/dual/src/cjs.cjs`.
- **Static closure:** holds `esm.mjs`, lacks `cjs.cjs`, and says `complete: true`.
- **Before a run:** `affected(["packages/dual/src/cjs.cjs"])` is empty.

The reference fixture and the research's 200-file fixture are all `"type": "module"`, which is why research saw 200 of 201.

Fix: first a coordinator amendment to D3. Under tsx, an edge from a module tsx treats as CommonJS resolves with the `require` conditions:
- `.cts`/`.cjs`;
- `.ts`/`.js` whose nearest `package.json` has no `"type": "module"`.

A cheaper over-approximation is to resolve with both condition sets and keep both targets. Then one worker in `resolver.ts`/`modules.ts` adds a CommonJS-typed package to the edge fixture.

### S3. A bare-specifier preload that resolves into the worktree is dropped from `preloads()` (proven)

`src/runners/node-test/graph/loader-chain.ts:62-63` treats every `--import`/`--require` value that is not `tsx`/`tsx/esm` and not written as a path as an unrecognized loader. It gets one note and is never resolved.

D1 puts "the closure of every `--import` and `--require` preload, resolved from `cwd` through D3's graph" in the environment hash.

Probe:
- `argv` `["--import", "@w/setup", "--import", "tsx"]`, with `node_modules/@w/setup -> ../../packages/setup`.
- `packages/setup/index.mjs` imports `./helper.mjs`.

Results:
- **Graph:** `preloads()` is `{ paths: [] }`, and the note reads `unrecognized loader "@w/setup"`.
- **Run:** the observed closure files `packages/setup/index.mjs` and `helper.mjs` under `preloadPaths`, not under the test's `paths`.
- **Effect:** `affected(["packages/setup/helper.mjs"])` is empty. If 003-16 builds the environment hash from `preloads()` and calls `recordObserved` with `observed.paths`, an edit to the shared test setup changes no key and schedules nothing. Every pass of the project would then stay current while the preload it ran under changed.

This is the one finding where a stale result would pose as current. It is not blocking only because nothing calls the graph yet. It must land before or with 003-16.

Fix (one worker, `loader-chain.ts` and `graph.ts`):
1. Resolve every non-tsx preload value from `cwd`, bare ones included.
2. Treat a value that resolves to a real path inside the worktree as a preload root. Keep a note when it may register hooks.
3. Treat a value that resolves into `node_modules` as covered by the installed-dependency fingerprint.
4. Add a test with a workspace-package preload.

## Nits

- **N1. Skipped suites enumerate children a run never reports (proven).** `enumerate.ts:184` descends into every suite callback. On Node 22 and 24, `describe.skip("s", ...)` and `describe("s", { skip: true }, ...)` report only the suite (`test:pass`, `skip=true`). Enumeration lists `s > inner` anyway. `describe.todo` does report its children, as todo. Today nothing in `src/core` calls `enumerate`, so nothing is affected yet. Fix: do not descend into a suite with `.skip` or a `skip` option.
- **N2. A function-only first argument becomes a templated entry named by its source text (proven).** For `test(async function onlyFn() {})`, enumeration gives the templated entry `async function onlyFn() {}`, but the run names it `onlyFn`. An anonymous arrow would come out as its source rather than `<anonymous>`. See `enumerate.ts:168`. Use the function's name, or `<anonymous>`.
- **N3. Absent `node_modules` directories enter closures as candidates (proven).** The S1 probe's closure holds `packages/app/node_modules`, `packages/app/test/node_modules` and `packages/node_modules`. `inWorktree` (`resolver.ts:116`) only filters paths containing `/node_modules/` with a trailing separator. Effect: a workspace `npm install` that creates one of them re-keys every file whose closure probed it. Filter a path whose last segment is `node_modules` too.
- **N4. node-test imports the Vitest adapter's internals.** `run/run.ts:12`, `run/report.ts:8`, `run/errors.ts:3` and `run/observed.ts:5` import `WorktreePaths` from `../../vitest/paths.js`. That is one runner depending on another. Move `WorktreePaths` under `src/core/fs/` when 003-16 touches it.
- **N5. The deadline test does not prove the group is gone.** `test/runners/node-test/run.test.ts:83` asserts `timed-out` and the kept file, but no process check. My probe found no `busy-loop` process after a timed-out run, so the code is right. Assert it, for example with `process.kill(-pid, 0)` throwing `ESRCH` on the logged pids.
- **N6. A non-literal `require(x)` leaves the closure complete.** `parse.ts` marks only a computed `import()` incomplete; a computed `require(x)` silently does nothing. D3 names only `import()`, so this conforms. It is the same gap, and the observed net covers it after a run.
- **N7. Open question 5 (reverse index memory at 10,000 modules) was not measured.** The spec says "Measure in wave 1"; the bitset design makes it small. My estimate, unverified: 4 B × modules × ⌈tests/32⌉ for the reverse index, plus the same order for closures. At 10,000 modules and 2,000 test files that is about 2.5 MB each. Record a measurement in `status.md` or close the question there.

## What fits

These need no re-check in the next wave.

**Graph**
- **Closure index:** an iterative Tarjan over modules, with each component's closure the union of its own reads and candidates and its successors' closures. That is correct by construction, since Tarjan emits successors first. The reverse index is a transposed bitset.
- **Cost at calm load:** 145 ms (24) and 159 ms (22) min cold at 1,000 modules, 0.3 to 0.4 ms per plain edit. Goal 6 holds.
- **`invalidate`:** an add, a delete, `package.json`, any `tsconfig*.json`, or a "change" to a path some closure read or probed clears the resolver and re-resolves from cached parses. A content edit re-parses one file and rebuilds the index only when edges changed. `extends` targets are recorded as reads (S1 probe: `tsconfig.base.json` is in the closure).
- **Preloads:** relative preloads resolve from `cwd`, and their closure stays out of every test's closure. On the reference fixture, the static `preloads()` equals the observed `preloadPaths` plus the manifests.

**Run**
- **Process per file:** one `node --test` process per file, each in its own group. A leader's exit SIGKILLs what is left of its group. The deadline sends SIGTERM to every running group, then SIGKILL 2 s later, and never starts the files still queued.
- **Completion:** a file completes only with an exited process, the wrapper's `test:complete` and the final `test:summary`. The `ordering` stream justifies this.
- **Wrapper matching:** the wrapper matches by name, `nesting` 0 and no `entryFile`. Node 24's per-process `testId` collision between the wrapper and the first inner test is harmless, because the wrapper is filtered out before `parentsById`.
- **Outcomes:** skip and todo directives map to `skip`. `subtestsFailed` alone maps to `pass`, while `hookFailed`, `testCodeFailure` and `cancelledByParent` fail, and the cancelled test carries the hook's error. A failed wrapper with no failing check is a `FileLevelError` from the file's stderr.
- **Environment:** `NODE_TEST_CONTEXT` is removed from the child's environment.

**Identity**
- **Suffix agreement:** suffixes agree between `enumerate` (pre-order) and a run (report order, post-order on Node 22). Two checks with the same full name sit at the same depth, and neither can be the other's descendant, so both orders keep them in declaration order.

**Bundling**
- **CLI bundle:** graph, enumeration and run bundle with the shipped options. They run from `dist/cli/` with no `node_modules` on Node 22 and 24 and find the runtime at `dist/node-test/`.

## Inputs for the next wave (003-16)

### API shapes and call order

- `const graph = await createNodeTestGraph({ root, cwd, argv, testFiles })`. It awaits the lexer's WebAssembly.
- **Per batch of watcher paths:** call `graph.invalidate(paths)` first, then `graph.affected(changed)`. An added file appears in the index only after `invalidate`.
- **`closure(testFile)`** throws for a file not listed. After `testFiles()` changes, call `setTestFiles` before asking.
- **`runNodeTest({ root, project, files, logDir, timeoutMs, concurrency, env })`** returns `{ report, observed }`.
  - Pass `concurrency` as `runner.tierSize`.
  - Pass `env` with `TMPDIR` as 001 D10 sets it. `runNodeTest` does not set it.
  - `observed` omits a completed file when the recorder saw nothing (a Node before 22.15). Treat that as unobserved, not as an empty observation.
- **Log files are indexed per call:** `events-<i>`, `graph-<i>-<pid>`, `stdout-<i>`, `stderr-<i>`, `run.json`. Two node:test projects in one tier must not share a `logDir`, so give each `runNodeTest` call a subdirectory, for example `<logDir>/<project>`.

### Observed paths and the store

- **Recording:** after each run, `recordObserved(file, observed.paths minus closure(file).paths)`. The graph does not do the subtraction.
- **Storing:** D3 also needs the observed paths stored on the result with their hashes, and a lookup that is current only when they match. The store has no field for this yet. 003-16 owns that change, and the inheritance test must use an S1- or S2-shaped miss to prove it.
- **Preload paths:** `observed.preloadPaths` must reach the environment hash, or at least be compared with `graph.preloads().paths`, until S3 lands.

### Before or with 003-16

- **Enumeration:**
  - Replace `enumerate.ts`'s local `suffixDuplicates` with `identity.ts`'s.
  - `stripTypeScriptTypes` prints one `ExperimentalWarning` per process on Node 22 and 24 (seen in the bundle probe), which would land on the daemon's stderr. Filter it the way 002-13 did for the Codex hooks (`--disable-warning=ExperimentalWarning` on the daemon's command), or suppress it around the call.
- **Cost under load:**
  - This review measured 145 to 171 ms cold at load 13 to 25. `status.md` records 170 to 379 ms at load 50 to 78.
  - Build the graph off the hook path, at daemon start. The first `affected` after a start waits for it.
  - The re-resolve after an add costs about one cold build minus the parse.
- **Fix order:** S1 to S3 are small and independent. S3 must land with or before the environment hash.
