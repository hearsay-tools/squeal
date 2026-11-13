# Wave 16.5 R1: repair of review 0.1.464 B1 and S1

Worker 1d921b97, shape repair. Base: `76e107718` (`w16/land` with `tasks/wave-16.5.md`). Brief: `tasks/wave-16.5.md`, "Wave 16 R1".

## What changed

- **B1** (`8a6e6ad03`): `FileProgress.runEnded(runner, refs)` (`src/core/code/gate/progress.ts`) ends the timer of each of `refs` that is still open. `runOne` (`src/core/code/gate/lanes.ts`) calls it in a `.finally` on `runner.adapter.run(...)`, so a run that completes, crashes, times out or rejects ends its own files' timers. Other runs' files stay open: the keys are the runner kind and each file's project and path, and the node:test entries have different projects. `wasStarted` keeps its own set, so `runs[].notStarted` is unchanged. `close()` still ends every timer after all lanes settle. Each end is idempotent: a module end after the drain does nothing.
- **S1** (`62f6b0d75`): in `runNodeTest`'s worker loop (`src/runners/node-test/run/run.ts`), the start hook runs inside the `try`, and the end hook runs in a nested `try/finally` that always releases the slot. The hook's error still rejects the run.

## Decisions the brief did not settle

1. **The drain is in the gate, not in the Vitest adapter.** The review proposed the adapter's run settlement. `adapter.ts` is outside this row's ownership, and `RunCollector.runEnd` hears only runs that Vitest itself ends, not a hung run the adapter abandons or a rejected `run()`. The gate's `adapter.run(...).finally` sees every settlement of every adapter. So the gate's own end callbacks are drained once at settlement. The Vitest adapter still calls a file's end only at its module end; for a dead worker's file it never does, and the gate no longer needs it to.
2. **No hook line changed in a key-path file's meaning.** `test/keys/key-format.test.ts` and `test/keys/validity/adapters.test.ts` pass at revision 9 with no new validity case.

## Done-when to tests

| Done-when | Test |
| --- | --- |
| B1: a Vitest worker killed beside a running node:test lane; only the node:test file is named, once | `test/code/gate/collect-crash.test.ts` (red at revision 4: it named `vitest test/b1.test.ts`; green at revision 9) |
| B1: a run's end ends its open files once; other runs' files stay open; `wasStarted` kept | `test/code/gate/progress.test.ts`, "ends a run's files with the run, once, ..." |
| S1: a throwing start or end hook gives the slot back | `test/runners/node-test/run-slots.test.ts`, "gives its slot back when the start/end hook throws" (both red at revision 4) |

## For whoever continues

- A crashed Vitest run completes none of its files (`buildReport`), so in the crash test all three Vitest files read not completed, each started. The verdict stays `incomplete`.
- The crash fixture file checks `isMainThread` before it sends `SIGKILL`: under a `threads` pool, `process.pid` would be the gate's own process.
- `--json` stdout was not re-tested here; the wording did not change and `test/cli/code-gate-json-stdout.test.ts` covers it.
