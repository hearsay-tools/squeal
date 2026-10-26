# 013-09 notes: Squeal's provider collects coverage on Vitest 4

Worker 6b240e54, 2026-10-26, found while repairing 013-08 (`../013-08/notes.md`). Lands after 013-10, because each Cezar project is a project of its own config, so a Cezar record needs both.

## Defect

Vitest 4.1.10's worker (`setup-common.DYx3LtFI.js`) calls the provider as:

- `startCoverage({ isolate })`
- `takeCoverage({ moduleExecutionInfo })`

Vitest 5.0.3 (`coverage.S6Dao4g-.js`) also passes `reportsDirectory` to `startCoverage` and `coverageFilesDirectory` to `takeCoverage`. `provider.mjs` returned at once without `reportsDirectory`, so no V8 session started. It returned no payload without `coverageFilesDirectory`. On Vitest 4, every run with coverage on therefore kept no record. Evidence: the first 013-08 probe batch (200 Cezar files of the server, contract and api-client projects) left no payload file.

## Fix (`src/core/code/coverage/provider.mjs`)

The worker side reads what Vitest 4 does not pass from the worker's config, `globalThis.__vitest_worker__.config.coverage`. Vitest 4.1.10 serializes `reportsDirectory` there (`cli-api.BK8pd4xc.js`, the `coverage` block of the worker config). The payload goes to `coverageFilesDirectory` when Vitest names one, else to `<reportsDirectory>/.tmp`, where Vitest 5 puts it unsharded. The worker returns the payload's path, as before. Vitest 4 sends whatever `takeCoverage` returns to the main side as `onAfterSuiteRun({ coverage })`, and the main side keeps a string `coverage`, so the adapter's contract is unchanged. Vitest 5's arguments win when present, so its behavior is unchanged. `isolate: false` and a file the daemon listed in `skip.json` (a closure or setup that imports `node:inspector`) still take none.

`COVERAGE_PROVIDER_VERSION` is not raised. The payload format and its mapping did not change. Results under coverage-on keys stay valid; their records arrive from the next run (no key broadening, coordinator 2026-10-26).

## Regression (`test/runners/vitest/own-provider-worker.test.ts`)

A child process loads `provider.mjs` with a worker config, runs a module under it, and calls `startCoverage` and `takeCoverage` in each Vitest's call shape:

- Vitest 4 and 5: the payload is under `<reports>/.tmp/` and holds the module's function, run once. Before the fix, the Vitest 4 case got no payload.
- Vitest 4 and 5: none for a file listed in `skip.json`, none with `isolate: false`.

A child process keeps the provider's inspector session apart from the test worker's own.

## Cezar proof

Isolated Cezar clone (`ecdde7685`, Vitest 4.1.10, Vite 8.1.4), through `createVitestAdapter` from this worktree with commits 013-08, 013-10 and this row, coverage on. The probe (`../013-08/probes/provider-load.ts`) maps each kept payload with `buildRecord`, as the daemon's writer does.

| Run | Project | Files | Ended | Provider load failures | Payloads kept | Mapped to sources | Tests passed / failed |
|---|---|---|---|---|---|---|---|
| out4 1 | web (jsdom, own config) | 100 | 100 | 0 | 100 | 100 | 2224 / 0 |
| out4 2 | web | 100 | 100 (1 failed) | 0 | 100 | 100 | 2436 / 1 |
| out4 3 | web | 90 | 90 | 0 | 90 | 90 | 2204 / 0 |
| out5 1 | server (node, own config) | 100 | 100 | 0 | 100 | 100 | 1992 / 0 |

Example records, as printed:

- `web packages/web/src/routes/settings/agent-config-section.test.tsx`: 83 sources; `packages/api-client/src/client.ts` 9 of 9 lines covered, 1 function.
- `server packages/cezar/src/core/cursor-print-process.test.ts`: 7 sources; `packages/cezar/src/core/agent-runner.ts` 25 of 40 lines covered, 6 functions.

Before 013-08, 013-10 and this row, the same web files kept 0 payloads: 218 of 290 failed to load the provider, and the rest wrote none.

The one failed test (out4 2) is Cezar's, not a coverage fault by the evidence so far: `packages/web/src/routes/cross-project-task-navigation.test.tsx > opening another project’s task without a reload > reads the run from its own project when the row is clicked on the global Tasks page` (8123 ms), "AssertionError: expected null not to be null" at line 164, inside a `waitFor` with a 5,000 ms timeout. It also failed in the 013-08 after-fix run (6299 ms). Alone it passes: without coverage, 2 of 2 tests in 1.33 s; with Squeal's provider, twice, 1.42 s and 1.29 s. Host load was 30 to 50 on 24 CPUs during the batches.

The same three web batches with coverage off (`PROBE_COVERAGE=off`, `out6`): 290 of 290 files passed, 6865 tests, 0 failed. That test passed in its batch in 3741 ms.

| Run | Coverage | Batch time | "row is clicked" test | "jumping out" test |
|---|---|---|---|---|
| out3 (013-08 after) | on | 53 s | FAIL, 6299 ms | 977 ms |
| out4 (this row) | on | 117 s | FAIL, 8123 ms | 2262 ms |
| out6 | off | 94 s | pass, 3741 ms | 679 ms |
| alone, plain Vitest | off | | pass | |
| alone, with the provider (2 runs) | on | | pass, tests 1.42 s and 1.29 s | |

So, in a loaded 100-file batch, coverage on made this test exceed its 5,000 ms `waitFor` 2 of 2 times; with coverage off, 1 of 1 passed. That is a large difference but unconfirmed at n=3 and with host load changing between runs. Likely reading (inferred): V8 precise coverage (`callCount`, `detailed`) slows jsdom code enough that a 5 s wait in a busy batch runs out. Not investigated further in this row.
