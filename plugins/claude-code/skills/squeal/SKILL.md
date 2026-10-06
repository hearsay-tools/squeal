---
name: squeal
description: Use before claiming a coding task is complete, done or passing in a repository that uses Squeal (it has squeal.config.json or SQUEAL messages appear), and when a SQUEAL message reports a failing check. Explains squeal status, squeal why and squeal run --all, and how to read pending, stale, unknown and inherited counts.
---

# Squeal

Squeal runs the project's Vitest tests in the background while you edit. It reports only changes: a check that went `PASS -> FAIL`, `FAIL -> PASS`, or failed differently. Those reports arrive as system reminders that start with `SQUEAL ·`, after a tool call or when you are idle. No report means nothing changed while a daemon validates. It does not mean everything passes.

A header that says `No daemon has validated since <time>` (or `No daemon is running`) means nothing is being validated: the results are as of the revision it names, and no report will come until a daemon runs again. The hooks start one; `squeal status` shows whether it is back. A report says once when the daemon stops and once when it validates again.

You do not need to run the test suite yourself to learn the state. Pull it.

## Before you say a task is complete

Run `squeal status` and read it. Claim only what it shows.

```text
Revision: 187
Known failures: 0
Affected checks: 47 passed, 3 running, 12 queued
Full-suite checkpoint: none completed at revision 187; last completed at revision 170
```

- **Known failures: 0** with pending checks means "no known failures yet". Say that, not "all tests pass".
- If checks are pending, the current revision is not fully validated. Wait and run `squeal status` again, or say what is still pending.
- If no full-suite checkpoint completed at the current revision, say so. `squeal run --all` requests one. A checkpoint is a request, not a coverage state: without one, current results are still current.

`squeal status --json` gives the same snapshot as a versioned JSON object.

## Reading the counts

Every SQUEAL message and `squeal status` carry a header like `Revision 12: 40 current, 3 pending, 1 stale, 2 unknown.`

- **revision**: Squeal's counter of workspace changes. It is not a git commit.
- **current**: the result was produced from exactly the files as they are now.
- **pending**: a run for the current files is queued or running. The outcome shown is the last one known.
- **stale**: a result exists, but for older file contents. Nothing is queued for it yet.
- **unknown**: no trusted result: never run, or the runner crashed or timed out (the reason is in the message).
- **Test files without checks**: test files that have not produced any check yet, counted as pending or unknown.
- **The daemon has not listed this worktree's test files yet**: nothing has been looked at, so zero counts are not complete. Status prints `Affected checks: none counted` until the listing is done.
- **inherited**: a current result reused from another worktree whose files were byte-identical. It is as current as your own. The header says `Inherited: 30 of 40 current.`; status names the worktree and commit it came from.

## Looking into one check

`squeal why "<check name>"` prints the history and provenance of one check and the path to its last run log. Use the name exactly as a SQUEAL message or `squeal status` printed it, for example:

```sh
squeal why "src/math.test.ts > math > adds"
```

Any unique part of the name also works. The run log holds the full output; SQUEAL messages carry only the first error line and its location.

## Explicit checkpoint

`squeal run --all` queues every test file that has no result for the current files (`--force` queues all of them). Completion shows in headers and `squeal status` as `Full-suite checkpoint: completed at revision <current>`. Policy `stop.requireFullSuite` can require one before you stop.

## When an edit is denied

With policy `interrupt.onRegression` on (the default), the first file edit after a new regression is denied once. The denial lists the failing checks and says the edit was not applied. The same edit can be re-issued; the same regression does not deny twice.

## Policy keys

`squeal.config.json` at the repository root, committed. Every key is optional; `squeal init` writes all of them with their defaults.

| Key | Default | Meaning |
| --- | --- | --- |
| `interrupt.onRegression` | `true` | Deny one edit when a check newly fails. |
| `stop.blockOnKnownFailures` | `false` | Keep the agent going at Stop while failures exist at the current revision. Failures whose re-run is still pending are named as pending, with the revision they last failed at, and do not block. Blocks once per stop. |
| `stop.requireFullSuite` | `false` | Keep the agent going at Stop until a full-suite run completed at the current revision. Blocks once per stop. |
| `stop.waitMs` | `0` | At Stop, wait this long for pending checks of the current revision. Capped at 1500 ms by the 2 s hook timeout. |
| `baseline.onStart` | `"lookup-then-run-missing"` | On daemon start, reuse stored results and run the rest, or `"lookup-only"`. |
| `inputs` | `[]` | Extra files (globs) a test file depends on, for fixtures read at runtime. |
| `env.allowlist` | `[]` | Environment variables whose values are part of a result's identity. |
| `runner.tierSize` | `4` | Test files per run. |
| `runner.timeoutMs` | `600000` | Limit per run; `null` for none. |
| `runner.maxConcurrentRuns` | `1` | Runs at a time. |
| `daemon.idleExitMinutes` | `60` | The daemon exits after this long with no registered session. |
| `store.retentionDays` | `7` | Results for file contents no worktree has any more are dropped after this many days. |
| `store.maxSizeMb` | `null` | Size cap of the store; `null` for none. |
