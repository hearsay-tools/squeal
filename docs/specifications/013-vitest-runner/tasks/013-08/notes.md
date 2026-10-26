# 013-08 notes: the coverage provider failed to load in Cezar's jsdom workers

Worker 6b240e54, 2026-10-26. Commits: `9bc8358be` (nested causes in run diagnostics), `11e1b8be1` (root fix).

## Cause (captured, reproduced)

The nested cause under "Failed to load custom CoverageProviderModule from <provider>":

```
Caused by: [ERR_MODULE_NOT_FOUND] Error: Cannot find module '/@fs/<provider dir>/provider.mjs'
    at reviveInvokeError (…/vite@8.1.4/…/vite/dist/node/module-runner.js)
    at VitestModuleRunner.getModuleInformation (…)
    at VitestModuleRunner.import (…)
    at resolveCoverageProviderModule (…/vitest@4.1.10/…/coverage.CTzCuANN.js)
    at startCoverageInsideWorker (…)
```

How it happens (read in Vitest 4.1.10 and Vite 8.1.4 sources, then reproduced):

1. A test file in a jsdom or happy-dom environment runs through Vite's **client** environment (`viteEnvironment: "client"`).
2. The worker imports the provider by path through the module runner. A `.mjs` outside `node_modules` is inlined (Vitest `defaultInline`), so Vite loads and transforms it.
3. In `loadAndTransform`, Vite reads a file only if `isFileLoadingAllowed`: with `server.fs.strict` (the default), the file must be under an entry of `server.fs.allow`. The `ssr` environment (node) skips that check.
4. Cezar web's allow list is its workspace root. The provider is in `~/.claude/plugins/cache/…` or the runtime store, outside it. Vite returns no code ("Failed to load url"). Vitest's worker turns that into `ERR_MODULE_NOT_FOUND`, and `resolveCoverageProviderModule` wraps it.
5. The worker never runs its file, so the file gets no result, and the unattributed error makes the run `crashed`.

It is deterministic, not a timing or install effect. The share that failed in a run was the share of jsdom files in it. A web file with a `@vitest-environment node` docblock runs in `ssr` and passed.

## Evidence

### Before: Cezar's store (read-only; `runs.test_files` against the `MODULE` lines of each `vitest.log`)

| Run | Files asked | Server files | Web files | Files with no end |
|---|---|---|---|---|
| 8cc08fa8 (13:18) | 200 | 119 | 81 | 69, all web |
| 6450146d (13:35) | 200 | 119 | 81 | 69, all web |
| 207de1c2 (13:39) | 200 | 118 | 82 | 78, all web |
| 59a2b816 (13:38) | 87 | 46 | 41 | 40, all web |
| 4f8b1c8d (13:26) | 41 | 31 | 10 | 8, all web |
| 061ff52d (13:33) | 16 | 14 | 2 | 1, web |

Runs of 1 to 4 files that held no jsdom file passed. Every provider error in 27 crashed run logs (459 errors) is raised by `startCoverageInsideWorker`.

### Before: isolated reproduction

A scratch clone of Cezar `ecdde7685` with dependencies installed offline from the pnpm store (`t/6b240e54/repro/cezar`). The probe `probes/provider-load.ts` runs the files through `createVitestAdapter` from this worktree's sources, with observation and coverage on, and the provider copied to a path outside the project.

- Server, contract and api-client files (200, one batch): completed, no provider error.
- Web files only, before the fix (`out2`):

| Batch | Files | Ended | Ended with an env docblock | Provider load failures, each `ERR_MODULE_NOT_FOUND` |
|---|---|---|---|---|
| 1 | 100 | 17 | 17 | 83 |
| 2 | 100 | 29 | 29 | 71 |
| 3 | 90 | 26 | 26 | 64 |

### After the fix (`out3`, same probe, commit `11e1b8be1`)

| Batch | Files | Ended | Provider load failures | Tests passed | Tests failed |
|---|---|---|---|---|---|
| 1 | 100 | 100 | 0 | 2224 | 0 |
| 2 | 100 | 100 (2 failed) | 0 | 2229 | 1 |
| 3 | 90 | 90 | 0 | 2204 | 0 |

The two failed files are not provider faults:

- `packages/web/src/routes/github/github.test.tsx`: "github-layout.css not found from <cwd>". The test reads from the working directory, and this probe ran from the Squeal worktree, while the daemon runs each call from the root. The probe now changes into the root first.
- `packages/web/src/routes/cross-project-task-navigation.test.tsx`: one assertion ("expected null not to be null") after 6.3 s, with host load about 50 on 24 CPUs. Not investigated; Cezar's own test.

## The fix

`InstanceCoverage.allow` (`src/runners/vitest/coverage.ts`), called at each coverage-on start before any run (`adapter.ts` `#start`). It adds the provider file alone to `server.fs.allow` of every Vite server of the instance: the root server and each project's, separate project configs included. It adds both the path and its real path, because Vite's resolver gives the real path. Existing entries and `fs.strict` stay, and no directory is allowed. The key test ("keys a coverage-on instance by the provider's name and version alone") still passes, so the path does not reach the environment key.

Regression `test/runners/vitest/own-provider-client.test.ts`: the `client-env` fixture (a local environment with `viteEnvironment: "client"`, as jsdom has; Squeal installs no jsdom) as the root project and as a project of its own config. Before the fix both cases failed with the same nested cause. After it, both pass.

## Found on the way, not fixed here (sent to the coordinator)

- **(A) Vitest 4 collects no coverage.** The 4.1.10 worker calls `startCoverage({ isolate })` and `takeCoverage({ moduleExecutionInfo })`, with no `reportsDirectory` and no `coverageFilesDirectory`. `provider.mjs` returns at once without the first and returns no payload without the second. The 200-file probe batch left no payload file. Once this fix lands, Cezar's runs complete with coverage on, but they keep no coverage record.
- **(B) A project of its own config keeps no payload (Vitest 5).** The worker reports `testFiles` as `file.name`, relative to the project's root, and `coveredFiles` resolves it against the worktree root. The regression's separate-project case pins this with `kept: false`.

## Reproduce

```sh
# from this worktree; <clone> is a Cezar checkout with dependencies installed
node --import tsx docs/specifications/013-vitest-runner/tasks/013-08/probes/provider-load.ts <clone> <out> 100 1 web
```

Each batch's `vitest.log` and `report.json` are under `<out>/runs/<n>/`. Run logs are kept at `t/6b240e54/repro/out{1,2,3}/runs/` until this task's scratch is deleted.
