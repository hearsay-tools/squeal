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

The gate writes a finished `runs` row for each runner kind with a failed
or unfinished file, with `log_dir` = `<store>/runs/gate-<uuid>`, then copies
the log folder of each of that kind's runs with such a file from its
temporary folder there. The report names the folder in `runs[].log`, and
one stderr line after the verdict names each kept folder. Why:

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
   (`LOG_BUSY_TIMEOUT_MS` in `src/cli/code-gate-log.ts`). Decided by the
   coordinator, 2026-11-12, reply to request 18e35cd8: option A. The
   report must name the path, and a path the report names should exist.
   **This is an exception to D17.5 ("a busy store never delays the
   verdict"): a busy store can delay the verdict by 2 s at most, and only
   when a file failed or did not finish.** The coordinator amends D17.5
   and D3.5 at integration. When the store stays busy past the wait, or
   does not open, the log is not kept and a stderr note says why. Rejected
   option B: copy before the report, write the row after it with the
   keeper's 30 s bound; a gate stopped in that window leaves a folder no
   prune removes, and an exhausted wait leaves the report naming a removed
   folder.
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
   **One kept folder per runner kind, not per run.** The report has one
   `runs` entry per kind, but node:test has one run per project
   (`runners.ts` `openRunners`). So the collector keeps the logs after all
   runs, before the temporary folder goes: per kind, it hands the keeper
   the folders of the runs with a failed or unfinished file, and the keeper
   copies each into one folder. node:test writes only under
   `node-test/<project>/`, so the folders do not clash. The row lists those
   runs' files, its end is the first end that is not `completed`, and its
   duration is their sum. A project whose files all passed adds nothing.
4. **What counts as failed or unfinished:** a file of the run that did not
   complete, or that completed with a failed test or a file-level error
   (`TestFileEvidence.failed`). A run with no report (the budget ended
   before it started) wrote no folder, so it keeps none. Files read from
   the stores or the parts, and files a `prepare` kept from running, did
   not run here and have no log.
5. **The line:** one line in all, after the report, on stderr in both
   modes, so `--json` stdout stays one object. It says how long the logs
   stay (the coordinator, 2026-11-12), from what the row's transaction
   found: with a `worktrees` row for this worktree (a daemon served it),
   `squeal code: log of the failed or unfinished test files, kept 7 days
   (store.retentionDays): Vitest <path>`, the days read from the
   worktree's `squeal.config.json`; with none, `..., kept until the next
   prune, within about 1 h while a daemon of this repository runs (none
   serves this worktree): Vitest <path>`. With two logs, `logs ...: Vitest
   <path>; node:test <path>`. Another worktree's daemon prunes with its own
   `store.retentionDays`; the default is 7 everywhere.

## Spec text proposed for the coordinator

- D3.5, add: "Amended 2026-11-12 (row 020-40, #197): the log folders of a
  runner's runs in which a selected file failed or did not finish are kept
  as one folder per runner, at `<store>/runs/gate-<id>`, named by a
  finished `runs` row of the main store, so the store's prune removes it as
  it removes a daemon run's log (spec 001 D8). A run whose files all passed
  keeps nothing."
- D7 `runs`: "and `log`, the kept log folder, when one was kept (D3.5)".
  The same inputs give the same report "apart from times and kept log
  paths".
- D7's list of later fields: add `runs[].log` (D3.5).
- D17.5, add: "Exception (row 020-40): the run row of a kept log (D3.5) is
  written before the report, waiting at most 2 s for a busy store, and
  only when a selected file failed or did not finish; past the wait the
  log is not kept, with a note."

## Files

- `src/core/code/gate/evidence.ts`: `KeptLog`, `RunLog`, `EndedRun`,
  `keptLogs` (which runs offer their log, one log per kind).
- `src/core/code/gate/collect.ts`: `CollectOptions.keepLog`, called after
  all runs, per runner kind, before the temporary folder is removed;
  `Evidence.logs` (`types.ts`).
- `src/core/code/gate/report.ts`, `runs.ts`: `GateRunReport.log`.
- `src/cli/code-gate-log.ts`: `runLogKeeper` gives `keep` (row, then
  copy) and `retention` (how long the kept logs stay); `keptLogsLine`
  makes the line from both. `src/cli/code-gate.ts` wires them.
- `test/cli/code-gate-keep-kit.ts`: `daemonRuns` leaves out `gate-` runs.
  `code-gate-keep.test.ts` proves a daemon did not run a kept file by
  reading the worktree's `runs`; its gate run leaves a file unfinished, so
  the gate's own log row would list that file.
- Tests: `test/cli/code-gate-log.test.ts` (row, copy, prune after the
  retention days, prune without a registered worktree, busy store keeps
  nothing, the line, plain CLI order, two node:test folders merged),
  `test/code/gate/kept-log.test.ts` (which runs offer a log, one per kind),
  `test/code/gate/collect-kept-log.test.ts` (two failed node:test projects
  give one log the report names), and `test/cli/code-gate.test.ts` (pass keeps nothing; a failed and an
  unfinished file keep a log, named in `runs[].log` with `--json` and in
  the stderr line).

## Done-when, test by test

- A failing file leaves a log the report names: plain,
  `code-gate-log.test.ts` "names the kept log on stderr after the
  verdict"; `--json`, `code-gate.test.ts` "runs a test file whose
  callbacks only moved" (`runs[0].log`, the stderr line, the log holds the
  assertion error).
- An unfinished file leaves a log the report names: `--json`,
  `code-gate.test.ts` "an unfinished loading file never passes", both
  cases (`runs[0].log`, the stderr line, the log says `end: timed-out`).
  The stderr line is the same with and without `--json`.
- A passing run keeps nothing: `code-gate.test.ts` "pass" (`log`
  absent, no `gate-` folder).
- The kept logs fall under the existing prune: `code-gate-log.test.ts`,
  the two prune cases.
- JSON stays one object on stdout: each `--json` case parses the whole
  of stdout; the line goes to stderr.
- Verdict and exit unchanged: the same cases keep their verdict and exit
  asserts; `code-gate-log.test.ts` checks exit 3 in plain mode.

## For whoever continues

- The coordinator amends D3.5, D7 and D17.5 from "Spec text proposed"
  above at integration; this row does not edit the spec.
- `Evidence.logs` holds at most one log per runner kind, so `runsOf`'s
  `find` by kind is exact. A new runner kind with several runs whose log
  folders can clash must write them under a folder of its own per run, as
  node:test does per project, or the merge overwrites files.

## R1 repair (review 0.1.462 B1, B2; `tasks/wave-15.5.md`)

Commit `6b0b40cf7`, in `src/cli/code-gate-log.ts` and
`test/cli/code-gate-log.test.ts`. No type change; `runLogKeeper` and
`LogKeeper` keep their shape.

- **B1:** `openFor` opens the main store inside the keeper's handled
  failure path. A busy or failed open, which throws (for example another
  opener holds the write lock of a new store's schema, so `migrate` times
  out), gives one note, `<Runner> run: its log was not kept: the store did
  not open: <why>`, and `null`. Only a connection that opened is closed.
- **B2:** `copyOwned` copies, then reads the run row again on the same
  connection, with no transaction open during the copy. When a prune
  removed the row, the copy is removed with the note `the store's prune
  removed its run before the copy ended`. When the read fails, the copy is
  removed with `its run was not read after the copy: <why>`. Prune commits
  the row delete before it removes the folder (`prune.ts` `dropRuns`), so
  once the read finds the row, a later prune removes the whole copy.
- `finishRun` holds the row write unchanged: start and finish in one
  transaction, before the report, with the 2 s busy bound.
- **Decision the spec did not settle:** the 2 s bound stays per SQLite
  step (the connection's busy timeout), not one total deadline. In the
  normal case only the row write can wait. While a store is being created
  the open waits at most 2 s in `migrate`, then the log is not kept.

### Tests

In `test/cli/code-gate-log.test.ts`; each was red before the fix and green
after it (Squeal, revisions 1 and 3; still passing at revision 6):

- "keeps no log, says why once, and the JSON report, verdict and exit
  stay, while another opener creates the store" (B1, through the CLI):
  before the fix exit 2, after it exit 3, verdict `incomplete`, one JSON
  object, no `runs[].log`, one note, no kept folder.
- "removes the copy, and says why, when a prune removed its row before the
  copy" (B2): a real `store.prune` runs just before the first copy.
- "removes the copy, and says why, when its row cannot be read after the
  copy" (B2, the read's error path).

The test file mocks `node:fs` so a test can run a hook just before the
keeper's `cpSync`. Every other `node:fs` function passes through. The file
is 312 lines.

### Checks

- `pnpm run lint`: pass ("Checked 3295 files … No fixes applied").
- `pnpm run typecheck`: pass (exit 0).
- `squeal status --wait 60000 src/cli/code-gate-log.ts
  test/cli/code-gate-log.test.ts` at revision 6: `code-gate-log.test.ts`
  passes, with 7 other files that read the source.
- **Not run:** the other 236 test files that read the source (among them
  `test/cli/code-gate.test.ts` and the `code-gate-keep*` tests). Squeal
  queued them, and they waited for CPU on a full host (up to 24 of 24 cores
  in use) through five waits. The coordinator (request 5d4d3c50) said not
  to wait: the candidate's CI runs the full suite. No build, no full suite.
