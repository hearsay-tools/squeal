# Row 011-376: the coverage writer's turn test on CI

Worker ffae9bc4, wave 111 W1, 2026-11-16. Base main 4f496bea0.

## Cause

The test measured the longest turn by wall time (`monitorEventLoopDelay`). A turn's wall time also holds time when the main thread does no work of its own: a wait on the disk, or the runner not scheduling the thread. It is not a regression in the writer. The CI candidates changed only `src/core/scheduler/`, and the writer's own work did not grow.

A probe ticked every 5 ms and recorded each gap's wall time and the main thread's CPU time (`process.threadCpuUsage`). It also timed the writer's own main-thread units by putting a recording `Pace` into the writer. The probe ran three times at load average 84–87 on 24 CPUs, Node 26:

| unit on the main thread | wall ms | CPU ms |
|---|---|---|
| answer to the worker's "need" (`plain` + `postMessage` of 300 sources) | 33–38 | 25–26 |
| `place`: key, store open, `putParts` (one transaction) | 28–241 | 10–13 |
| parse of the 26.9 MiB payload here (control) | 324–615 | 204–279 |
| parse and map here (`mapHere`, control) | 934–4,762 | 636–1,028 |

In the third run, the store write's turn took 241 ms by the clock and 10 ms of CPU. This matches CI run 43839480465: a 232 ms turn against a writer whose own work is about 25 ms. The extra time is either the SQLite commit waiting on the disk or the thread not being scheduled. The probe cannot tell which, and the test does not need to know.

## Bound

The writer's longest turn is now judged by the main thread's CPU time in it (`test/code/coverage/turns.ts`, `watchTurns`). The budget comes from the work done in the same run: `PARSE_SHARE` (0.5) times the main thread's CPU time to `JSON.parse` the same payload (`parseCpuMs`). The bound follows the machine's speed. No number is tuned to a host. The load skip is removed: CPU time does not grow when the host is busy, and the case passed at load 77–88.

Results (each run states the load on 24 CPUs):

- Node 26, 3 of 3 pass: longest turn 21, 16, 19 ms of CPU (124, 42, 35 ms by the clock; the old test would fail its first run at 124 ms); parse 235, 287, 280 ms; load 82.4, 80.9, 77.3. Three earlier runs of the same code also passed: 21, 17, 15 ms CPU at load 84–88.
- Node 22.19, 1 of 1 pass: 27 ms of CPU against a parse of 258 ms, load 69.3.

## The case fails against a main-thread parse

These were temporary local changes, both reverted (`git status` clean for `src/`):

1. Map on the main thread: `worker: null` in the test (the writer's own fallback). Fails: longest turn 749 ms of CPU, budget 95 ms.
2. Parse only on the main thread: in `workerMapper`'s `map` (`src/core/code/coverage/mapper.ts`), before `const id = jobsMade++;`, the line `JSON.parse(readFileSync(file.payload, "utf8"));`. Fails 2 of 2: 251 and 250 ms of CPU, budgets 148 and 102 ms.

## For the coordinator

- Margin: the writer's longest turn is about 25 ms of CPU. The smallest budget seen was 95 ms. A parse on the main thread costs at least the whole parse, which is twice the budget.
- `watchTurns` counts all of the main thread's CPU between two ticks, including garbage collection and Vitest's own work in the worker. Neither came near 30 ms in any run.
- An observation, not a defect of this row: the store write (`putParts`, and the store open on the first record) runs synchronously on the daemon's main thread. On a slow disk its wall time can reach about 240 ms with 10 ms of CPU. This is the D8 design. It is not a regression, so I propose no row.
