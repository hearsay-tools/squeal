# 001-142 notes: what tests leave running

2026-10-08. Seam map for whoever continues; the rules are in spec D12.

## Where it lives

- `src/core/daemon/escaped.ts`: `EscapedChildren` (marker, `/proc` scan, stop) and `afterEachRun`, which wraps the composite runner in `daemon.ts`, so the sweep covers every runner's tier and runs before the run's report returns.
- `daemon.ts` `#shutdown`: `atExit()` after `runner.close`, before the temp directory, the socket and the lock.
- `src/runners/vitest/adapter.ts`: `childEnv` goes into `createVitest`'s `env` beside the recorder's and into `injected`, which `canonicalConfig` leaves out of the environment hash. Only a root project gets the `env` option in its config: the hash test uses the `basic` fixture because `observed` (two projects) would pass without the exclusion.

## Vitest 5 facts this relies on

- `executeTests` builds each worker's env per run from `process.env`, the pool's `options.env`, `config.env` and `project.config.env` (`chunks/index.*.js`, `projectEnvs`). Changing the marker per tier would mean mutating those; a token per daemon was enough, because the adapter serializes its calls and nothing else of the daemon spawns a worker.
- A run resolves before its fork workers exit: `exitPromises` are awaited only by `cancel()` and `close()`. So at the tier's end the workers may still be alive, carrying the marker, with the test's non-detached children still their descendants. Hence `#workersGone` (the daemon's own marked children get 1 s) and the rescan rounds (a kill orphans children into the group).
- Under the threads pool a test's child is a direct child of the daemon process. With the worker's env it carries the marker and is stopped after the tier; with an env of its own it is the daemon's live descendant and waits for the exit.

## Found while testing

- A process leading a group it shares, such as the first command of a job-control pipeline (`set -m; node ... | cat`), sees the rest of the pipeline as non-descendant group members. The first version sent them SIGTERM (it killed the bench's own `grep`). Fixed by snapshotting the group's members at construction (`strangersOf`) and sparing them and their descendants; `test/daemon/escaped.test.ts` covers it.
- `/proc/<pid>/stat` read through `fs/promises` for 650 processes took 146 to 194 ms at load 80; synchronously, 26 to 47 ms. The scan reads 64 per event-loop turn.
- `squeal start` exits 1 on this host at load 80+ when the spawned daemon does not answer within its wait (as `lifecycle.test.ts` does in the baseline); the test spawns `squeal daemon` detached itself.

## Not done

- node:test files' leftovers: their processes run in their own groups (003 D5), killed only at the deadline. Proposed: pass the same `SQUEAL_DAEMON_CHILD` entry into the node:test runner's env (`createNodeTestRunners` options beside `tempDir`). The parent will file it as a row for the 002/003 coordinator.
- macOS: no `/proc`, so nothing is found there. `ps -E` could read environments; not tried.
