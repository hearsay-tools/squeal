# 019-15 notes: `squeal run <group>` and the `run-group` request

Worker f8ddc503, 2026-11-03. Residue for 019-14 (Stop's request), 019-16 (texts) and the step 2b integration.

## Seam map

- `src/core/types/daemon.ts`: `RunGroupRequest { type: "run-group", group }`, `RunGroupStatusRequest`, `RunGroupResponse` (`requestId`, `group`, `requested`, `unknown`, `error`). All additive, in the `DaemonRequest` and `DaemonResponse` unions.
- `src/core/daemon/protocol.ts`: parses `run-group` (`group` a non-empty string) and `run-group-status`. `run-slow` is unchanged.
- `src/core/daemon/run-group.ts` (new): `GROUP_NOT_SUPPORTED`; `requestGroup(scheduler, group)`, which calls `Scheduler.requestGroup`; `groupRequests(requestGroup, max)`, the socket's remembered requests (start, status); `requestGroupRun(socketPath, group, timeoutMs = 2000)`, the client helper.
- `src/core/daemon/handlers.ts`: `HandlerContext.requestGroup?`; the `run-group` and `run-group-status` cases call `groupRequests`.
- `src/core/daemon/desk.ts`, `front-desk.ts`, `desk-messages.ts`: `DeskEvents.requestGroup?`; the worker posts `{ type: "run-group", id, group }`; the main thread answers `run-group-result` (`requested: null` with `error: null` is an unknown group).
- `src/core/daemon/daemon.ts`: `#openDesk` passes `requestGroup`, and `#requestGroup` mirrors `#requestSlowSuite`. This is the coordinator's agreement of 2026-11-03 (request 46c3ac22), for this edit only.
- `src/cli/run.ts`: `runCommand` calls `groupArgs(lanes, wait)` after `takeAllWait`. When the words name a group, `runGroupCommand` takes over. `inStore` moved to `run-lanes.ts`.
- `src/cli/run-group.ts` (new): `groupArgs`, `runGroupCommand`, the request and receipt lines, and the `run-group-status` poll.
- `src/cli/run-group-wait.ts` (new): `waitForGroup`, the `--wait` verdict over the group's own test files.

## For 019-14: the marked line

```ts
// Row 019-15: run-group for <group> goes here.
await requestGroupRun(record.socketPath, group.name, Math.min(STOP_SLOW_REQUEST_MS, left));
```

`requestGroupRun` never rejects. It returns the daemon's first answer, or `null` when no daemon answered within `timeoutMs`. An older daemon's answer is `{ ok: false, error: 'unknown request type "run-group"' }`. Stop can ignore the answer, as `sendRunSlow` does. The default `slow` group keeps `run-slow` (the brief).

## Decisions the spec did not settle

1. **Usage.** The constant `USAGE` in `run.ts` is unchanged, so every `run` and `run --slow` error is byte-identical (`test/cli/run-slow-unchanged.test.ts`). Only a group's errors add the line `squeal run <group> [--wait [<ms>]]`. `squeal --help` (`src/cli/main.ts`) and `README.md` do not name `run <group>` yet. This row does not own them.
2. **Parsing.** A word with no lane flag names a group. With a lane flag, a word stays `unknown argument "<word>"`, as before. Another flag with a group (`--force`) and two words exit 2.
3. **Unknown name.** The CLI checks the name against the policy on disk (`groupView(readPolicy(root))`) before it asks the daemon. Exit 2, and the list in ownership order: configured groups, then `tests` and `slow`. When the daemon's policy in force has no such group (`unknown: true`), the CLI says the daemon reloads `squeal.config.json` when it sees the change.
4. **Lint group.** Exit 2: `Scheduler.requestGroup` queues test files only. The message points to `squeal lint`.
5. **Failures with `--wait`** print `No verdict: <why>` and exit 3, as `run --all --wait` does: exit 1 there means known failures. Without `--wait`, they go to stderr and exit 1, as `run --slow` does. An older daemon's unknown-request answer and a scheduler without `requestGroup` both read `GROUP_NOT_SUPPORTED`.
6. **`--wait`** without milliseconds waits with no bound, as `run --all --wait` does. `--wait <ms>` is one budget for the scheduler to take the request and for the results.
7. **The verdict** reads the group's listed test files only. The wait ends when none of them is pending. A new revision does not end it, unlike `run --all`: a group at `edit` runs again, and the wait follows. A group at a later moment leaves an edited file stale, so the wait ends with no verdict and counts the stale files. A group with no listed test file has no verdict (exit 3).
8. **`squeal run slow`** sends `run-group` with `group: "slow"` and prints the group lines, not `Slow tier requested ...`. `run --slow` keeps `run-slow` and its lines.
9. **Request line.** `Group <name> requested at revision <n>: <k> test files queued; they run now.` With `after`, the end is `they run once <groups> has (have) nothing pending.` When nothing is queued, the line is `No test files of group <name> to run at revision <n>: the group has none or all are current.`

## Tests

- `test/cli/run-slow-unchanged.test.ts`: recorded before the change. `run --slow` lines, the `run-slow` request, and every `run` usage error, byte for byte.
- `test/daemon/run-group.test.ts`: parsing, the handler, the remembered requests, `requestGroup`, the front desk on the main thread and in its worker thread, and `requestGroupRun`.
- `test/cli/run-group.test.ts`: request lines, unknown names, a lint group, flags, an older daemon, no daemon, a request not taken.
- `test/cli/run-group-wait.test.ts`: the verdict codes 0, 1 and 3, the deadline, stale files, an empty group, a daemon gone.
- `test/cli/run-group-daemon.test.ts`: a real daemon. `squeal run e2e --wait` runs a group at `stop` now and exits 1 on its failing file. The fixture's other files are not run and do not count.

## Found, not fixed

- Five functions were over the complexity bound of 20 before this row, and each new case made them larger. Their counts now: `parseRequest` 51, the `createHandlers` handler 40, `inWorker`'s listener 27, the front desk's `receive` 30, `runCommand` 28.
- `handlers.ts` (354 lines) and `desk.ts` (372) were over 300 lines before this row.
