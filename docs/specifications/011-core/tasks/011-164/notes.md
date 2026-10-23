# 011-164 notes: a run's report keeps only its summary

Worker d7b1cd18, brief W5 of `tasks/wave-26.md`, base main at 9f77f4f4c.

## What changed

- **One helper:** `src/runners/run-summary.ts`. `runSummary(report)` picks `end`, `failure`, `durationMs`, `fileDurations`, `completedFiles`, `fileErrors` and `startedProjects` of a `RunReport`. An optional field the report lacks stays out. `runLogJson(fields, report)` returns `{ ...fields, report: runSummary(report) }` as one line of JSON with a final newline. New type: `RunSummary`, a `Pick` of `RunReport`, in `src/runners/`. No type in `src/core/types/` changed.
- **Vitest:** `writeRunLog` in `src/runners/vitest/run.ts` writes `report.json` as `runLogJson({ runId }, report)`. The file name and the `{ runId, report }` shape stay, so every reader that took `.report.failure` or `.report.completedFiles` reads the same paths. `vitest.log` is unchanged.
- **node:test:** `run.json` is `runLogJson({ cwd, files }, report)`. `files` keeps each file's `testFile`, `command`, `exit` and `completed`. The per-file `stdout-<i>.log`, `stderr-<i>.log`, `events-<i>.ndjson` and `graph-*` files are unchanged. `squeal why --include-logs` reads only `files[].testFile` of this file (`src/core/status/run-log.ts` `nodeTestLogs`), so it is unchanged.
- **pytest:** `run.json` is `runLogJson({ cwd, batches, notes }, report)`. `batches` keeps each batch's `files`, `command`, `exit` and `session`. `notes` stays.
- Gone from all three: `results`, `observed`, `reads`, `environmentObserved`, `skippedFiles`, `startupFailure`, `withheld`, `focused`. The row's done-when lists the fields to keep, and these are not among them.

## Tests

- `test/runners/run-summary.test.ts` (new): the fields kept, the fields dropped, one line, an optional field left out.
- `test/runners/vitest/run.test.ts`: `report.json` is one line and its `report` equals the summary (before: `report.results` had 1 entry).
- `test/runners/node-test/run.test.ts`: `run.json` keeps `files` in tier order with `command` and `exit`, and its `report` has exactly the six fields this run sets (node:test sets no `startedProjects`).
- `test/runners/pytest/run/run.test.ts`: `run.json` keeps each batch's `command` and `exit`, and its `report` equals `runSummary(report)`.
- `test/daemon/{hold,step-down-lanes,stop-cancel}.test.ts`: not changed. They read `report.failure` of `report.json`, which is still there.
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

node:test, one real run of the `edge` fixture tier (5 files, 7 results) through the new writer: `run.json` is 7,110 bytes on one line. The old format of the same run is 12,631 bytes (43.7% less). Most of what is left is the five command lines and the two file errors. I measured no pytest run: this host's store holds no pytest run log. The pytest run test checks the content.

## `waste.mjs` still works

`research/probes/host-load/waste.mjs` reads `report.json` → `.report` → `completedFiles`, `fileDurations`, `failure` and `withheld`. I ran it on the store copy with two run-log snapshots, the old files and the converted ones: `waste.mjs <store> 72 <runs> 2026-10-23T20:57:07Z`. Both outputs are byte-identical: 888 runs, `runsWithoutReport` 0, `all.files.keptShare` 72.7.

It reads `withheld`, which the summary drops. This changes no count. The Vitest adapter removes a withheld file from `completedFiles` (`dropFiles` in `src/runners/vitest/moved.ts`) before `writeRunLog` runs. So `completed.has(k) && !withheld.has(k)` gives the same answer with an empty `withheld`. The real copy confirms it: 8 runs withheld 22 files, and none of them was in `completedFiles`. The test for a withheld run, `/may have executed bytes/` on `failure`, still reads `failure`. I did not edit `waste.mjs`.

## For the coordinator

- **Comment now partly false (not mine, `src/core/types/check.ts:65`):** `CheckError.stack` says "Kept in the run log and `squeal why`". A file error's stack is still in the run log. A check result's stack is now only in the store and in `vitest.log`'s printed output.
- **Older probes that read dropped fields** (not edited; on new runs they see an empty list): `research/probes/edit-load/work.mjs` (`results`), `research/probes/missed-sharing/earlier.mjs` (`results`), `research/probes/missed-sharing/growth.mjs` (`observed`), `research/probes/stored-nothing/fate.mjs` (`results`, `withheld`), `tasks/011-82/probes/{order,tiers,withheld}.mjs` (`withheld`). `fate.mjs` uses `results` to find a run's failed files (line 114, used at line 162). On runs written after this change it misses a file whose only failure is a failed test; a file error still counts. The host-load README compares `fate.mjs` with `waste.mjs` in its "How `waste.mjs` counts C3" section. `withheld` changes nothing in `fate.mjs`, for the same reason as in `waste.mjs`.
- **Bundles:** `plugins/*/dist` drift (the bundle tests fail, as expected). The coordinator rebuilds.
- **Retention** ("keep 7 days") is W2's prune, not this row.
