# One CI run gives the project's coverage report and Squeal's per-file records (row 020-26, #189)

Researcher: e308738e, 2026-11-11. Brief: `issue-189-brief.md`. Probes: `probes/ci-coverage-both/` (throwaway). Versions examined: Vitest 5.0.3 and `@vitest/coverage-v8` 5.0.3 (Squeal's dev dependency), Vitest 4.1.10 and `@vitest/coverage-v8` 4.1.10 (cezarion's, read in `~/projects/cezar/node_modules`, never written), `@vitest/coverage-istanbul` 5.0.3, Squeal at `ae1e61c1b` (`src/runners/vitest/ci-runtime/`, `plugins/claude-code/dist/`), cezarion at `249c8783b`.

**Verdict: wrap.** Squeal can keep the project's V8 provider and read the same per-test-file payload it already gets from its own provider. On the fixture, on both Vitest versions, the records were byte for byte the records Squeal's own provider gives, and the project's report and exit code did not change. On one real cezarion shard, the tee gave a record for each of 422 test files at no cost above noise. Replacing the provider is not needed and would rebuild most of `@vitest/coverage-v8`. An Istanbul or custom provider still yields.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Wrap the project's provider? | Yes for `provider: "v8"`, on Vitest 4.1.10 and 5.0.3. Wrap the provider instance's `onAfterSuiteRun` after Vitest creates it; map each payload with the existing worker. No `coverage.provider: "custom"` and no config override. Istanbul and custom providers: no (their payload is not a V8 profile); they yield as today. | verified by experiment (V8); read in source code (Istanbul) |
| 2 | What would replacing take? | Squeal's provider would have to produce the report itself: AST-aware V8-to-Istanbul conversion, untested `include` files, every `coverage.reporter`, thresholds (global, per file, per glob, `autoUpdate`), watermarks, `ignoreClassMethods`, `excludeAfterRemap`, and 5+ new runtime dependencies. Not recommended. | read in source code |
| 3 | Files Squeal gives no record: does the report cover them? | Wrap: yes, the report is the project's own provider's, unchanged. Verified for `isolate: false`, a name filter and a `node:inspector` closure; a batch of several files and an unfinished file not reproduced. Replace: no for `isolate: false` (Squeal's provider takes no coverage there). | verified by experiment (wrap, 3 of 5); read in source code (replace) |
| 4 | Part header | Three states: `provider: "squeal"` with a new `collector: "squeal"` (records only), `collector: "v8"` with the project's provider version (records and project report), and `off: "project-coverage"` naming the provider (yielded). | inferred (a proposal) |
| 5 | Cost against the project's provider alone | Fixture: +0.14 s CPU per run (+9%) on Vitest 5.0.3, +0.07 s (+4%) on 4.1.10; the ranges overlap at n=8. One real cezarion shard (Vitest 4.1.10): tee 2,711 s CPU against 2,815 s for V8 alone, so no cost above one run's noise at load 18 to 41. | verified by experiment (n=1 on the shard) |

## Findings

### Q1. Wrap, do not replace

1. **Vitest gives every provider the same per-file seam.** `CoverageProvider.onAfterSuiteRun(meta)` is called in the main process once per worker run, with `testFiles`, `projectName`, `environment` and the payload (Vitest 5.0.3 `chunks/plugin.d.*.d.ts`, `interface CoverageProvider`; call site `vitest.coverageProvider?.onAfterSuiteRun(meta)`, `chunks/index.DpLw24bj.js:10686`; Vitest 4.1.10 `cli-api.BK8pd4xc.js:2729`). Squeal's provider uses the same hook (`src/core/code/coverage/provider.mjs`, `onAfterSuiteRun` keeps `meta`, `takeBatches` hands it to `coverage.cjs`). Read in source code.
2. **The V8 payload is Squeal's payload.** `@vitest/coverage-v8`'s worker side takes `Profiler.takePreciseCoverage` with `callCount` and `detailed`, keeps `file://` scripts outside `node_modules`, and sets each script's `startOffset` from `moduleExecutionInfo` (5.0.3 `dist/index.js`, `takeCoverage`, `filterResult`). Squeal's `provider.mjs` does the same: `kept(script)` and the same `startOffset`. V8 also drops `/@id/@vitest/` and `/@vite/client` URLs, which are not project files. Read in source code.
3. **Vitest 5 gives a path, 4.1 an object.** In 5.0.3 the worker writes the payload and `meta.coverage` is its path (`commands-*.js`, `writeCoverageFile`; `BaseCoverageProvider.onAfterSuiteRun` throws on a non-string). In 4.1.10 `meta.coverage` is `{ result }` and the provider writes it itself (`coverage.DM_a_rWm.js:732`). Verified by experiment: `teeLog` reads `string` five times on 5.0.3 and `object` five times on 4.1.10.
4. **The payload outlives Squeal's mapping.** Vitest runs `generateCoverage`, then the reporters' `onTestRunEnd` (Squeal awaits its records there), then `reportCoverage`, whose `cleanAfterRun` deletes the payload directory (5.0.3 `index.DpLw24bj.js:21142` to `21146` and `15119`; 4.1.10 `cli-api.BK8pd4xc.js:13604` to `13608`). The CI records worker never deletes a payload: the bundle imports `rmSync` and never calls it (`plugins/claude-code/dist/cli/coverage-map.mjs`). Only the daemon's `workerMapper` main thread deletes (`src/core/code/coverage/mapper.ts`, `removePayload`). Verified by experiment: in `tee-nocopy`, Squeal mapped the provider's own payload files and `generateCoverage` was delayed by 2 s; all 5 files still existed before it read them, and the report equalled the plain run's. So on Vitest 5 Squeal needs no copy.
5. **Same records, same report, same exit code.** `probe.mjs tee` ran the real `coverage.cjs` against the project's V8 provider (`out/5.0.3/compare.txt`, `out/4.1.10/compare.txt`):
   - `coverage-final.json` and `coverage-summary.json` deep-equal the plain run's, with the threshold, without it, and with `-t`.
   - Exit code 1 with the failing lines threshold ("Coverage for lines (70%) does not meet global threshold (95%)"), 0 without it, in both plain and tee.
   - Records for `add.test.ts` and `mul.test.ts`: `records equal: true` against today's Squeal-provider run, on both versions. `inspector.test.ts`: `none: inspector` in both.
   Verified by experiment.
6. **One rule must move.** Squeal's provider takes no coverage with `isolate: false`, so today no batch arrives and `settle` reads `isolate-false`. The project's V8 provider does take coverage there (it keeps one session per worker, `startCoverage` returns early only on a second call), so the tee mapped both `shared` files into records. These records are wrong evidence: a module the first file loaded is not loaded again, and `takePreciseCoverage` resets counts between files. A wrap must drop a batch from an `isolate: false` project before it maps it. Verified by experiment (records appeared); the reason is read in source code.
7. **One payload shape must be refused.** With `coverage.autoAttachSubprocess` (default `false`), V8 adds the children's scripts to the payload with `startOffset: 0` and `isExtendedContext: true` (5.0.3 `dist/index.js`). The mapper would map them against the Vite transform of the same path, which the child did not run. A wrap must drop those entries, or the file's record, when the flag is on. Read in source code; not run.
8. **Istanbul and custom providers.** Istanbul's payload is `globalThis.__VITEST_COVERAGE__`, an Istanbul file-coverage map of instrumented code (`@vitest/coverage-istanbul` 5.0.3 `base-*.js`, `takeCoverage`), not a V8 profile. A record from it would not be a record from the daemon's provider, which breaks daemon parity (D10). A custom provider's payload is unknown. Both yield as today. Read in source code.
9. **A precedent.** cezarion already wraps the V8 provider instance from a reporter's `onInit` (`.github/scripts/vitest-coverage-tests.mjs`, `optionalCoverageReports` and `options.exclude`). Read in source code.

### Q2. Replacing

Not tried. What Squeal's provider would have to do, read in `@vitest/coverage-v8` 5.0.3 `dist/provider.js` and Vitest's `BaseCoverageProvider`:

- convert V8 ranges to Istanbul with `ast-v8-to-istanbul`, ignoring Vite's SSR import statements, `ignoreClassMethods` and `/* v8 ignore */` hints;
- add untested files that match `coverage.include` (`getUntestedFiles`), apply `exclude` and `excludeAfterRemap`;
- run every `coverage.reporter` through `istanbul-lib-report` with `watermarks` and `skipFull`;
- apply `thresholds`: global, `perFile`, glob keys, `100`, and `autoUpdate`, which rewrites the config file (`magicast`);
- respect `reportOnFailure`, `clean`, shards' `coverageFilesDirectory`, and `--merge-reports`.

That is the dependency list of `@vitest/coverage-v8` (`@bcoe/v8-coverage`, `@vitest/istanbul-lib-coverage`, `@vitest/istanbul-lib-report`, `ast-v8-to-istanbul`, `magicast`). The report would match the project's only as long as Squeal tracks every V8 provider release. With `isolate: false`, Squeal's provider takes no coverage, so those files would be missing from the report unless that rule also changes.

### Q3. Files with no Squeal record

| Case | Wrap: project report | Replace: report | Evidence |
|---|---|---|---|
| `isolate: false` | covered (`src/shared.ts` 1/1) | missing unless the provider collects there | experiment (wrap); `provider.mjs` `startCoverage` (replace) |
| test name filter | covered as the project's provider covers it (`src/add.ts` 2/3 under `-t`) | covered | experiment |
| `node:inspector` closure | covered (`src/probe-inspector.ts` 1/1) | covered | experiment |
| batch of several files | the project's provider's own behaviour | depends on the rewrite | not reproduced: Vitest 5 sent one payload per file with `isolate: false, maxWorkers: 1`; the cezarion shard had 0 such batches in 422 |
| unfinished file | the project's provider's own behaviour (no payload when the worker dies) | the same | not tested |

### Q4. Part header

Today `PartCoverage` is `{ provider: "squeal", providerVersion, recordVersion, note? }` or `{ off, note }` with `off` in `project-coverage | no-provider | failed` (`src/core/ci/parts.ts:102`). Proposal (inferred):

- records only: `{ provider: "squeal", collector: "squeal", ... }`;
- records and the project's report: `{ provider: "squeal", collector: "v8", collectorVersion: "<@vitest/coverage-v8 version>", ... }`;
- yielded: `{ off: "project-coverage", note }`, the note naming the provider (`istanbul`, `custom`).

`ci record --help` says: with the project's V8 coverage on, Squeal reads its payloads and the project's report and thresholds stay the project's; with Istanbul or a custom provider, Squeal records no coverage.

### Q5. Cost

Fixture, 8 runs per mode, alternating, `THRESHOLD=0` (`out/*/timing.txt`):

| Vitest | load | plain CPU, mean (range) | tee CPU, mean (range) | squeal CPU (today, no project report) |
|---|---|---|---|---|
| 5.0.3 | 16.6 to 19.2 | 1.59 s (1.42 to 1.75) | 1.73 s (1.57 to 1.91), +9% | 1.63 s |
| 4.1.10 | 19.2 to 21.3 | 1.71 s (1.56 to 1.89) | 1.78 s (1.65 to 1.95), +4% | 1.64 s |

These runs last under 1 s; the worker start dominates.

Real shard: cezarion `249c8783b`, shard 1/4, 4 workers, the four unit projects, Vitest 4.1.10, one run per mode in a `/tmp` clone (`out/cezar/`). The load rose during every run, partly from the run itself:

| Mode | wall | CPU (user + sys) | load before to after |
|---|---|---|---|
| no coverage | 626 s | 2,454 s | 18.1 to 34.1 |
| V8 only (`--coverage.enabled`) | 824 s | 2,815 s | 23.5 to 41.3 |
| V8 with Squeal's records (tee) | 687 s | 2,711 s | 22.7 to 39.8 |

- The tee run was not slower than V8 alone (-4% CPU, -17% wall). At n=1 under a load of 18 to 41, that is noise. The measured result is "no cost above one run's noise", not a saving. Verified by experiment.
- Expected cost, inferred: the tee does a subset of today's `ci record` work (mapping and stamps, no collection), and 020-08c measured today's work at 5.4% to 6.3% of test time on cezarion's shards. On Vitest 4.1, it also writes each payload object once more.
- The tee gave 422 records for 422 test files, with 0 batches of several files.
- The two reports cover the same 1,301 files. In 14 of 97,234 statements (10 files) the covered state differs: 5 are covered only in the tee run and 9 only in the V8-only run, all in process, timer and server code (`out/cezar/report-diff.txt`). This looks like run-to-run variation, but no V8-only against V8-only control ran, so that is inferred. The issue's acceptance "matches within a stated tolerance" needs that control in 020-26c.

## Recommendation for Squeal

A spec 020 section ("D19. Records beside the project's coverage") from these points:

1. When the resolved config has `coverage.enabled` and `provider: "v8"`, `ci record` adds no provider. It wraps `vitest.coverageProvider.onAfterSuiteRun` once the provider exists (the reporter's `onTestRunStart`), keeps each batch, and lets `coverage.cjs` map it as today. The original call runs first and its result is returned; an error of Squeal's is a note, never the run's.
2. Vitest 5: Squeal reads the provider's payload path in place. Vitest 4.1: Squeal writes the payload object to its own directory.
3. Kept rules: whole file, not filtered, no `node:inspector` (D13.1). New rules: no record from an `isolate: false` project, and none from a payload with `isExtendedContext` entries.
4. Istanbul, custom and browser-mode coverage yield as today.
5. The header names the collector (Q4). The gate reuses a part whose collector is `v8` under the same rule as today: same record and provider versions, same environment.

Row split (proposed):

- **020-26a** (`src/runners/vitest/ci-runtime/coverage.cjs`, `coverage-drops.cjs`; `src/core/ci/parts.ts`, `src/runners/vitest/ci-coverage.ts`; the `ci record --help` text). Tests: one fixture with V8 coverage on, Vitest 5 and 4.1 if the kit has both: the report equals a run without `ci record`; the threshold exit code is the same; records equal a run with Squeal's provider; `isolate: false` reads `isolate-false`; Istanbul yields. 
- **020-26b**, after 020-26a: the gate and `ci export` read `collector` (`src/core/ci/export-check.ts`, `src/core/code/gate/parts.ts`). Tests: a `v8`-collected part is reused, an unknown collector is not.
- **020-26c**: the cezarion proof (one PR shard under `ci record` with `--coverage.enabled`, its report compared with a V8-only run and a second V8-only run as the control), a proposal that needs the human, as 020-08c was.

## Open questions

1. **Does a record from the project's V8 provider count as Squeal's evidence?** The probe shows equal records for this fixture on two Vitest versions. A future `@vitest/coverage-v8` could change its payload. Options: accept any `v8` collector (simple), or accept only versions Squeal has tested (safe, more upkeep). For the human or the coordinator.
2. **#190 overlap (018-35).** If shared results carry records, the collector must travel with them. D13.4 (`ci export` leaves out `node:inspector` files "when a shard ran with the provider") should also hold when the project's V8 provider ran; today a yielded run is not covered by it. Spec 018's call.
3. **A batch of several files and an unfinished file** were not reproduced (Q3).
4. **Browser-mode V8 coverage** sends payloads by another route; not examined.
5. **The report tolerance.** On the real shard, 14 of 97,234 statements differ between the V8-only and tee runs. A V8-only against V8-only control decides whether that is run-to-run variation (Q5).

## Sources

- Vitest 5.0.3: `node_modules/.pnpm/vitest@5.0.3_*/node_modules/vitest/dist/chunks/index.DpLw24bj.js` (`BaseCoverageProvider` 14945 to 15200, `initCoverageProvider` 20840, run end 21140 to 21147, `reportCoverage` 21459), `chunks/plugin.d.BsjqSb4-.d.ts:1745` (`CoverageProvider`), `chunks/defaults.D2ip7f-X.js:19` (defaults).
- `@vitest/coverage-v8` 5.0.3 and `@vitest/coverage-istanbul` 5.0.3: https://registry.npmjs.org/@vitest/coverage-v8/-/coverage-v8-5.0.3.tgz, https://registry.npmjs.org/@vitest/coverage-istanbul/-/coverage-istanbul-5.0.3.tgz (`dist/index.js`, `dist/provider.js`, `dist/commands-*.js`).
- Vitest and `@vitest/coverage-v8` 4.1.10: `~/projects/cezar/node_modules/` (`vitest/dist/chunks/coverage.DM_a_rWm.js:732`, `cli-api.BK8pd4xc.js:2729`, `13604`).
- Squeal: `src/runners/vitest/ci-runtime/coverage.cjs`, `coverage-drops.cjs`, `map-client.cjs`; `src/core/code/coverage/provider.mjs`, `mapper.ts`; `src/core/ci/parts.ts`; `plugins/claude-code/dist/cli/coverage-map.mjs`.
- cezarion `249c8783b`: `vitest.config.ts`, `.github/scripts/vitest-coverage-tests.mjs`, `.github/workflows/ci.yml:788`.
- Probes: `probes/ci-coverage-both/` and its `out/`.
