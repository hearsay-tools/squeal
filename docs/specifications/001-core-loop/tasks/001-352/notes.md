# 001-352 notes: the slow-lane test read an empty "started" file

Main CI, Node 24, run 38468906634 on 98f88637: `test/daemon/slow-lane.test.ts:57` read `''` from `started` where `/^[^:]+:slow:vitest$/` was expected. The file ran 62 s, beside a full suite of 469 files.

## Cause: the read raced the write

The slow test wrote `started` with `writeFileSync(path, value)`. Node opens the path with `O_CREAT | O_TRUNC` and writes the bytes in a second system call. Between the two, the file exists and is empty. The daemon test polls `existsSync` every 10 ms (`waitFor` in `test/daemon/helpers.ts`) and reads the file as soon as it exists. A writer descheduled between `open` and `write` hands the reader an empty file. The slow lane makes this likelier: its workers run at nice 10 (spec 004 D2), and a loaded CI host is when a niced process waits longest for the CPU.

**Evidence: a probe outside the repository** (scratch dir under the task's tmp). A writer at nice 19 writes `token:slow:vitest` to `started-N`, one file after another, and waits for the reader to delete each one. The reader polls `existsSync` the way `waitFor` does, then reads. 48 CPU hogs ran beside them on 24 cores, each run limited to 60 s:

| Write | Empty reads |
| --- | --- |
| `writeFileSync(path)`, as the test did | 2 of 569 |
| `writeFileSync(path.tmp)`, then `renameSync` to `path` | 0 of 1283 |

On an idle host both gave 0 of 500, because the gap is microseconds. This matches a CI-only, load-dependent failure.

**Not a product fault: the slow instance always carries the mark.** `vitestInstance` (`src/core/daemon/daemon.ts:346`) passes `childEnv: this.#children.envFor(lane)` to every Vitest adapter. The slow tier builds its instance with lane `slow:vitest` (`:377`). `envFor` always returns `{ SQUEAL_DAEMON_CHILD: "<token>:<lane>" }`, which is never empty (`src/core/daemon/escaped.ts:78`). The adapter spreads it into `env` at every start and passes it to `createVitest` whenever `env` has keys (`src/runners/vitest/adapter.ts:142,157`). No path builds the slow instance without it.

## Fix (test only)

The slow test now writes `started.tmp` and renames it to `started`. `rename` replaces the name in one step, so the reader sees either no file or the whole value. The assertion is unchanged. If the mark were ever missing, the file would hold `''` and the same regex would fail at once with that value. Waiting for non-empty content would instead turn a missing mark into a 150 s timeout.

`priority` is still written plainly. The test reads it only after the slow file's result is stored, when its worker has finished writing. It also checks that `priority` does not exist, and an empty file would still exist.
