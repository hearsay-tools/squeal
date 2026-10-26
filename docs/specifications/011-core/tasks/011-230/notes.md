# 011-230: notes (wave 45 W4, 2026-10-26)

The node:test kit's K8 stored a cut file as a file error once on main CI 40257847142, attempt 1 ("FAIL step 0 run (completed): cut is file-error, expected unknown"). The product was wrong, not the test. Request 97b5355c to the coordinator agreed on the fix and its ownership.

## Cause

A cut, or the deadline, sends SIGTERM to the file's process group (`stopAll` in `src/runners/node-test/run/run.ts`). The group holds two processes:

- The test child. Node starts it with `NODE_TEST_CONTEXT=child-v8`, so it is not the test runner and installs no SIGTERM handler. It dies at once.
- The parent `node --test`. It handles SIGTERM in JavaScript: the harness's `terminationHandler` (`internal/test_runner/harness`, Node 24.21, read from `process.binding('natives')`). The handler collects the running tests (`findRunningTests`); when there are some, it writes `test:interrupted` and waits one `setImmediate`. Then it calls `exitHandler(true)`, which runs `root.postRun`, and then `process.exit()`.

The order in which the parent's event loop takes the two events decides the stream:

- SIGTERM first: the held test is still running, so the stream gets `test:interrupted` and no final `test:summary`. `report.ts` reads the stream as not whole, and the file is unknown. This is the usual order.
- The child's death first, which a descheduled parent on a loaded host can do: the parent ends the file test as failed (the wrapper's error is `{ failureType: "testCodeFailure", cause: "test failed", signal: "SIGTERM" }`) and the root finishes. The SIGTERM handler then finds no running test and writes no `test:interrupted`, and `exitHandler` writes the final `test:summary`. The stream is whole: the wrapper's `test:complete` with `passed: false`, then the summary. No check failed, so `report.ts` maps a file error, and `run.ts` counted the file as completed. On a cancel, the report's end is `completed`: the CI line.

## Evidence

Probes in `research/probes/node-test-cut/`, Node 24.21. The host load was 25 to 35 on 24 CPUs, the host's own load, not made for the probes.

| Probe | Whole streams (wrapper failed, summary) |
| --- | --- |
| `order.mjs group 20`: SIGTERM to the group, as the runner sends it | 0 of 20; 19 had `test:interrupted`, 1 stopped short |
| `order.mjs child 5 300`: SIGTERM to the test child, the group 300 ms later | 5 of 5; the parent ended on its own each time |
| `order.mjs stopped 10 200`: SIGSTOP the parent, SIGTERM the group, SIGCONT after 200 ms | 4 of 10, none with `test:interrupted` |
| `runner-cut.mts 10`, after the fix: the same pause through `runNodeTest` | 3 of 10 whole (`run.json`'s `completed`, all the old rule read); 0 completed files, 0 file errors |

The `stopped` row's first run was by an earlier copy of `order.mjs`, the same in that mode.

One CI miss in about 30 runs fits a race that needs the parent to be descheduled at the moment of the signal.

## Fix

A signalled file is never completed, at a stop or at the deadline. `c6e3845ed` set the mark in `stopAll`. The key-format alarm (`test/keys/key-format.test.ts`) then failed: `run.ts` is on node:test's validity path, and no validity case cuts a run, so the changed `stopAll` lines ran in no case. Moving the adapter version would re-key every node:test result with no key meaning changed. So the follow-up commit sets the mark where every run passes: after the process exits, `signalled = expired || cancelled`. That line runs in the exit's own turn, before any later stop or deadline, so it marks exactly the files that `stopAll` signalled, the same rule. `stopAll` is as released, and the alarm passes with no version moved. This is Vitest's rule (`buildReport`: a file completes when its module ended before any cancel) and the `RunOptions.signal` contract. Cost, accepted by the coordinator: a file that finished its stream in the same instant as the signal is unknown and runs again; it never stores a false FAIL. `run.json` gets an additive `signalled` per file; its `completed` stays the stream's completeness, so the log shows both facts.

Test: `1b4c8c009`, `test/runners/node-test/run-cut.test.ts`. A fake `node` (a shell script) traps SIGTERM and writes the whole stream above, so the order does not depend on the host. For a stop's signal and for the deadline, it asserts that the stream was whole and the file is in no `completedFiles` and no `fileErrors`. Both cases failed before the fix (Squeal, revision 1: `completedFiles` held `test/held.test.mjs`) and pass after it.

K8 on node:test alone (`npx vitest run test/kit/node-test.test.ts -t "K8:"`, 20 runs in a row): 20 of 20 on `c6e3845ed` at load 31 to 35, and 20 of 20 on `f42646981` at load 22 to 29, on 24 CPUs. `runner-cut.mts 10` on `f42646981`: 3 of 10 whole, 0 completed files, 0 file errors.

## Formats

No stored key or result format changes. `RunReport` and every type are unchanged; the fix changes only which files a cut or timed-out node:test run lists as completed. `NODE_TEST_ADAPTER_VERSION`, `KEY_FORMAT_VERSION` and the runtime files are untouched. `run.json` is a log under the run's directory, not the store; its other reader, `nodeTestLogs` in `src/core/status/run-log.ts`, reads `files[].testFile` alone.

## The other runners

- pytest (`src/runners/pytest/run/run.ts`, `report.ts`): no gap in the default case. Its `stopAll` is the same, with no signalled mark, but a file completes only when collection finished and every item it collected has its teardown report (spec 007 D6). Python's default SIGTERM action ends the process at once; pytest and Squeal's plugin (`runtime/squeal_pytest.py`, `sitecustomize.py`) install no SIGTERM handler. So no event is written after the signal, and a completed file ended before it. A narrow gap is possible and not probed: a project whose own code installs a SIGTERM handler that lets pytest go on, when the interrupted item is its file's last, could write that item's teardown after the signal. Not changed in this row.
- Vitest: the rule is already in `buildReport` (`src/runners/vitest/run.ts`).

## For whoever continues

Nothing of the row remains. The bundles drift from the build because `run.ts` changed (`test/harness/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`); the coordinator rebuilds them at integration. If the pytest gap above is to be closed, the same `signalled` mark in its `stopAll`, applied per batch, would close it; a fake Python that writes a teardown after SIGTERM would test it as `run-cut.test.ts` does.
