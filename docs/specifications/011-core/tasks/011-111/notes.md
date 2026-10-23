# 011-111: the start-handoff test beside a full suite

Wave 17, W3, shape repair. Commits `0ecd6103a` (the handoff wait) and `2139dd4d7` (the spawn path, on the coordinator's decision of 2026-10-23).

## The lead it closes: lead 1

The row's lead 1 holds: `start` read the status before the successor reported that it validates. Lead 2 does not.

The mechanism. A daemon binds its socket from its front desk (`desk.ts`, a worker thread), and the desk answers pings from then on. The main thread commits `#register` after `await desk.open()` (`daemon.ts`, `start`). `#register` writes the daemon's record and clears the handoff claim in one transaction. Between the two, the old daemon's record is cleared and the claim is live, so status reads the claim (`claimed` in `src/core/status/stopping.ts`) and says `handing over from 0.1.31 to 0.1.269 ...; 0.1.269 serves once the old daemon's lock frees`. `finishHandoff` broke on the first ping that `follows` accepts and printed that status. The evals' `NO_DAEMON` reads it as no daemon.

The evidence:

- CI 39864834794, job Node 22 (3/3), printed that text under `Squeal daemon started ... handed over in 6.4 s`. The text needs a live claim. A claim ends at the successor's registration, at its lock wait's timeout, or at its 130 s bound. The successor answered, so its wait had not timed out, and 6.4 s is far inside the bound. So the successor had not registered when `start` read the status.
- Lead 2 is out on the code. 0.1.31 (`8654424`, `src/core/daemon/daemon.ts` lines 405 to 408) clears its record, then closes its store, its socket, and last its lock. A successor cannot take the lock before that record is gone. A record cleared after a registration would also leave no claim, so status could not say `handing over`.
- Reproduced before the fix, beside a full suite (tables below): 3 failures in 60 runs pinned to one CPU, none in 40 unpinned or on two CPUs, each at `start-handoff.test.ts:129:64` with the CI's text. After the fix: none in 80.
- The window, measured by a throwaway probe (not committed): a real 0.1.269 successor after a real 0.1.31 daemon, pinned to one CPU beside the full suite. It answered its ping before the store recorded it for 0.2 to 0.3 ms in 7 of 10 handoffs, and 6.4, 12.9 and 18.8 ms in 3. `start` polls about every 50 ms (`sleep(50)` plus the ping), so a ping lands in the window rarely, and more often on a host with fewer CPUs, as on CI's runners.
- A stand-in test makes the window 1.5 s (`test/daemon/start-register.test.ts`, first case): before the fix `start` returned in 183 ms with the claim live; after, it prints a status that says a daemon validates.

## The fix

`src/cli/start.ts`: `served` waits until a daemon that `accepts` answers and the store records it (`registered`: the record's start time is the ping's). At the bound, a daemon that answered is still named, as before the fix: past the bound `finishHandoff` prints `Squeal daemon started` and a status that says the handoff has not ended (second case), not `stillHeld`'s "no daemon ... answered", which would be false. With none answering, `stillHeld` is unchanged.

The coordinator's decision of 2026-10-23: the spawn path (`result === "spawned"`) uses the same `served`, with its 10 s bound, so one rule covers every way `start` spawns or follows a daemon. Before it, the stand-in's spawn case printed `Squeal daemon spawned` above `no daemon has validated; ... squeal start starts one` (`start-register.test.ts`, third case, red at line 167).

Not changed: the `alive` path. `ensureDaemon` found a daemon that answers, and `start` asks it to resume; a daemon a hook spawned in the same moment could answer before it registers. No run showed it.

## Proposed C9 sentence (the coordinator writes it at integration)

In C9, the sentence on `squeal start` with a daemon stopping now reads "It waits for a daemon of at least its own version to answer, at most as long as `squeal stop` waits, then prints that daemon and the status." Proposed:

> It waits for a daemon of at least its own version to answer and the store to record it, at most as long as `squeal stop` waits, then prints that daemon and the status; past the bound, a daemon that answered is still printed. A `start` that spawns a daemon with none stopping waits for it the same way, up to 10 s (amended 2026-10-23, row 011-111: a successor answers on its socket before it registers, and `start` printed `handing over` under `Squeal daemon started`, CI 39864834794).

## Runs

Each single-file run is `npx vitest run test/daemon/start-handoff.test.ts -t "exits 0 once the successor serves"`, outside the lock, while one `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` runs. Pinned runs use `taskset -c <cpu>`, which the test's daemons inherit. Scripts: `t/5cccc4dd/bin/loop.sh` and `loop-pinned.sh` in the task's scratch directory.

Before the fix (tree `d08a1011b`, a separate checkout), beside its full suite (23:30:26 to 23:51:41 UTC, 928 files passed, 2 skipped, 1,274 s):

| Loop | Runs | Failures | Load |
|---|---|---|---|
| unpinned | 20 | 0 | 15 to 29 |
| 2 CPUs | 20 | 0 | 15 to 35 |
| 1 CPU | 20 | 1 (run 8, `:129:64`, the CI text) | 15 to 46 |

After the fix (tree `695f08598`), beside its full suite (from 23:51:41 UTC):

| Loop | Runs | Failures | Load |
|---|---|---|---|
| unpinned | 20 | 0 | 5 to 8 |
| 1 CPU | 20 | 0 | 5 to 16 |

The host's load fell after the first suite, so a paired loop followed beside the same post-fix suite: one loop of each tree at once, each pinned to a CPU of its own (23:57:24 to 00:07:27 UTC):

| Loop | Runs | Failures | Load |
|---|---|---|---|
| before the fix, 1 CPU | 40 | 2 (runs 4 and 24, both `:129:64`, the CI text) | 7 to 33 |
| after the fix, 1 CPU | 40 | 0 | 7 to 33 |

On one CPU: 3 failures in 60 runs before the fix (5%), 0 in 60 after. That is a large effect, not confirmed by the loops alone: a one-sided Fisher test on 3/60 against 0/60 gives p = 0.12, and at an unchanged 5% rate, 0 in 60 has a probability of 0.05. About 100 runs on each side would confirm it: at 5%, about 5 failures before the fix and none after give p = 0.03. The stand-in tests are what show the fix, at any load: each fails before its change and passes after.

`test/cli/warmup.test.ts` and `test/daemon/lifecycle.test.ts`, the coordinator's check on the spawn path, alone: 65.4 s and 59.0 s before (load 17 to 27), 68.5 s and 57.1 s after (load 21 to 28), all passing. No test change. `test/cli/launcher-one-node.test.ts` checks the spawn line too, but runs the committed plugin bundle, so it does not see this source change until the bundles are rebuilt.

## `busy-edit.test.ts`, judged with this row

Not the same cause. Its bound is spec 001's "within a second of the lock freeing" (task 001-422), for an edit's revision and a heartbeat. Reviews recorded it at line 127, the revision's bound: 4,030 ms (`reviews/wave-2b.md`) and 3,469 ms (`reviews/wave-4.md`), under load. The retry adds at most 500 ms (`BUSY_SLICE_MS` 250 plus `busyBackoffMs`' last 250), so the rest is the reconciliation pass's own work, or the event loop held, after the lock frees. No handoff and no `start` is in its path. A test-only fix would widen a spec bound, and the pass and its retries are in `src/core/daemon-loop/`, `src/core/daemon/sliced-writes.ts` and `src/core/scheduler/busy-resume.ts`, so neither is in this row. Beside the post-fix full suite it passed 5 of 5 runs (load 6 to 25, 77 to 79 s each), so these runs give no new failure to read.

## For the next row

- `busy-edit.test.ts`: a row of its own, which records where the time after the lock frees goes (the pass's phases, with their times) before it changes the bound or the pass.
- The `alive` path of `start` (above), if a run ever shows it.
- Any reader that pings a daemon and then reads the store can meet the same window. `start` was the one seen to print what it read; this row did not survey the others.
