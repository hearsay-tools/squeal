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

## R1: review of cand/0.1.260

Use /reviewer. Shape: review. Pinned to `791ca37dc` (cand/0.1.260: main `e9d907981`, worker 796bfe06's four commits picked as `b1420366d` to `d66e904ff`, a release commit). Read this brief and the board row 011-99.

Check:
- `src/core/scheduler/slow-tier.ts`: a close before `SlowTier.next()` reads the preemption count starts no guard wait; a close during a guard wait still aborts it; a pass not closed is unchanged.
- `test/scheduler/claims-fixture.ts`: a run waits on the gate held when it started; every other `hold()` caller still holds the runs it means to.
- `test/scheduler/slow-slot-fair.test.ts`: the new case is red without the `slow-tier.ts` change.
- `test/runners/node-test/run.test.ts`: the case's premise check and failure text weaken no assertion of the 001-421 case it shares a helper with.
- The release commit: eight version places, bundles match the tree.

`backlog-slots-overhead.test.ts` test 3 is unchanged on purpose; its bound is the human's decision. Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once. Known red on main: `backlog-slots-overhead.test.ts` test 3 and `opencode-dispose.test.ts` (008-38). Write `reviews/0.1.260.md` with PASS or FAIL on `791ca37dc` and commit it. A finding that is not a proven break goes to "Inputs for the next wave".

## W2: option (c) for test 3

The human chose (c) on 2026-10-22. Use /worker. Shape: repair, one commit. Base: cand/0.1.260 (`791ca37dc`). Worker 796bfe06's measurements are in `.ai/cezar/t/796bfe06/` (`cpu.out`, `tree-*/test/scheduler/zz-cpu.test.ts`, `repro.sh`, `ratio.sh`); read them, never edit them.

Outcome: `backlog-slots-overhead.test.ts` test 3 checks per-file overhead with bounds that a loaded host does not trip.
1. Replace the wall-clock ratio with a bound on the slot pass's daemon CPU per file (`process.cpuUsage()`), net of the commit busy-waits. Prefer a ceiling relative to the tier pass's CPU per file in the same harness, so a slower CI CPU moves both; use an absolute ceiling only if the spread makes the relative one worse, and say why. Set it from main's numbers with a margin; the comment names both.
2. Check the commit budget, `FILES * 0.6`, on the slot pass with the fewest commits.
3. The `it()` name and the header comment say what the test now checks.

Owns: `test/scheduler/backlog-slots-overhead.test.ts`, and `slots-fixture.ts` only if the reading needs a hook. Not yours: src, `ci.yml`, the bundles, the version, the spec, the board.

Done when 10 runs pass at `taskset -c 0-1` and 10 at `taskset -c 0-3` with 3 pinned burners; a temporary 20 ms CPU cost per slot fails the CPU bound, and a commit per slot without the gather fails the budget (both shown, then reverted); lint, typecheck and `squeal status` for the file pass.

## R2: review of cand/011-99-w2

Use /reviewer. Shape: review. Pinned to `b428e4308` (cand/011-99-w2: main `d69c8611b` and worker 760d185f's W2 commit, picked from `444a41dbd`). Test files only; the bundles do not change, so there is no version raise and no release. Read W2 above and the board row 011-99.

Check:
- Test 3 bounds the best slot pass's daemon CPU per file, net of the sink's busy-waits, at 5 times the best tier pass's, with no `process.env.CI` case; the comment's numbers match the worker's runs.
- The commit budget, `FILES * 0.6`, applies to the slot pass with the fewest commits.
- `slots-fixture.ts`'s `applyCpuMs()` measures the CPU of the busy-waits it subtracts, and changes no other harness behaviour.
- A 20 ms CPU cost per slot would fail the CPU bound, and a commit per slot without the gather would fail the budget (reason from the code or re-run in a scratch copy; never edit `src` in your tree).

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once; that run is the gate. Known red on main: `handover-tier.test.ts` (row 011-110) and `opencode-dispose.test.ts` (008-38). Write `reviews/011-99-w2.md` with PASS or FAIL on `b428e4308` and commit it.
