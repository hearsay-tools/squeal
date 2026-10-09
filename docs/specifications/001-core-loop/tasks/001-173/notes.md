# 001-173 notes: `squeal why` names the run log

## Seam map

- `src/runners/vitest/reporter.ts`: `onUserConsoleLog` gets `log.taskId`; `onInit` keeps the `Vitest`, and `vitest.state.getReportedEntityById(taskId)` gives the module (a test or suite id resolves through `.module`). `RunCollector.console` writes every line of the output as `[stdout] <file>: <text>`, `<file>` being `testFileLabel(project, path)` (`[web] src/a.test.ts` with a project). A line from no requested file keeps `[stdout] <text>`.
- `src/core/run-log.ts`: the one definition of that line format (`consolePrefix`, `testFileLabel`, `VITEST_LOG`), shared by the reporter (writer) and `src/core/status/run-log.ts` (reader).
- `src/core/status/run-log.ts`: `shownResult` picks the result behind the known state (own: this worktree's newest, preferring the state's outcome; inherited: the origin worktree's at the origin commit; no known state: the newest result). `runLogOf` names `<logDir or runsDir/run-id>/vitest.log` and its state: `present`, `pruned` (no file and no run dir, or the file went before the read), `not-vitest` (a run dir without `vitest.log`).
- `src/core/status/why.ts`: `WhyReport.runLog` (additive); `StatusContext.commonDir` (additive) for the runs dir when a run record is pruned.
- `src/core/status/format-why.ts`: the `Run log:` block replaces the old `Last run log: <dir>` line.
- `src/cli/main.ts`: `--include-logs` for `why` only.

## Decisions the spec did not settle

- Which result is "shown": the one behind the known state, as above, not `results[0]` (the newest from any worktree, which the old `Last run log` named and which may be a worktree this one never inherited from). The per-result `log:` lines still list every result's run directory.
- The cap is 200 lines (`WHY_LOG_LINE_LIMIT`), the first 200, with "first 200 of N lines".
- D7 says `why` prints "the path to its last run log". Proposed amendment (spec is not this row's file): "and the `vitest.log` of the run that produced the result its known state shows, which covers that whole run; `--include-logs` adds that log's console lines tagged with the check's test file, at most 200."

## Remaining slice

- `node:test` checks: their output is per file under `runs/<id>/node-test/<project>/stdout-<i>.log` (index in `run.json`). `why` now says `not-vitest` and names the directory; `--include-logs` prints nothing for them. Reading `run.json` to pick the file's `stdout`/`stderr` logs would close it.
- Console lines from before the reporter could resolve a task (none seen in tests) stay untagged and are left out of `--include-logs`.
