# 011-99 brief: the tests that fail under host load

The human approved the row on 2026-10-22. Read the board's 011-99 row: it lists every sighting with its numbers.

Use /worker. Shape: repair, one commit per file. Base: main with 0.1.256.

Outcome: three test files stop failing when the host is busy, each for a named cause.

1. `test/scheduler/slow-slot-fair.test.ts`: "a guard wait gives way once another worktree takes the slot" times out in its teardown hook (`claims-fixture.ts:249`) at 10 s. The next test then counts probes the timed-out one still makes ("expected 448 to be 436"). Main 0.1.252 fails 1 of 10 at `taskset -c 0-3` with 3 pinned burners.
2. `test/scheduler/backlog-slots-overhead.test.ts` test 3: it fails alone on main at the local bound of 1.2 (1.21 to 1.26). The bound is 011-21 slice 2's claim. Find whether the slot path got slower since that slice (bisect the ratio on its commits), or whether the bound never held on this host. Never widen it to pass: a bound change needs the human, so report it.
3. `test/runners/node-test/run.test.ts`, "kills a busy loop at the deadline and keeps the file that finished": on CI it reports "0 of" where it expects "1 of". The 001-421 note in that file has the likely race.

Reproduce each one at a CPU limit before you fix it: use `taskset`, with burners pinned to the same CPUs. Never load the whole host. Fix the cause in the code the test times, or in the test's own timing when the defect is the test's. A file that may need to run alone in CI follows `opencode-dispose.test.ts` in `.github/workflows/ci.yml`; ask the coordinator first.

Owns: these three tests, their fixtures, and the product code of a cause you prove. Not yours: `test/harness/opencode-dispose.test.ts` (row 008-38) and `test/e2e/pi.test.ts` (row 009-30), the spec, the board, the bundles and the version.

Done when each file passes 10 runs in a row at `taskset -c 0-1`, and 10 runs at `taskset -c 0-3` with 3 pinned burners, or the report names why not. Lint, typecheck and `squeal run --all --wait` must also pass. Put their output and the whole report in your final message.
