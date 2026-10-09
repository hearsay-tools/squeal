# 001-188 notes: `squeal why` names the run that produced the shown result

Repair of `reviews/wave-13i.md` B4, S2, S3, N1.

## Seam map

- `src/core/status/why.ts`: `report` reads every stored result of the check (`listForCheck` unbounded) and lists only the newest `WHY_RESULT_LIMIT`; the shown result and the held failure are found in the whole set. `currentKey` is this worktree's key for the check's test file. `held` lists the checks held under this worktree's current keys (`heldFailure` per row, `failureKeysOnce`), which name-fragment resolution adds to the known states (N1).
- `src/core/status/run-log.ts`: `shownResult(worktreeId, knownState, key, results, held)`. A current state: the row at the current key, if its outcome, commit and producer match the state (own: this worktree at `observedAt`; inherited: the origin worktree). A stale or pending state: the only row that matches; none when several do. No known state: the held failure. `runLogOf` reads a node:test file's own logs before `vitest.log` (S3).
- `src/core/run-log.ts`: `consolePrefix` writes a label holding `: `, a quote, a backslash or a control character as a JSON string, and an untagged line as `[stdout]: `; `parseConsoleLine` reads it back, and the reader keeps lines whose label equals the file's exactly (S2). Common labels are written as before, so `src/runners/vitest/reporter.ts` and its test did not change.
- node:test logs: `runs/<id>/node-test/<encodeURIComponent(project)>/run.json` lists the files in order; the `i`th has `stdout-<i>.log` and `stderr-<i>.log` (`src/runners/node-test/run/run.ts`, read only, not edited).

## Type changes (additive)

- `WhyRunLog.state` gains `node-test`; `WhyRunLog.stderrPath?` names the stderr log with it. For `node-test`, `path` is the file's stdout log.
- `WhyRunLog.console` is an empty console (not `null`) for `not-vitest` with `--include-logs`, so the renderer says "No console of <file> was captured in this run."
- `WhyReport.runLog` is `null` also when the producer is not identifiable; the text says `Run log: unknown, ...` instead of `Run log: none, ...`.

## Decisions the spec did not settle

- A stale or pending state names a run only when exactly one stored row fits it. Several keys from the same worktree, commit and outcome (an inherited state, or one revision with two keys) name none rather than guess. No new stored provenance (a run id on the known state) was added: that is a schema change outside this row.
- Replaced same-key rows: a current own state whose row at its key now has another revision names none.
- node:test console is printed stdout first, then stderr; the two files do not record interleaving.

## Remaining

- A known state carrying its result's run id would name the producer of every stale state; that needs the state/sink owner and a schema change.
