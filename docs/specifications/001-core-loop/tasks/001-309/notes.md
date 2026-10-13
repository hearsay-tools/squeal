# 001-309 notes: eight timing tests that fail under full-suite load

For each test: what it waited on, why load broke the wait, and the fix. None showed a product defect, so all eight fixes change tests only.

## (1) `test/daemon/lifecycle.test.ts`: replacement after SIGKILL

**Cause: a clock bound.** `if (!LOADED) expect(elapsed).toBeLessThan(1_000)`. `LOADED` means a load average above 8, and a CI runner with a few cores is oversubscribed well below that (5,510 ms at `7e7dc512`).

**Fix: pair it with the work.** The same test now measures the first daemon's cold start (spawn to the first ping answer) under the same load. The replacement must serve in under 3 times that. The cold start creates the store that the replacement only opens, so it does more work. A replacement held up by what the dead daemon left behind (its socket file, its lock) would show up against it. The lock is SQLite `BEGIN EXCLUSIVE` and the OS releases it on death (`src/core/daemon/lock.ts`), so nothing in that path waits on a timer. The D10 200 ms target is still printed and never asserted. Measured here alone: replacement 251 ms, cold 277 ms.

## (2) `test/daemon/escaped-overlap.test.ts`: the stopped process is gone

**Cause: a wait the product never promised.** `terminate` (`src/core/daemon/terminate.ts`) sends SIGTERM, waits up to the 1 s grace, sends SIGKILL and returns without waiting for the exit. A process still running after the grace gets SIGKILL and is not gone yet when the test reads `isAlive` once. That is no defect: the note says "SIGKILL after 1 s", and SIGKILL cannot be blocked.

**Fix:** `gone(pid)`, an `expect.poll` with a 10 s bound, at the five post-stop checks in the file. A process the stop never reached sleeps for 600 s, so it still fails the test.

**Second race, in the helper:** `isAlive` (`test/daemon/strays.ts`) calls `kill(pid, 0)` and then reads `/proc/<pid>/stat`. A zombie reaped between the two made the read throw, and the helper answered "alive". On Linux it now answers "gone". Elsewhere it still answers "alive", since there is no `/proc` to ask.

## (3) `test/watcher/linked-exclusions.test.ts`: install after the watch started

**Cause: 3 s bounds.** The test process writes 2,000 files synchronously. The watch then reaches 100 new directories and reconciles (stat and hash) 2,000 files in the same process. Under load that takes seconds.

**Fix:** every wait in the describe gets `WAIT_MS`, 30 s, and the describe gets a 120 s timeout. The conditions are unchanged. The first fix covered only the named test. In the stress loop at load 140, a sibling ("leaves out the directories the target's own .gitignore files name") then hit the 5 s default (11.7 s for two installs and the feed start). So the bound now covers the whole describe.

## (4) `test/cli/codex.test.ts`: scratch HOME, run as the CLI and (5) `test/harness/codex/plugin.test.ts`: every bundle parses

**Cause: the 5 s default test timeout.** (4) runs two CLI processes through tsx, each compiling the source: about 1 s alone (`squeal why` history: 585 to 1,935 ms). (5) runs 17 `node --check` processes one after another.

**Fix:** a 60 s test timeout on each, the bound the file's build tests already use.

## (6) `test/integration/touched-own-write.test.ts`: "hook timed out in 10000 ms"

**Cause: the shared `afterEach` of `test/scheduler/helpers.ts`.** It runs `scheduler.close()`, which awaits the run in flight (`#pumping`), and then the runner's `close()`, which closes Vitest. Under load that is more than the 10 s hook default.

**Fix:** that `afterEach` gets `SLOW.timeout` (120 s), the bound its tests already have. The helper is shared, so every scheduler-harness test gets the same headroom.

(4) was also reported as a hook timeout in the coordinator's gate. Every hook it runs is synchronous (`rmSync`, store close). The reviewer's run at `005-agent-adoption/reviews/wave-1.5.md` shows the test itself timing out at 5 s, and that is what the fix addresses. If (4) ever shows a hook timeout again, look at `test/store/helpers.ts` `tempDir`, whose removal retries.

## (7) `test/harness/hung-daemon.test.ts`: SIGSTOPped daemon

**Cause: SIGSTOP read as synchronous.** The test sent SIGSTOP and probed straight away. The probe returned `alive`, so something answered the ping. `kill` returns once the signal is queued, and on a loaded runner the daemon can still run before it stops. The second test used a 50 ms `delay` for the same wait.

**Fix:** `stop(daemon)` sends SIGSTOP and waits until `/proc/<pid>/stat` shows state `T` (10 s bound, Linux only), and replaces the `delay(50)`. The probe assertion now compares the whole probe (`toMatchObject`), so an unexpected answer prints the pid that gave it. If this ever fails again with a pid other than the daemon's, the cause is a second server and not a late stop. That would be a defect, and it would need its own row.

## (8) `test/runners/node-test/enumerate.test.ts`: enumeration cost

**Cause: unpaired minima, the shape 001-237 found in graph cost.** Best of three enumerations was divided by best of three cold builds. If load lands on all three enumerations and spares one build, the ratio goes up: 0.576 at load 23 to 92, against 0.2 calm.

**Fix:** in each of 9 rounds, the enumeration is divided by the cold build just after it, and the median ratio is asserted against the same bound, 0.5. The test timeout is 180 s. The test logs the median. Here alone at load 47 it was 0.187.

## Not changed

- Similar single reads of `isAlive` after a stop in `test/daemon/escaped.test.ts:199` and `test/daemon/strays.test.ts`. Neither has failed and the row does not name them, but they have the same exposure as (2).
- The other 3 s waits in `linked-exclusions.test.ts`: single-file changes with no install to reconcile.

## Seen beside the stress loop, outside this row

Load here was 50 to 140, from this loop and the other coordinators. Neither test below is in the row, and neither was changed.

- `test/cli/run-all-verdict.test.ts:278` "takes the verdict of the running checkpoint it joined (001-217)": `later(100, ...)` finishes the checkpoint 100 ms after it starts. Under load that can happen before the CLI's first read, and the CLI then prints "2 already current, 0 run now" and not "joined c0". It is a race on a timer. It needs a condition the CLI has reached (it has joined) before the test finishes the checkpoint.
- `test/scheduler/backlog-tiers.test.ts` "runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run": the direct run and the backlog are measured once each, unpaired, so they had different load. Backlog 15,336 ms against direct 5,103 ms.
- Squeal's own background run in this worktree, at load 89, also timed out at 5 s in nine hook-bundle tests (`test/harness/{bundles,hooks,liveness,session-lifecycle,session-start,starting-daemon}.test.ts`, `test/harness/codex/{bundles,hooks,turns}.test.ts`). They spawn bundle processes under the 5 s default, the shape of (4) and (5).
- `test/cli/setup/gates.test.ts` "lists this repository's old gate with its rewording, and the skill's line as a mention": 5,693 ms against the 5 s default, in a background full suite at about load 100.
