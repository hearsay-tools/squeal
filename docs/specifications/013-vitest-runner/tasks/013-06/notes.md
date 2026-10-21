# 013-06: worker notes

Worker 5b680467, 2026-10-21. Commits `72314dd9b` (the change and its tests) and `0dccb3ed1` (the validity cases, by the coordinator's agreement).

## Seam map

| Close | Where | Emptied |
|---|---|---|
| `#recreate` | `adapter.ts` | yes, `closeEmptied(old)` |
| the adapter's `close()` | `adapter.ts` | yes. This is also the slow pass's close: `withSlowInstance`'s `drop` calls the slow `VitestAdapter`'s `close()`, so `slow-instance.ts` is unchanged (it is runner-agnostic and holds no `Vitest`). |
| `closeBroken` | `broken.ts` | yes, `closeEmptied(vitest).catch(note)` |
| `closeRejected` | `startup.ts` | yes, the same |
| a failed `#start` | `adapter.ts` | no: accepted deviation, see below |
| `abandon` | `run.ts` | never (unchanged) |

`closeEmptied` (`empty-closed.ts`) awaits the close, then runs `emptyClosed`; an error while emptying is dropped by `.catch(() => 0)`. A rejected close is the caller's, and the instance is left whole. `emptyClosed` has no `try` blocks: with Vitest 5.0.3, `vite`, `projects` and `logger` are plain fields, so a guard branch could never run, and the key-format alarm requires every changed line to run in a validity case.

**The reorder in `run()`.** After `closeBroken` or `closeRejected`, the run still read the closed instance's graphs (`mayHaveRun`, `mayHaveReadTouched`). Both are now computed before the failure branch, while the run still holds its lane. Without this, a rejected run with a pending touch of a module rejects with `TypeError: vitest.projects is not iterable` (checked by reverting it: the handshake test in `empty-closed.test.ts` fails). In the normal path nothing is awaited between the old and new place, so the result is the same.

## Decisions

1. **What "freed" means in the tests.** The brief asked that "a `WeakRef` to each closed instance is empty". With plugins left alone (`noplugins`), the closed `Vitest` stays reachable as an empty shell through the plugins' closures, as the research found (`logs/matrix-break2.jsonl`). The tests therefore check that each closed instance has no own property left and that every environment's module graph it had is collected. On Squeal's Vitest 5.0.3 before the change: 4 of 4 instances whole (51 own properties, every graph alive) after 3 recreates.
2. **Plugin sharing is observed, not only inferred.** A config that imports a plugin object from a package in `node_modules` imports it once across a recreate (a `globalThis` counter is 1), and the second run passes. Emptying plugins as well makes that run pass no test.
3. **`abandon`.** A spinning test is cancelled by force, so that run is not `hung` and never reaches `abandon`. A real hung instance is hard to make, so `abandon` is pinned by a unit test on a fake instance: after its close resolves, the instance keeps its properties.
4. **The failed `#start`** (coordinator, option A step 4). Its close is left as it was. Measured with a throwaway probe (5 failed starts after one warm-up, three GCs, load 36.7 to 37.0 on 24 CPUs; heap counts do not depend on load): the instance stays reachable and holds 0.36 MiB of heap per failed start on the `basic` fixture and 0.72 MiB on `five-projects`. Emptying it would save 0.05 to 0.1 MiB. A failed start builds no module graph.
5. **Validity cases** (coordinator, option A steps 2 and 3). `closeRejected`: a data-only case, a global setup that writes `$STARTED` and throws. `closeBroken`: the run flag `removeTempDir` in `case.ts`; `harness/vitest.ts` starts the case's instance under its own `TMPDIR` and removes it before that run. The key-format test passes with no version raise.

## For the next row

- Recommendation 2 of the research (count the closed instances still alive and report it in the ping) is not built. `closeEmptied` is the single place where a `WeakRef` per closed instance could be kept.
- Recommendation 3 (keep the slow instance across passes) is not built. It would change `withSlowInstance` and 004 D2's "closed when it drains".
- The time an emptying takes was not measured; it starts no process.
