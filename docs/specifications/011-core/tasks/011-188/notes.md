# 011-188: `stop-cancel.test.ts:170` finds the holding test's child gone right after it wrote its pid

Worker 9a2d649e, from main at d0efe8dd4, 2026-10-25. Shape: slice. Parent coordinator 04a258b0.

## The cause

The case read `started` after the file was created but before the pid was written in it. `Number("")` is `0`, and `/proc/0` never exists. No daemon cancel or restart is needed for this result, and none was seen.

- **Mechanism.** `writeFileSync` makes two syscalls. strace on this host: `openat(..., O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC)` and then `write(20, "123", 3)`. Between the two, the file exists and is empty. The case polls `existsSync(started)` every 10 ms (`waitFor`, `test/daemon/helpers.ts`) and reads the file at once. A poll in that window reads `""`. On a loaded CI runner, the Vitest worker that writes the file can be descheduled between the two syscalls.
- **Same failure, forced.** A temporary holding test wrote `""`, paused 500 ms, then wrote the pid. The case failed at the same assertion with the same text: `AssertionError: expected false to be true`, `stop-cancel.test.ts` at the `existsSync(`/proc/${child}`)` line, column 44. Squeal's own run of that edit failed the same way (revision 4 of this worktree).
- **Same duration.** CI reported 61,796 ms for the case. The forced reproduction reported 61,547 ms. In both runs, `started` came in about 1.5 to 2 s, as in a passing run. The other 60 s is the teardown, which Vitest counts in the test's duration:
  - the case fails before its `squeal stop`, so `afterEach` calls `stopStrays`, which sends SIGTERM to the fixture's daemon and SIGKILL after 60 s (`killProcesses(strays, 60_000)`);
  - on a signal, `#shutdown` closes the loop without `cancel` (`src/core/daemon/daemon.ts`, the `loop.close` step: `this.#stopRequested ? { cancel: true } : {}`), so it waits for the tier in flight (D10);
  - the holding test waits up to 150 s for its flag, so the tier does not end and the SIGKILL comes at 60 s.
  So the 60 s does not come from a host gate, a capacity wait or a slow start.
- **Same leftover.** CI's job ended with `Terminate orphan process: pid (15063) (node)`. The forced reproduction left the same pair alive, with parent 1049 (systemd user) and cwd in the deleted fixture: the tier's Vitest worker and the holding child (`node -e ... setInterval(...)`). The SIGKILL stops the daemon before its sweep of what a test left running.

## The lead, cancel and restart, is not supported

- What can cancel a tier in this fixture: a revision that changes a tier input or queues an edit's work (`cancelsBacklog`, `src/core/scheduler/backlog.ts`; `TierYields.check`, `src/core/scheduler/yields.ts`), a yield for queued or promoted work in the lane, a hold, and the stop. The case edits nothing in the fixture, sends no session or `run` request, and queues no other work. The start queues the six test files (the scheduler fixture's five and `test/hold.test.ts`) into one tier.
- The kept store of a passing run has one run, with six files, cancelled only by `squeal stop`. Its notes: `daemon stopped: squeal stop`, then `stopped 1 process a test left running after its tier` (the holding child).
- A restart would leave two cancelled Vitest runs. The case's last assertion, `vitestCancels(repo)` equal to `[cancelled("stop")]`, then fails. It passed in each of the 20 runs below.
- For the lead to give this failure, a cancel must also kill the child within one 10 ms poll after the write. If it does not, the test reads a live child, and the restart writes a new `started` with a live pid.

CI kept no fixture store, so CI gives no direct record of the order. The evidence is the matching assertion, line and duration, the matching leftover, and no cancel source in this fixture.

## The fix (test only, no daemon change)

- `5783d0be3`: the holding test writes the pid to `started.tmp` and renames it to `started`. A rename is atomic, so `started` exists only with its pid. With the forced 500 ms pause between creating `started.tmp` and writing it, the case passes (6.73 s at load 19.61).
- `d25bbebb9`: the holding child uses `setTimeout(() => {}, 200_000)`, not `setInterval` with no end. If the case fails again, or if a daemon is killed mid-tier, the child ends after 200 s. Before, it stayed forever. A passing case is unchanged: the stop's sweep still stops the child within seconds, and the case still checks that.

## Checks

20 runs of `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/stop-cancel.test.ts -t "mid-batch"` at d25bbebb9 on this host (24 CPUs), with the load averages read before each run: 20 passed, at one-minute loads 24.15 to 39.68.

| Run | Load (1, 5, 15 min) | Result |
|---|---|---|
| 1 | 28.86 23.91 23.45 | 1 passed |
| 2 | 27.06 23.69 23.38 | 1 passed |
| 3 | 28.26 23.99 23.48 | 1 passed |
| 4 | 27.49 23.96 23.48 | 1 passed |
| 5 | 29.12 24.42 23.63 | 1 passed |
| 6 | 32.96 25.40 23.96 | 1 passed |
| 7 | 36.87 26.61 24.38 | 1 passed |
| 8 | 36.00 26.60 24.39 | 1 passed |
| 9 | 36.17 26.92 24.51 | 1 passed |
| 10 | 38.79 27.98 24.90 | 1 passed |
| 11 | 39.68 28.53 25.11 | 1 passed |
| 12 | 38.27 28.60 25.17 | 1 passed |
| 13 | 36.49 28.39 25.12 | 1 passed |
| 14 | 35.00 28.33 25.14 | 1 passed |
| 15 | 32.58 28.04 25.08 | 1 passed |
| 16 | 30.93 27.77 25.01 | 1 passed |
| 17 | 29.17 27.46 24.92 | 1 passed |
| 18 | 28.82 27.46 24.95 | 1 passed |
| 19 | 26.08 26.91 24.80 | 1 passed |
| 20 | 24.15 26.50 24.68 | 1 passed |

## Decisions the brief did not settle

1. **Fix on the writer side.** I chose a rename in the holding test, not a reader that waits for a non-empty file. With a rename, `existsSync(started)` implies the pid, so the existing poll stays correct.
2. **A limit on the child's life.** This is outside the row's outcome but in the same file. It removes the endless leak that CI and this host both showed. 200 s is longer than the test's 170 s timeout and the case's 180 s `SLOW` timeout.

## For whoever continues

- **The leak when an outer Squeal cancels this file.** When this worktree's Squeal cancelled its run of `stop-cancel.test.ts` for a later edit, it stopped the fixture's daemon (note `daemon stopped: signal`, 0.95 s after its start). That daemon waited for its tier and was killed. Its Vitest worker and holding child stayed, with parent 1049. After `d25bbebb9`, the child ends after 200 s. The Vitest worker should end at the holding test's 150 s deadline. I did not confirm this: I ended the worker at 108 s. The second case's held tests (`heldTest`) wait 150 s in the same way.
- **The 60 s teardown on failure.** A signal stop waits for the tier in flight (D10), so any failure of this case before its `squeal stop` costs 60 s and a SIGKILL. `onTestFailed` and `onTestFinished` run after `afterEach` in Vitest, so they cannot write the flag in time. If this matters, the case could write `flag` in a `try`/`catch` around its body before it throws again.
- **Same pattern elsewhere.** No other test reads a pid file while its writer may still be writing it. `escaped.test.ts`, `departure.test.ts`, `step-down.test.ts` and `test/evals/teardown.test.ts` read their files after the writer has finished: after a stored result, a daemon exit or a run's end. `heldTest`'s `appendFileSync` can be read at length 0; that only delays the poll.
- Row 001-436 (`:161`, a daemon left after stop) is a different failure. This row did not touch it.
