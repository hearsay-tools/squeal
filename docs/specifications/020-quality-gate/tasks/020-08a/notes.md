# 020-08a notes: coverage records in `ci record` parts

Worker afa19f56, 2026-11-10, on `cez/afa19f56` from `4c0080a9e`. Spec D13 items 1 and 3 to 6.

## Seam map

- `src/runners/vitest/ci-runtime/coverage.cjs`: `startCoverage(vitest, settings)` runs in `vitest-ci.cjs`'s `start` wrap, before the original `start`. It yields (`project-coverage`, `no-provider`), or sets `configOverride.coverage`, allows the provider in each Vite server, and stamps each container's `load`. `runCoverage` takes the provider's batches at each `onTestModuleEnd` and at the run's end, and maps each whole, unfiltered file in the records' worker, one job at a time (`map-worker.ts` holds one job). `end(modules)` gives each module `{ record }` or `{ none }`; the inspector rule wins over every other reason.
- `coverage-drops.cjs`: `projectFile`, `transformOf`, `inspectorIds` (module `deps`/`dynamicDeps` naming the inspector, plus `require(`/`getBuiltinModule(` in the code), `payloadFiles`, `isFiltered`.
- `map-client.cjs`: `workerMapper`'s protocol in CommonJS. The record comes back as a `SharedRecord`, base64 parts and no tail.
- `src/runners/vitest/ci-coverage.ts`: `rawRecord` assembles a `SharedRecord` with `assemble` and `decodeRecord` from `core/code/coverage/parts.ts`; `PartRecordTable` stores each source entry once, by its JSON text.
- `ci-runs.ts` `recordedRun` puts `coverage` and `records` on the run; `cli/ci.ts` writes them into the header and the part, and prints one line per part.
- `core/ci/parts.ts`: `PART_FORMAT` is `squeal-ci-part/4`, `PART_FORMATS` holds 3 and 4, `partRecord(part, file)` gives the `CoverageRecord` back. Format 3 parts read as parts with no records.
- From the TypeScript sources no records' worker sits beside the CLI, so `ci record` there writes `off: "no-provider"`. Tests pass `CiDeps.mapWorker` = `TS_WORKER` (`test/code/coverage/payloads.ts`). The bundle finds `dist/cli/coverage-map.mjs` and `dist/coverage/provider.mjs`; `copyCiRuntime` copies the three new `.cjs` files; `harness/build.ts` did not change.

## For 020-08b

- A file's evidence: `part.header.coverage` with `provider`, `providerVersion` and `recordVersion` equal to this Squeal's, then `partRecord(part, file)`. `noRecord` says why a file has none.
- `ci export` leaves out `noRecord: "inspector"` files (`CiExportCounts.inspector`).

## Hand check on real Vitest 4.1.10

`test/fixtures/vitest/vitest-4.1` is a stub, not a real Vitest, and only Vitest 5.0.3 is installed here. The parent agreed (2026-11-10) to a hand check in `/tmp/ce41`: `HOME`, `XDG_*` and `TMPDIR` there; each fixture's own `node_modules/` with one symlink, `vitest`, to cezar's package; no config file except the own-coverage fixture's. A throwaway driver (`node --import tsx`) called `ciCommand` from this worktree's sources with `TS_WORKER`, then `collectEvidence` on the same fixture.

| Case | Result |
|---|---|
| records against the gate collector, 2 files | exit 0; `coverage records for 2 of 2 test files`; both records equal the collector's (run twice) |
| `-t adds` | exit 0; both files `filtered` |
| `--no-isolate` | exit 0; both files `isolate-false` |
| a source importing `node:inspector` | exit 0; 2 records, `test/probe.test.ts` `inspector` |
| own provider, `--coverage`, threshold fails | plain exit 1, with `ci record` exit 1; `coverage/coverage-final.json` written; header `off: "project-coverage"` |

`git -C ~/projects/cezar status --short` was `?? .claude/` and `?? .opencode/` before and after. The `.vite-temp` directories of cezar's packages changed at 14:26:42+01:00, before the first run's Vitest started (14:26:44), all at once, as a cezar workspace run does; seven Squeal daemons run in cezar. A repeat of the first case with a new marker left no file under `~/projects/cezar` newer than the marker, `.git` and `.ai/cezar` aside. `/tmp/ce41` was deleted.
