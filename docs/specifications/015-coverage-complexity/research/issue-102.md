# Issue 102: Vitest cannot load Squeal's coverage provider in DOM test files

Date: 2026-10-26. Issue: https://github.com/hearsay-tools/squeal/issues/102. Spec 015 D8, spec 013 (Vitest adapter). Researcher, documentation only.

Versions examined: Vitest 4.1.10 and 5.0.5, each with Vite 8.3.5, Node 24.21.0, jsdom and happy-dom latest; the provider is `plugins/codex/dist/coverage/provider.mjs` at 93e710f4e (0.1.345, same bytes as 0.1.342 for this question). Read-only: cezarion's installed Vitest 4.1.10 and Vite 8.1.4.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Reproduce | Yes, on Vitest 4.1.10 **and** 5.0.5, only in `jsdom` and `happy-dom` test files. `node` passes. Nested error: `Cannot find module '/@fs/<data>/versions/0.1.342/dist/coverage/provider.mjs'`, code `ERR_MODULE_NOT_FOUND`. | verified by experiment |
| 2 | Cause | Vite's file access rule `server.fs.allow`. A DOM test file runs in Vite's `client` environment; that environment checks that rule before it reads a file; the plugin data directory is outside the allowed directories, so Vite reads nothing and the module runner reports "Cannot find module". The `ssr` environment (`node` test files, the main process) skips the check. Not a bare import, not the module's shape, not path-vs-URL. | verified by experiment, read in source code |
| 3 | Fix options | Recommended: add the provider file to `server.fs.allow` of every Vite server of the instance after `createVitest`, beside `withoutOptimizer`. It loads the provider and collects coverage in jsdom files, root and projects configs, on 4.1.10 and 5.0.5. | verified by experiment |
| 4 | Fallback | Today the instance starts (the main process loads the provider), and each run that holds a DOM file ends `crashed`: every file of that run is unknown, node files too. No fallback exists. Cheapest fallback: recognise the provider error, keep coverage off for the adapter's life, recreate the instance and run again. The reason must name the nested cause in its first line. | read in source code, inferred |

## Q1. Reproduce

`uptime` before the first live run: `load average: 21.21, 28.74, 29.87` on 24 CPUs. The variant runs (Q2) printed `31.47` in the same command, so they ran above the limit of 24; they were five runs of a few seconds each. After that, live work stopped until the load fell to 22.52 (15:11), then the fix probe ran. Live work: 15:02 to 15:12, and one jsdom run at 15:13 (load 31.92) that rechecked `run.sh` after the probe moved beside this file; same result.

Fixture: `research/probes/issue-102/` beside this file (throwaway). `run.sh <version>` copies it to `/tmp/issue-102/v<version>/`, installs Vitest with `HOME`, `npm_config_cache` and `SQUEAL_DATA` under `/tmp/issue-102/`, and copies the provider to `$SQUEAL_DATA/versions/0.1.342/dist/coverage/provider.mjs`, outside the project. Each config sets `coverage: { enabled: true, provider: "custom", customProviderModule: <that path>, reporter: [] }`. No Squeal daemon, harness or eval ran.

```text
$ docs/specifications/015-coverage-complexity/research/probes/issue-102/run.sh 4.1.10
vitest 4.1.10 vite 8.3.5 node v24.21.0
=== node
      Coverage enabled with squeal
 Test Files  1 passed (1)
exit 0
=== jsdom
      Coverage enabled with squeal
⎯⎯⎯⎯⎯⎯⎯ Test Run Error ⎯⎯⎯⎯⎯⎯⎯
Error: Failed to load custom CoverageProviderModule from /tmp/issue-102/data/versions/0.1.342/dist/coverage/provider.mjs
 ❯ resolveCoverageProviderModule node_modules/vitest/dist/chunks/coverage.CTzCuANN.js:22:9
 ❯ startCoverageInsideWorker node_modules/vitest/dist/chunks/setup-common.DYx3LtFI.js:7:25
 ❯ run node_modules/vitest/dist/chunks/base.B6Opl8PE.js:68:23
Caused by: Error: Cannot find module '/@fs/tmp/issue-102/data/versions/0.1.342/dist/coverage/provider.mjs'
 ❯ reviveInvokeError node_modules/vite/dist/node/module-runner.js:556:14
 ❯ VitestModuleRunner.getModuleInformation node_modules/vite/dist/node/module-runner.js:1221:7
 ❯ VitestModuleRunner.import node_modules/vite/dist/node/module-runner.js:1142:23
Serialized Error: { code: 'ERR_MODULE_NOT_FOUND' }
 Test Files  no tests
     Errors  1 error
exit 1
=== happy-dom
(the same two errors)
exit 1
```

`run.sh 5.0.5` gives the same three results: `node` exit 0, `jsdom` and `happy-dom` exit 1 with the same message and cause. So the issue is not specific to Vitest 4; the title's "Vitest 4" is the reporter's version. "Coverage enabled with squeal" in every run shows that the main process loaded the provider.

Fit with the report: cezarion's failing files are all in its `web` project, `environment: 'jsdom'` (`packages/web/vitest.config.ts`). An environment retry reruns the same deterministic failure, so it could not help. Squeal's own tests run no `jsdom` or `happy-dom` file with coverage on (`git grep` finds only a docblock-environment fixture and a closure-parse test), so they never met this path.

## Q2. Cause

Variants, jsdom, provider outside the project unless named (`variants.sh`):

```text
## 4.1.10
outside exit=1 Caused by: Error: Cannot find module '/@fs/tmp/issue-102/data/.../provider.mjs'
inside-root exit=0  Test Files  1 passed (1)
file-url exit=1 Caused by: Error: Cannot find module '/@fs/tmp/issue-102/data/.../provider.mjs'
fs-allow exit=0  Test Files  1 passed (1)
fs-strict-off exit=0  Test Files  1 passed (1)
## 5.0.5
(the same five results)
```

`inside-root` copies the same file into the project. `fs-allow` sets Vite's `server.fs.allow` to the project and the provider's directory. `fs-strict-off` sets `server.fs.strict: false`.

The chain, read in source code (Vitest 4.1.10, Vite 8.3.5; the same code is in Vite 8.1.4 at `chunks/node.js:20054`):

1. Vitest's `jsdom` and `happy-dom` environments declare `viteEnvironment: "client"` (`vitest/dist/chunks/index.DC7d2Pf8.js:337,427`; 5.0.5 `index.CK-t0WMg.js:1185,1285`). `node` declares `"ssr"`.
2. In the worker, `startCoverageInsideWorker(config.coverage, moduleRunner)` calls `loader.import(options.customProviderModule)` (`coverage.CTzCuANN.js:20`). The loader is the worker's module runner, which fetches every module through its Vite environment.
3. Vitest's `shouldExternalize` inlines a file outside `node_modules` (`cli-api.BK8pd4xc.js:10499`), so Vite must load and transform it.
4. Vite's `loadAndTransform` reads the file only if `options.skipFsCheck || isFileLoadingAllowed(config, file)` (`vite/dist/node/chunks/node.js:20111`). Otherwise `code` stays `null`, and the runner reports "Cannot find module".
5. `skipFsCheck` is true only for an environment whose transport is not the WebSocket server (`node.js:37088`); the `ssr` environment's `createServerHotChannel` sets it (`node.js:25815`). The `client` environment keeps the check.
6. `isFileLoadingAllowed` passes when `server.fs.strict` is off, the file is in `safeModulePaths`, or it is under an entry of `server.fs.allow` (`node.js:18035`). Vitest sets `fs.allow` per project to the config's directory, the workspace root and Vitest's own directory (`resolveFsAllow`, `cli-api.BK8pd4xc.js:10103`). The plugin data directory is none of these.

The main process loads the provider with `this.runner`, a server module runner on the `ssr` environment (`cli-api.BK8pd4xc.js:13315`), so the instance starts. Plain `node -e 'import(...)'` uses Node's loader, which has no such rule. This explains the report's "a plain Node import worked".

The other candidates:

| Candidate | Verdict | Evidence |
|---|---|---|
| Bare imports in provider.mjs | Ruled out | Its only imports are `node:crypto`, `node:fs`, `node:inspector/promises`, `node:path`, `node:url` (lines 12–16). The same file loads in `inside-root`. Read in source code, verified by experiment. |
| File path or URL handling | Ruled out | A `file://` URL fails with the same cause (`file-url`). The `/@fs/` prefix is Vite's normal name for a file outside the root, not the error. Verified by experiment. |
| Module shape | Ruled out | `inside-root`, `fs-allow` and every `node` run load it and run coverage. Verified by experiment. |
| Vite module runner | Involved, not the cause | It reports the failure; the decision is Vite's `client` environment file rule (steps 4–6). Read in source code. |

## Q3. Fix options

Seam: `src/runners/vitest/coverage.ts:56` (`customProviderModule: this.provider`) gives the path; `src/runners/vitest/adapter.ts` `#start` applies instance-wide tweaks after `createVitest` and before `standalone()`, as `withoutOptimizer` does (`src/runners/vitest/optimizer.ts`). Its header says why a `createVitest` option is not enough: "Vite's inline config reaches the root server only", and `test.*` options do not reach "a project with its own config file", which is cezarion's layout.

| Option | Cost | Risk |
|---|---|---|
| A. After `createVitest`, push the provider path onto `server.config.server.fs.allow` of every server (`vitest.vite` and each `project.vite`). | ~10 lines in `coverage.ts`, one call in `#start`, one DOM test. | Mutates Vite's resolved config, as `withoutOptimizer` already does; Vite reads the array at each check (`isFileLoadingAllowed`). Allows one more file only; a project's own loads keep their rule, so verdicts match `vitest run`. Verified by experiment on 4.1.10 and 5.0.5, root config and projects config (fix probe below). |
| B. As A, but add the path to `server.config.safeModulePaths`. | The same. | The same, on an undocumented field that Vite also fills itself. Verified by experiment as A. |
| C. Copy the provider into the project at each start, under an allowed directory (`node_modules/.squeal/`). Under `node_modules`, Vitest externalises it, so Node's loader imports it with no Vite rule. | Small code; a write into the user's tree. | A project with no `node_modules` of its own (a worktree on the parent's) has nowhere allowed to write; leaves files behind; a write in the tree can trigger watchers. Inferred. |
| D. Pass `server: { fs: { allow } }` as a Vite override to `createVitest`. | One option. | Reaches the root server only (optimizer.ts header, read in source code); a project config file keeps its own `fs.allow`. Not probed for projects. |
| E. Set `server.fs.strict: false`. | One option. | Verified to load the provider, but it lifts the rule for the project's own files too: a test that `vitest run` fails could pass under Squeal. Rejected on fidelity. |
| F. Serve the provider from a Squeal Vite plugin (`load` hook). | Plugin injection into every project server. | A plugin's `load` result skips the file rule (`node.js:20108`), but Squeal's adapter adds no Vite plugin today (`git grep` in `src/runners/vitest`); more code than A for the same effect. Inferred. |
| G. Provider build: no change helps. | — | The bytes are not at fault (Q2); a different bundle in the same directory meets the same rule. |

## Q4. Fallback

Today, read in source code at 93e710f4e:

- The instance starts: `createVitest` and `standalone()` succeed, because the main process loads the provider (Q2). So `#start` does not throw, and nothing about the start fails.
- The failure is per worker at run time. A reporter's `onTestRunEnd` gets it as an unhandled error with no `VITEST_TEST_PATH`; its `stack` does not hold the cause, and `cause` is `{ message: "Cannot find module '/@fs/…/provider.mjs'", code: "ERR_MODULE_NOT_FOUND" }` (fix probe, verified by experiment).
- `buildReport` (`src/runners/vitest/run.ts:207`) makes any unattributed unhandled error end the run `crashed`, and a crashed run completes no file. So every file of the run is unknown, node files in the same run too, which matches the report: "every Vitest file stayed unknown".
- `isRunnerFailure` (`broken.ts`) does not match: the top frame is Vitest's `coverage.*.js`, not `vite/dist/node/module-runner.js`. So the instance is kept, coverage stays on, and every later run repeats the crash. No path turns coverage off after a provider failure.
- The reason is `unhandled error outside any test file: ${errorText(e)}`; `errorText` is the error's `stack` (`reporter.ts:305`), and the reporter saw only its first line, the outer message (issue body). The nested `Cannot find module` lives in `error.cause`, so it is lost. `toCheckError` already keeps a cause chain (`results.ts:58`, `causeChain`, task 001-361), but `buildReport`'s failure text does not use it.

Cheapest fallback, inferred:

1. In `run`, after `buildReport`, find an unhandled error whose message starts `Failed to load custom CoverageProviderModule from <this.#instanceCoverage.provider>`.
2. Set a sticky adapter field, for example `#providerFailed`, with one line: the message and its first cause. `#startCoverage` returns `null` while it is set. Note it once (`noteOnce`), like `PROVIDER_MISSING_NOTE`.
3. Drop the instance as `closeBroken` does; the next call's `#instance` starts one with `coverage: { enabled: false }`. The scheduler's crash handling reruns the files, so the cost is one wasted run and one restart per daemon life. Rerunning inside the same call would save the unknown window, at the price of more code in `run`.
4. A pre-check is also possible: after `standalone()`, for each project with a `client` environment, `transformRequest(provider)` on that environment and treat `null` as the same failure, before any run. It costs one transform per start and catches the case before any verdict is lost.

The nested cause: build the run failure from `errorText` plus the cause chain, first line first, for example `coverage provider failed to load in the workers: Cannot find module '/@fs/…/provider.mjs' (ERR_MODULE_NOT_FOUND)`. Reuse `causeChain` from `results.ts` (export it), so the cap and relativising stay one rule.

## Fix probe

`fixes.sh <version>` runs `probe-fix.mjs`, which starts an instance as the adapter's `#start` does: `createVitest("test", { root, config, watch: false, reporters, coverage: <D8's options> })`, then a fix on every server in `new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)])`, then `standalone()` and one run of every file. `vitest.projects.config.mjs` has two projects in their own config files, `dom` (jsdom) and `node`, as cezarion has. `uptime` before: `load average: 22.52, 29.50, 30.42`, then `23.85`.

```text
4.1.10 jsdom    none  modules=[]                          unhandled: "Failed to load custom CoverageProviderModule from …/provider.mjs", VITEST_TEST_PATH null, stack holds cause: false, cause "Cannot find module '/@fs/…/provider.mjs'" ERR_MODULE_NOT_FOUND
4.1.10 jsdom    allow modules=["(root):passed"]            unhandled: []
4.1.10 jsdom    safe  modules=["(root):passed"]            unhandled: []
4.1.10 projects none  modules=["node:passed"]              unhandled: (the same error)
4.1.10 projects allow modules=["node:passed","dom:passed"] unhandled: []
4.1.10 projects safe  modules=["node:passed","dom:passed"] unhandled: []
5.0.5  (the same six results)
frozen: false for every server's fs.allow
```

`allow` is `server.config.server.fs.allow.push(provider)`; `safe` is `server.config.safeModulePaths.add(provider)`. With a fix, the `dom` file's payloads hold V8 coverage of `math.js` (seven payload files under 5.0.5's `.tmp`, each with `provider.mjs,probe.spec-102.js,math.js`), so coverage works, not only the load. Without a fix, the `node` file passes in Vitest, but the unattributed error makes Squeal's whole run `crashed` (Q4).

## Recommendation for Squeal

Ship option A in `#start` beside `withoutOptimizer`, with a regression test that runs a `jsdom` file with coverage on and the provider outside the project. Ship the fallback in Q4 (steps 1–3) with it, so any later provider failure costs coverage only, and put the first cause in the reason. Until then, the issue comment's workaround stands: `"coverage": { "enabled": false }` in `squeal.config.json`.

## Open questions

- Payloads name `provider.mjs` itself among the scripts (a `file://` URL outside `node_modules`, so `kept` keeps it). Whether D8's mapping drops it was not checked; inferred harmless, since no test file's closure holds it.
- Other `client` environments: browser mode and custom environments with `viteEnvironment: "client"` were not probed. Browser mode loads the provider through `loader.isBrowser`; its rules differ. Not determined, because out of the brief's bound.
- Windows paths for `fs.allow`: not probed.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/102 (read with `gh issue view 102 --repo hearsay-tools/squeal --comments`).
- Vitest 4.1.10 and 5.0.5, Vite 8.3.5, installed by `run.sh` from npm under `/tmp/issue-102/v<version>/node_modules/`: files and lines named above.
- cezarion, read only: `~/projects/cezar/vitest.config.ts`, `packages/web/vitest.config.ts`, installed `vitest@4.1.10`, `vite@8.1.4`.
- Squeal at 93e710f4e: `src/runners/vitest/coverage.ts`, `adapter.ts`, `optimizer.ts`, `broken.ts`, `run.ts`, `results.ts`, `reporter.ts`, `src/core/code/coverage/runtime.ts`, `plugins/codex/dist/coverage/provider.mjs`.
- Probes: `research/probes/issue-102/` beside this file (`run.sh`, `variants.sh`, `fixes.sh`, `probe-fix.mjs`, configs).
