# Row 020-40: a failed gate run keeps its log (#197)

Brief: `tasks/wave-14.md`, "020-40". The human, 2026-11-12: "Keep the log file".

## Where the daemon keeps its run logs, and what the gate reuses

- A daemon run logs to `<git-common-dir>/squeal/runs/<run-id>` (spec 001 D1;
  `storePaths(commonDir).runsDir`, `scheduler/tiers.ts` `newTier`). Its
  `runs` row (`store.runs.start`/`finish`) records that folder in `log_dir`.
- Nothing lists the `runs/` folder. The prune (`store/prune.ts`
  `dropRuns`) deletes a `runs` row, and with it its `log_dir`
  (`removeRunLog`, only below `<store>/runs/`), when no result, kept
  replaced failure or standing UNKNOWN names the run, and either its
  worktree has no `worktrees` row or it ended before the cutoff
  (`store.retentionDays`, 7 by default). The daemon prunes 60 s after its
  start and then every hour (`daemon/lifecycle.ts`).
- So one prune rule covers a folder only when a `runs` row names it. A
  folder with no row is never removed.

## Choice

The gate writes a finished `runs` row for each run with a failed or
unfinished file, with `log_dir` = `<store>/runs/gate-<uuid>`, then copies the
run's log folder from its temporary folder there. The report names the
folder in `runs[].log`, and one stderr line after the verdict names each
kept folder. Why:

- It is the daemon's place and the daemon's prune: nothing new to prune,
  nothing in the tracked tree (the store is under the git directory).
- The row comes first. If the row write fails, nothing is copied, so no
  folder is left that no prune removes. If the copy fails after the row,
  the folder is removed and the row stays; the prune's `rmSync` with
  `force` handles a missing folder.
- The row is inserted and finished in one transaction, so no reader sees
  it open: `ps` (`OPEN_RUNS`) and `runs.inFlight` read only rows with no
  `end_state`. Its id starts with `gate-`, as the keeper's result
  provenance does (`keep.ts`); the two ids differ, and no result names
  the log's run, so `UNREFERENCED_RUN` holds.

## Decisions the spec did not settle (my defaults)

1. **When the row is written: before the report, with a 2 s busy wait**
   (`LOG_BUSY_TIMEOUT_MS` in `src/cli/code-gate-log.ts`). The report must
   name the path, and a path the report names should exist. So a busy
   store can delay the verdict by 2 s at most, and only when a file failed
   or did not finish. D17.5 keeps the result writes after the report for
   the same reason; this wait is bounded and smaller. When the store stays
   busy past it, or does not open, the log is not kept and a stderr note
   says why. Alternative: copy before the report, write the row after it
   with the keeper's 30 s bound; a gate stopped in that window leaves a
   folder no prune removes, and an exhausted wait leaves the report naming
   a removed folder.
2. **A worktree with no daemon.** No `worktrees` row exists until a daemon
   registers the worktree, so its gate log goes at the next prune of any
   daemon of the same repository (at most an hour, or 60 s after a daemon
   starts). That is the existing rule for a removed worktree's runs. In CI
   no daemon runs, so the log stays for the job. The gate does not
   register the worktree: that is a daemon's presence record.
3. **What is copied: the whole run log folder.** After the records are
   mapped, the coverage payloads are already deleted (`mapper.ts`
   `removePayload`, node:test `coveragePayloads`), so what is left is the
   adapters' logs: Vitest's `vitest.log` and `report.json`; node:test's
   `node-test/<project>/` with `stdout-<i>.log`, `stderr-<i>.log`,
   `events-<i>.ndjson`, `run.json` and module graphs. No byte limit,
   as a daemon run's log has none.
4. **What counts as failed or unfinished:** a file of the run that did not
   complete, or that completed with a failed test or a file-level error
   (`TestFileEvidence.failed`). A run with no report (the budget ended
   before it started) wrote no folder, so it keeps none. Files read from
   the stores or the parts, and files a `prepare` kept from running, did
   not run here and have no log.
5. **The line:** one line in all, after the report, on stderr in both
   modes, so `--json` stdout stays one object: `squeal code: log of the
   failed or unfinished test files, kept until the store's prune: Vitest
   <path>` (with two, `logs ...: Vitest <path>; node:test <path>`).

## Spec text proposed for the coordinator

- D3.5, add: "Amended 2026-11-12 (row 020-40, #197): the log folder of a
  run in which a selected file failed or did not finish is kept at
  `<store>/runs/gate-<id>`, named by a finished `runs` row of the main
  store, so the store's prune removes it as it removes a daemon run's log
  (spec 001 D8). A run whose files all passed keeps nothing."
- D7 `runs`: "and `log`, the kept log folder, when one was kept (D3.5)".
  The same inputs give the same report "apart from times and kept log
  paths".
- D7's list of later fields: add `runs[].log` (D3.5).

## Files

- `src/core/code/gate/evidence.ts`: `KeptLog`, `RunLog`, `keptLog` (which
  runs offer their log).
- `src/core/code/gate/collect.ts`: `CollectOptions.keepLog`, called after
  each run's evidence, before the temporary folder is removed;
  `Evidence.logs` (`types.ts`).
- `src/core/code/gate/report.ts`, `runs.ts`: `GateRunReport.log`.
- `src/cli/code-gate-log.ts`: `runLogKeeper` (row, then copy) and
  `keptLogsLine`; `src/cli/code-gate.ts` wires both.
- Tests: `test/cli/code-gate-log.test.ts` (row, copy, prune after the
  retention days, prune without a registered worktree, busy store keeps
  nothing, the line, plain CLI order), `test/code/gate/kept-log.test.ts`,
  and `test/cli/code-gate.test.ts` (pass keeps nothing; a failed and an
  unfinished file keep a log with `--json`).
