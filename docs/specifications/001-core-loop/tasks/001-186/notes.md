# 001-186 notes: `status --wait` ends when the edit's own files are done

## Seam map

- `src/core/scheduler/files.ts` `FileState.keyedAt`: the revision whose change last moved the file's key. Set only through `Ledger.settle`'s optional `keyedAt` (`ledger.ts`), passed by `rekeyContent` (`revision.ts`, the revision's number) and by a revision's refinement (`refinement.ts` `applyRunnerPart`, from `runner-work.ts` `#refine`'s `refined`). The baseline, a backlog, runs, a runner-only refinement and `refreshInstall` pass none. A future re-key path that belongs to an edit (003-43's environment-growth discard) passes its revision the same way.
- `Scheduler.rekeyedSince(after, upTo)` names `{ testFile, revision }`; `Scheduler.refined()` resolves once the runner work queued before it is applied (`RunnerWork.afterTier` with a no-op).
- Daemon: `SyncRequest.after` (optional); `Daemon.#requestSync` awaits the pass, then `refined()`, then answers with `SyncResponse.rekeyed`. The desk messages carry a `SyncAnswer`. Without `after` the answer is 001-185's.
- CLI: `src/cli/status-wait-edit.ts` (`lastHeard`, `editWindow`, `heldPending`, `splitNews`), `src/cli/status-wait-lines.ts` (the first line), `src/cli/status-wait.ts` (the loop). The session is `CLAUDE_CODE_SESSION_ID` or `CODEX_SESSION_ID`.

## The window's first revision

"Since the consumer last heard" is the oldest revision told to a consumer of the wait's session (`toldRevision`), else the revision current when the wait started. It is exclusive, except when no revision after it re-keyed a file: the PostToolBatch after an edit may tell the edit's revision (watcher batch 100 ms, hook ~100 ms) before its result, and a told revision before a later edit is often an environment change whose backlog is not the edit's. Remaining gap: a told edit revision followed by another revision that re-keys a file (two edits in separate tool calls, the first told) drops the first edit's files.

## Not settled here: an edit does not cut short the tier it shares with a backlog

Probes with a real daemon (scratch repo under `test/fixtures/vitest/.tmp`, at 943b194 = 0.1.76 and on this branch, load ~10 on 24 CPUs): after a `vitest.config.ts` edit re-keyed `test/mod.test.ts` and a minute of backlog (one 60 s test, 60 tests of 1 s, or 30 files of 2 s, also with `runner.backlogTierSize: 1`), a neutral edit to `src/mod.ts` stored its revision within 2 s, but `mod.test.ts`'s result came only when the backlog's work ended (~60 s), every time. So the wait, which now returns 0.5 s after that result, still waited a minute. `cancelsBacklog` should cancel the backlog tier here (the edit queues recent work in its lane, and `src/mod.ts` is an input of the tier). Lessons (c) measured 7.8 s for this case at 0.1.68 on this repository's own backlog. Not investigated further: scheduler territory (001-184, 001-187). The real-daemon test uses a slow file in its own lane instead (`test/integration/status-wait-edit.test.ts`).
