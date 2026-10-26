# 011-229: tests reach the two uncovered error paths of the full integrity check

Wave 46 W4, slice. Baseline `eec505f3b`. Test files only; `src/` is unchanged.

## Cause

Squeal's coverage report on 0.1.329 named two functions of 011-226 that no in-process test reached:

- `FullCheckOwner`'s constructor `catch` (`src/core/daemon/full-check.ts:186-188`). It logs an error that `#start` throws past its guarded claim. In practice that is `run` (default `runFullCheck`) throwing at once, for example `spawn` throwing for E2BIG or an invalid argument.
- The child's `error` handler (`full-check.ts:83`). Node emits `error` on the child when the spawn fails at run time (ENOENT, EACCES, EAGAIN, EMFILE, ENFILE). The earlier tests always spawned a real Node, so this event never fired.

No seam was needed. Both paths can be reached from the tests.

## The tests

`test/daemon/full-check.test.ts`, "the full check's error paths (row 011-229)":

- "logs a start that throws, and its stop gives the claim back". `run` throws `spawn E2BIG`. The log is exactly `full integrity check failed: Error: spawn E2BIG`. After the stop, the claim row is empty.
- "reports a process that cannot spawn as unrun, gives the claim back, and a later start claims". The real `runFullCheck` runs while `process.execPath` points at a missing file. This is the case where the Node install the daemon runs from was removed while the daemon serves. The swap is synchronous and is restored in `finally`, so nothing else in the worker sees it. The check has no pid. Its outcome is exactly `{ unrun: "spawn <missing> ENOENT" }`, which is different from the `close` path's "ended with code" text. The claim is given back, and the next start claims at `T + 1` and runs its check.

`test/daemon/full-check-daemon.test.ts`, "logs a full check whose start throws and goes on serving (row 011-229)". A real in-process daemon whose mocked `run` throws (new `checks.fail` flag) logs the line. After that it still answers `ping` (phase `ready`) and `sync`. `start()` now takes an optional `log`.

## Evidence

Each test fails when its path is removed. Both breaks were in `src/core/daemon/full-check.ts`, run with `npx vitest run test/daemon/full-check.test.ts -t "error paths"`, and reverted with `git checkout`:

- Constructor `.catch` removed: 1 failed, 1 passed. Vitest reports an "Unhandled Rejection: Error: spawn E2BIG" from `FullCheckOwner.#start`.
- `child.on("error", …)` removed: 1 failed, 1 passed. Vitest reports an unhandled `ENOENT` error from `spawn …/no-node`. In a daemon, that is an uncaught exception.

The daemon-level test was not run against a break. Without the `catch`, the line is never logged, so its `until` fails by construction.

With the code restored: `npm run lint` and `npm run typecheck` are clean. `squeal status --wait 60000 test/daemon/full-check.test.ts test/daemon/full-check-daemon.test.ts` at revision 7: no known failures, 2 test files, each with a current result.

## For whoever continues

A start that throws after it took the claim keeps that claim until its daemon stops. Only `stop()` calls `#giveBack()`. An unrun check gives its claim back at once. So while the daemon whose start threw keeps serving, no sibling daemon on the store runs the day's full check. If that daemon is killed without a stop, the claim stays for 24 h. The tests do not assert this state in either direction, so a later fix (give the claim back in the constructor's `catch`) passes them unchanged. This is a product choice for the coordinator, not part of this row.

## Commits

- `3ac1a7237` test(011-229): reach the full check's throwing start and its spawn error
