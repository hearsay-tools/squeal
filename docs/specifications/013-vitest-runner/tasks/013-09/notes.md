# 013-09 notes: Squeal's provider collects coverage on Vitest 4

Worker 6b240e54, 2026-10-26, found while repairing 013-08 (`../013-08/notes.md`). Lands after 013-10, because each Cezar project is a project of its own config, so a Cezar record needs both.

## Defect

Vitest 4.1.10's worker (`setup-common.DYx3LtFI.js`) calls the provider as:

- `startCoverage({ isolate })`
- `takeCoverage({ moduleExecutionInfo })`

Vitest 5.0.3 (`coverage.S6Dao4g-.js`) also passes `reportsDirectory` to `startCoverage` and `coverageFilesDirectory` to `takeCoverage`. `provider.mjs` returned at once without `reportsDirectory`, so no V8 session started. It returned no payload without `coverageFilesDirectory`. On Vitest 4, every run with coverage on therefore kept no record. Evidence: the first 013-08 probe batch (200 Cezar files of the server, contract and api-client projects) left no payload file.

## Fix (`src/core/code/coverage/provider.mjs`)

The worker side reads what Vitest 4 does not pass from the worker's config, `globalThis.__vitest_worker__.config.coverage`. Vitest 4.1.10 serializes `reportsDirectory` there (`cli-api.BK8pd4xc.js`, the `coverage` block of the worker config). The payload goes to `coverageFilesDirectory` when Vitest names one, else to `<reportsDirectory>/.tmp`, where Vitest 5 puts it unsharded. The worker returns the payload's path, as before. Vitest 4 sends whatever `takeCoverage` returns to the main side as `onAfterSuiteRun({ coverage })`, and the main side keeps a string `coverage`, so the adapter's contract is unchanged. Vitest 5's arguments win when present, so its behavior is unchanged. `isolate: false` and a file the daemon listed in `skip.json` (a closure or setup that imports `node:inspector`) still take none.

**Provider version: not decided.** This row does not raise `COVERAGE_PROVIDER_VERSION`; the coordinator decides at integration. My proposal is to leave it as it is. The evidence:

- The payload is unchanged: the same `{ result: [...] }` of kept V8 scripts with `startOffset`, written by the same code. Only the directory the worker writes to, and where it reads `reportsDirectory`, now have a fallback.
- On Vitest 5 the behavior is unchanged: the Vitest 5 cases of the regression pass before and after the fix, and Vitest 5's own arguments win.
- On Vitest 4 nothing was recorded before, so no record exists that a raise would invalidate.
- The key holds `{ provider: "squeal", version }` and no path. The test "keys a coverage-on instance by the provider's name and version alone" (`own-provider.test.ts`) passed after 013-08's `fs.allow` change and after this row.
- Cost of a raise (015 D8 Keys): every Vitest check of every project re-keyed once.

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

The one failed test (out4 2) is Cezar's, not a coverage fault by the evidence so far: `packages/web/src/routes/cross-project-task-navigation.test.tsx > opening another project’s task without a reload > reads the run from its own project when the row is clicked on the global Tasks page` (8123 ms), "AssertionError: expected null not to be null" at line 164, inside `waitFor(…, ROUTE_WAIT)`, where `ROUTE_WAIT = { timeout: 5_000 }` (line 34 of that file). It also failed in the 013-08 after-fix run (6299 ms). Alone it passes: without coverage, 2 of 2 tests in 1.33 s; with Squeal's provider, twice, 1.42 s and 1.29 s. Host load was 30 to 50 on 24 CPUs during the batches.

The same three web batches with coverage off (`PROBE_COVERAGE=off`, `out6`): 290 of 290 files passed, 6865 tests, 0 failed. That test passed in its batch in 3741 ms.

| Run | Coverage | Batch time | "row is clicked" test | "jumping out" test |
|---|---|---|---|---|
| out3 (013-08 after) | on | 53 s | FAIL, 6299 ms | 977 ms |
| out4 (this row) | on | 117 s | FAIL, 8123 ms | 2262 ms |
| out6 | off | 94 s | pass, 3741 ms | 679 ms |
| alone, plain Vitest | off | | pass | |
| alone, with the provider (2 runs) | on | | pass, tests 1.42 s and 1.29 s | |

So, in a loaded 100-file batch, coverage on made this test exceed its 5,000 ms `waitFor` 2 of 2 times; with coverage off, 1 of 1 passed. That is a large difference but unconfirmed at n=3 and with host load changing between runs. Likely reading (inferred): V8 precise coverage (`callCount`, `detailed`) slows jsdom code enough that a 5 s wait in a busy batch runs out. Not investigated further in this row.

## Checks (rows 013-08, 013-09 and 013-10 together)

Run in this worktree on 2026-10-26. No full suite was run; CI runs it on the candidate.

| Command | At | Result |
|---|---|---|
| `npm run lint` (`biome check .`) | `4ee620295` | "Checked 2252 files in 813ms. No fixes applied." |
| `npm run typecheck` (`tsc --noEmit`) | `4ee620295` | exit 0, no output |
| `npx biome check test/keys/validity/cases/adapter/vitest.ts` and `npx tsc --noEmit` | `47b34a846` | no warnings; exit 0 |
| `npx vitest run test/runners/vitest/own-provider-client.test.ts` (direct: the regression was new and Squeal's queue was long) | `9620f68eb` | 3 of 3 passed |
| `squeal status --wait 60000` on `own-provider-client`, `own-provider-projects`, `own-provider-worker`, `report`, `own-provider` and `test/code/coverage/runtime.test.ts` | revision 45 (`4ee620295`) | "no known failures; 6 test files, each with a current result" |
| `squeal status --wait 900000` on the four changed sources, the four changed test files and `test/keys/key-format.test.ts` | revision 45 (`4ee620295`) | deadline passed after 900.8 s: 253 current (248 pass, 5 fail), 155 pending |
| the same wait, on `test/keys/key-format.test.ts` | revision 47 (the content of `47b34a846`) | PASS, FAIL -> PASS, run `3ab427c4` |

The five failures at revision 45:

- Four are bundle drift, expected because the coordinator builds the bundles: `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` and `test/harness/plugin.test.ts`, each "cli/squeal.mjs differs from the build".
- `test/keys/key-format.test.ts` failed at revisions 38, 39 and 45. It named changed lines that no validity case runs: `reporter.ts` 329–337 and `coverage.ts` 105–108 at revision 38; `reporter.ts` 329 and 330 at revision 45. `../013-08/notes.md`, "Key guard", gives the fixes. At revision 47 it passes: every case gives the same stored outputs at the last release and at the candidate, and every changed line ran. So the comparison found no stored-meaning difference, and no version moved.

At revision 48 the worktree's known failures are the four bundle-drift tests. 100 of 1165 test files were still queued or running, so their results are not reported here.
