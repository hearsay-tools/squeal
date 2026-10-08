# 004-13 notes: `run --slow` and the spawned CLI

## The `run-slow` request

- Path: `squeal run --slow` (`src/cli/run-slow.ts`) sends `run-slow`; the front desk (`handlers.ts`, worker thread in `front-desk.ts`, or in-thread from sources in `desk.ts`) answers at once with a request id and posts the request to the main thread; `Daemon.#requestSlowSuite` waits for the start, then `requestSlowSuite(scheduler)` (`src/core/daemon/run-slow.ts`) calls `Scheduler.requestSlowSuite()` when the scheduler has it, else rejects with `SLOW_NOT_SUPPORTED`. The CLI polls `run-slow-status` for up to 10 s.
- When 004-12 lands `requestSlowSuite` on the `Scheduler` type, the structural cast in `run-slow.ts` becomes redundant and can go; `SlowSuiteRequested` there can become an alias of 004-12's `SlowSuiteRequest`.
- A daemon from before `run-slow` answers `unknown request type "run-slow"`; the CLI prints the same "not supported by this daemon" line for it.

## A node:test file's spawned CLI is not observed (spec 004 D5)

Measured with `test/fixtures/node-test/spawn-cli` (`test/integration/slow-spawn.test.ts`) under a daemon from the sources: an edit of `lib/helper.mjs`, which only the spawned `bin/cli.mjs` loads, re-runs nothing, and the file's pass stays current at the new revision while the CLI's output changed. Why, at three places:

1. `runNodeTest` (`src/runners/node-test/run/run.ts`) loads the module recorder as an argv `--require`. A `node` the test spawns does not inherit argv, so it records nothing. `childEnv` puts the recorder in `NODE_OPTIONS` only when the project's `NODE_OPTIONS` already holds a `--require`. Direct run: with the recorder in argv only, one graph file (the test process); with it also in `NODE_OPTIONS`, a second graph file from the CLI's process holding `cli.mjs` (parent `null`) and `helper.mjs`.
2. 001-132's recorder (`src/runners/observe/recorder.cjs`), which follows spawns, is never given to node:test processes, and `projectEnv` strips it and `SQUEAL_OBSERVE` when inherited (003-35).
3. Even with the child recorded, `observedClosure` (`run/observed.ts`) treats an edge with a `null` parent other than the test file's entry as a preload root: the CLI's loads would go to `preloadPaths`, the project's environment hash, re-keying every file of the project rather than this file.

D5's sentence "for a slow node:test project the recorder is also placed in the child's `NODE_OPTIONS`" therefore needs a runner row: put the recorder in `NODE_OPTIONS` for slow projects, and attribute every graph file of one test file's run (`graph-<i>-<pid>`) other than the test process's to that file's `paths`. The integration test pins today's behaviour and flips when that lands.
