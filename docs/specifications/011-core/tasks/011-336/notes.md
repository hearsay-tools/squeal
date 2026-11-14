# Row 011-336: tests wait for their writers before they remove a folder

Worker 398af59b, 2026-11-14. Brief: `../wave-87.md` W1. Research: `../../research/enotempty-cleanup.md`. Tests only: no `src/**` change.

## What each step changed

1. **`removeTree(dir, { timeoutMs, intervalMs, remove })`**, `test/helpers/remove-tree.ts` (commit `fbdb7e7b1`). It repeats the whole `rmSync(dir, { recursive: true, force: true })` until `dir` is gone. It also repeats when a removal succeeded but a writer made `dir` again. It retries the codes Node's own `rmSync` retries (`EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, `EPERM`) and throws any other code at once. At the deadline (10 s by default) it fails with the attempt count, the last error and up to 20 entries that are left. It is synchronous, a drop-in for `rmSync`; the pause between attempts is `Atomics.wait`, which uses no CPU. `remove` is a test seam.
   - `test/helpers/remove-tree.test.ts`: a second process adds files by path for 300 ms (as `rmsync-retry.mjs`, with 500 files instead of 20,000); plus injected failures: a retried `ENOTEMPTY`, a folder made again, an `EACCES` thrown at once, a deadline that names what is left.
   - The writer test is discriminating on Node 22.19: the same setup with one plain `rmSync` failed `ENOTEMPTY` 5 of 5 (throwaway script, not committed).
2. **node:test run test** (`test/runners/node-test/run.test.ts`, commit `cb662ee01`). "reports nothing of a run stopped after the checkout holding its store went" now moves the checkout away with `renameSync(checkout, gone)`, in one step, then aborts the run. After `await running` it removes `gone` with `removeTree`. After the rename, the run's appends by path (`graph-1-<pid>.ndjson`, `events-1.ndjson`) meet a missing folder and add nothing; open file descriptors write into `gone`, which is removed later. The test's assertions are unchanged.
3. **OpenCode** (commit `3e0dd01a3`).
   - `test/helpers/opencode.ts`, `runOpenCode` (ownership confirmed by the coordinator, 2026-11-14): a new step `ended(child, options)` sends SIGKILL to OpenCode's process group, waits until no process of it is left (at most 10 s, no failure), then awaits the new optional `OpenCodeRunOptions.settle()`. It runs on success after OpenCode's exit and before the run is returned, and on failure before the removal. On failure a `settle` rejection is dropped, because the run's own error is the one to report. Before this change the error path removed the folder first and killed OpenCode later in `finally` (research finding 3b). `cleanup()` and the error path remove with `removeTree`; the `maxRetries` call is gone.
   - `test/harness/opencode/real.ts`: `squealOpenCode` passes `settle: () => awaitBridges(dist)`. `awaitBridges` finds the processes whose command line holds `<dist>/hooks/` (or its real path), takes their process groups (each bridge is a group leader because of `detached: true`), waits for them for 30 s (`BRIDGES_LEAVE_MS`), kills what is left, and then fails naming the killed processes, as `awaitRunnerHosts` does.
   - `test/helpers/process-groups.ts` (new, used by both): `groupsRunning(matches)`, `membersOf(groups)`, `awaitGroups(groups, graceMs)`. Zombies count as gone. `process.kill(-group, 0)` decides first; `ps` is read only while a group still answers. `test/helpers/process-groups.test.ts` covers find by command line, a child that outlives its leader, a kill after the grace, and a group that is already gone.
   - `test/harness/opencode-dispose.test.ts`: no change needed.

## Who calls `runOpenCode`

- Through `squealOpenCode`, so with `settle` = `awaitBridges`: `test/harness/opencode-abort.test.ts`, `opencode-continued.test.ts`, `opencode-dispose.test.ts`, `opencode-evidence.test.ts`, `opencode-hooks.test.ts`, `opencode-wake.test.ts`.
- Directly, with no `settle`: `test/harness/opencode-fixture.test.ts`, `test/harness/opencode/fresh-store.test.ts`, and `test/e2e/opencode-fixture.ts` (e2e, outside Squeal's coverage; not run here). For these, three things change. After OpenCode exits, the run waits until its group is gone; before, the SIGKILL in `finally` had no wait. The removal repeats as a whole. The error path kills OpenCode and waits before it removes. They pass no `settle`, so nothing else waits.

## Runs

Private `HOME` and `TMPDIR` under `/tmp/w336-*`; `env -u PLUGIN_ROOT -u PLUGIN_DATA`; `node node_modules/vitest/vitest.mjs run <file>` under each nvm Node. Host load average 8–13 during the runs, from other sessions.

| Test | Node 22.19.0 | Node 24.15.0 | Node 26.13.0 |
|---|---|---|---|
| `test/helpers/remove-tree.test.ts` (5 tests) | 1 of 1 passed | 1 of 1 | 1 of 1 |
| `test/helpers/process-groups.test.ts` (4 tests) | 1 of 1 | not run | 1 of 1 |
| node:test run test, the one test (`-t`) | 5 of 5 | 3 of 3 | 3 of 3 |
| `test/runners/node-test/run.test.ts`, whole file | 1 of 1 (15 tests) | not run | not run |
| `test/harness/opencode-dispose.test.ts`, whole file (3 tests) | 3 of 3 | 2 of 2 | 2 of 2 |

During the 7 dispose runs, a temporary log line in `awaitBridges` (not committed) recorded what `settle` found. In each file run, the first two OpenCode runs still had one bridge group running after OpenCode's group was gone, and `settle` waited 921–996 ms for it to end. In file order these are the "never released" test and the "drops the old turn's report" test, the one CI failed. The third run (the abort test) had none. No bridge was killed. Before this change, the folder removal ran during that second.

Squeal: all affected test files current with no known failures at revision 14 (11 files: the 8 OpenCode test files, `test/helpers/opencode.test.ts`, `test/version-sensitive.test.ts`, `test/helpers/process-groups.test.ts`) and at revision 16 after the temporary log line was removed. `pnpm run lint` and `pnpm run typecheck` pass. No full suite was run (host policy).

## The eight other files with `maxRetries`

They keep it, as the brief says. Each is a candidate for `removeTree` where a writer can outlive its test; the synchronous ones have the same gap on Node 22:

- `test/store/helpers.ts:30`
- `test/code/helpers.ts:27`
- `test/lint/helpers.ts:29`
- `test/lint/oxlint/helpers.ts:29`
- `test/lint/provider/helpers.ts:66`
- `test/policy/repository-inputs.test.ts:108`
- `test/e2e/harness.ts:480–481`
- `test/keys/validity/self-test.test.ts:84` (`fs/promises` `rm`, callback form; not examined)

## Open, for whoever continues

- Research question 3a remains open: which process made a new entry directly in `squeal-opencode-*` on CI. This change waits for the bridges and repeats the whole removal. If an unknown writer keeps adding entries for 10 s, `removeTree` now fails and names what is left, which is the evidence 3a needs.
- `cleanup()` stays synchronous, and callers run it in `afterEach` with Vitest's 10 s hook timeout. A removal that takes all of `removeTree`'s 10 s would also exceed that hook timeout, as the old ~10.5 s of `maxRetries` did. Once the writers are awaited, the removal succeeds at its first attempt.
- A bridge that OpenCode forked but had not yet exec'd when OpenCode died has OpenCode's command line, not `<dist>/hooks/`, so `awaitBridges` cannot see it. The window is microseconds, and `removeTree` covers a short writer.
- CI is the final evidence: a Node 22 shard where both tests pass, then 20 main runs without this `ENOTEMPTY`.
