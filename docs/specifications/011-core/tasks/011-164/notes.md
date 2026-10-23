# 011-164 notes: a run's report keeps only its summary

Worker d7b1cd18, brief W5 of `tasks/wave-26.md`, base main at 9f77f4f4c.

## What changed

- **One helper:** `src/runners/run-summary.ts`, used by Vitest and pytest. `runSummary(report)` picks `end`, `failure`, `durationMs`, `fileDurations`, `completedFiles`, `fileErrors` and `startedProjects` of a `RunReport`. An optional field the report lacks stays out. `runLogJson(fields, report)` returns `{ ...fields, report: runSummary(report) }` as one line of JSON with a final newline. New type: `RunSummary`, a `Pick` of `RunReport`, in `src/runners/`. No type in `src/core/types/` changed.
- **Vitest:** `writeRunLog` in `src/runners/vitest/run.ts` writes `report.json` as `runLogJson({ runId }, report)`. The file name and the `{ runId, report }` shape stay, so every reader that took `.report.failure` or `.report.completedFiles` reads the same paths. `vitest.log` is unchanged.
- **node:test: not changed** (see "The key-format alarm" below). Its `run.json` keeps `{ cwd, files, report }` with the full report, indented. `squeal why --include-logs` reads only `files[].testFile` of it (`src/core/status/run-log.ts` `nodeTestLogs`).
- **pytest:** `run.json` is `runLogJson({ cwd, batches, notes }, report)`. `batches` keeps each batch's `files`, `command`, `exit` and `session`. `notes` stays.
- Gone from Vitest's and pytest's logs: `results`, `observed`, `reads`, `environmentObserved`, `skippedFiles`, `startupFailure`, `withheld`, `focused`. The row's done-when lists the fields to keep, and these are not among them.

## Tests

- `test/runners/run-summary.test.ts` (new): the fields kept, the fields dropped, one line, an optional field left out.
- `test/runners/vitest/run.test.ts`: `report.json` is one line and its `report` equals the summary (before: `report.results` had 1 entry).
- `test/runners/pytest/run/run.test.ts`: `run.json` keeps each batch's `command` and `exit`, and its `report` equals `runSummary(report)`.
- `test/daemon/{hold,step-down-lanes,stop-cancel}.test.ts`: not changed. They read `report.failure` of `report.json`, which is still there. They build the CLI from this tree (`buildAt`), so they run the new writer.
- `test/e2e/pytest.test.ts` `storeEvidence` (failure evidence only): it printed `report` without `results` and a count of `results`. It now prints the summary as written. This file is outside Squeal's suite and I did not run it; `npm run typecheck` covers it.

## Size on real runs

This repository's store, copied at 2026-10-23T20:57Z: 1,218 runs, every one a Vitest run. Each `report.json` went through `runLogJson({ runId }, report)`. This gives the same bytes the new `writeRunLog` writes for that report, because the old file was `JSON.stringify({ runId, report }, null, 2)` of the same report.

| | before | after |
|---|---|---|
| `report.json`, all runs | 295.9 MB | 4.0 MB (98.7% less) |
| `report.json`, mean per run | 243.0 kB | 3.3 kB |
| `report.json` after, median, p95, max | | 825 B, 25.0 kB, 33.7 kB |
| `runs/` (`report.json` and `vitest.log`, 33.6 MB) | 329.5 MB | 37.6 MB (88.6% less) |

In the old files, `observed` was 61% of the bytes and `results` 29% (indented JSON measured per field). The biggest summaries are runs with many `fileErrors` (each error keeps its stack).

I measured no pytest run: neither store on this host holds a pytest run log. The pytest run test checks the content.

## The key-format alarm, and node:test

The first commit (dcee7280f) also changed node:test's writer. `test/keys/key-format.test.ts` "moves only when the validity path's outputs differ from the last release's" then failed: `NODE_TEST_ADAPTER_VERSION (src/runners/node-test/version.ts): changed lines no case runs, each needing a case under test/keys/validity/cases/: src/runners/node-test/run/run.ts:291 ... :292`. No `adapter:node-test` case kind exists (`tasks/011-41/notes.md`, decision 5), so no node:test code change can pass the alarm. Row 011-144 met the same block (revert d5676f8f8). Vitest and pytest passed: their adapter cases run the new lines.

The coordinator's decision (request 4844e2ea, option a): revert only the node:test writer and its test check (6bae78daf). node:test's `run.json` keeps the full report until 011-48's node half builds the `adapter:node-test` kind. No `NODE_TEST_ADAPTER_VERSION` raise: a release must not re-key every check for a log format. The helper takes any fields beside the report, so the follow-up is one line: `writeFileSync(join(logDir, "run.json"), runLogJson({ cwd: log.cwd, files }, log.report))`, plus the test check in dcee7280f's `test/runners/node-test/run.test.ts`.

Size for the follow-up. cezar's run logs at 2026-10-23T21:10Z (a size listing of every file and a copy of each node:test `run.json`, back to back; the store was not opened): 5,249 runs, 984.7 MB.

| Files | Count | MB | Share of `runs/` |
|---|---|---|---|
| Vitest `report.json` | 4,401 | 444.3 | 45.1% |
| node:test `graph-*.ndjson` | 4,390 | 361.0 | 36.7% |
| Vitest `vitest.log` | 4,401 | 130.1 | 13.2% |
| node:test `events-*.ndjson` | 1,276 | 40.7 | 4.1% |
| node:test `run.json` | 870 | 8.6 | 0.9% |
| node:test `stdout-*.log`, `stderr-*.log` | 2,552 | 0.0 | 0.0% |

Through `runLogJson`, the 870 node:test `run.json` files go from 8.6 MB to 1.2 MB (85.6% less; `results` was 70% of their bytes). So the node:test half saves about 7 MB in cezar. The big node:test cost is the recorder's `graph-*.ndjson` files, 361 MB, which this row leaves as they are (the row's done-when keeps the per-file node:test logs). cezar's Vitest `report.json` is 444 MB; this row cuts it, and at this repository's 98.7% that is about 438 MB, not measured.

## `waste.mjs` still works

`research/probes/host-load/waste.mjs` reads `report.json` → `.report` → `completedFiles`, `fileDurations`, `failure` and `withheld`. I ran it on the store copy with two run-log snapshots, the old files and the converted ones: `waste.mjs <store> 72 <runs> 2026-10-23T20:57:07Z`. Both outputs are byte-identical: 888 runs, `runsWithoutReport` 0, `all.files.keptShare` 72.7.

It reads `withheld`, which the summary drops. This changes no count. The Vitest adapter removes a withheld file from `completedFiles` (`dropFiles` in `src/runners/vitest/moved.ts`) before `writeRunLog` runs. So `completed.has(k) && !withheld.has(k)` gives the same answer with an empty `withheld`. The real copy confirms it: 8 runs withheld 22 files, and none of them was in `completedFiles`. The test for a withheld run, `/may have executed bytes/` on `failure`, still reads `failure`. I did not edit `waste.mjs`.

## For the coordinator

- **Comment now partly false (not mine, `src/core/types/check.ts:65`):** `CheckError.stack` says "Kept in the run log and `squeal why`". A file error's stack is still in `report.json`. A check result's stack is no longer there: `squeal why` reads it from the store, and `vitest.log` prints it.
- **node:test's half** waits for 011-48 (above). The recorder's `graph-*.ndjson` files are 37% of cezar's `runs/`; `graphs()` in `src/runners/node-test/run/run.ts` reads them at run end for `observedClosure`. A grep of `src/` for `graph-` finds no other reader. A possible follow-up row: delete them after that read.
- **Older probes that read dropped fields** (not edited; on new runs they see an empty list): `research/probes/edit-load/work.mjs` (`results`), `research/probes/missed-sharing/earlier.mjs` (`results`), `research/probes/missed-sharing/growth.mjs` (`observed`), `research/probes/stored-nothing/fate.mjs` (`results`, `withheld`), `tasks/011-82/probes/{order,tiers,withheld}.mjs` (`withheld`). `fate.mjs` uses `results` to find a run's failed files (line 114, used at line 162). On runs written after this change it misses a file whose only failure is a failed test; a file error still counts. The host-load README compares `fate.mjs` with `waste.mjs` in its "How `waste.mjs` counts C3" section. `withheld` changes nothing in `fate.mjs`, for the same reason as in `waste.mjs`.
- **Bundles:** `plugins/*/dist` drift (the bundle tests fail, as expected). The coordinator rebuilds.
- **Retention** ("keep 7 days") is W2's prune, not this row.
