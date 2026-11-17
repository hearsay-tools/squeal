# 005-107 repair round (wave 22 W3): review 0.1.546 B1 (Pi) and row 005-109 (OpenCode, S1)

Worker b9454cb0, 2026-11-17. Baseline: `74f631461`, whose `src/`, `test/` and `plugins/` equal candidate `0e3646e18` (`git diff --stat 0e3646e18 74f631461 -- src test plugins` is empty). Logs are in the worktree's untracked `logs/` folder: `~/projects/squeal/.ai/squawk/worktrees/b9454cb0-26d5-492b-bc51-56acdcbd91c8/logs/`. They stay there until the coordinator says the review passed.

## Part 1, B1 (Pi): commit `c873bee30`

Cause: `HandOff.sent()` resolves when the clear's write is written or failed. The worker's gate (`HandedWrites`) opened in both cases. After a failed or unanswered clear, the next request found the owed mark and `sayOwed` said the registration again.

Change: `src/harness/pi/handed.ts`, `HandedRegistrations`. The worker keeps in memory each registration whose text the host has: key is the consumer, value is its `registeredAt`. A request keeps what it handed only at the host's commit verdict (or at once for a host without a verdict slot). The next request's handler opens its context through `entered`. When that registration is still owed in the store, `entered` writes the clear again (`registrationSent`), held with this request's answer. The shared `sayOwed` then reads the mark cleared from the hold (`overlaidMeta`), so the shared code is not changed. When the store no longer owes it, or the consumer has another registration, the worker forgets it. No store record is added. A new worker process has no memory and replays once (decision C).

Seams wrapped: `startSession` (records the start's registration), `startRun` (re-clears, records a replay it says), `toolBoundary` (re-clears before shared `deliver`, records a registration `deliver` says). `settle`, `endRun`, `toolCall`, `idleWait` do not read the owed mark.

What a frozen daemon gives: the next run or tool boundary does not repeat the registration. It answers in about 1.3 s: the lease request times out, the connection writes directly, and the re-clear commits with that answer. A dead daemon: the same direct path. A killed start (a new worker): the registration is said once.

Test daemon: `serveWrites(r, { freezable: true })` puts a socket proxy in front of the in-process daemon; `freeze()` holds every byte both ways, as SIGSTOP does. The in-process `pause()` is not a freeze: the daemon still answers the lease request "busy", and the next request fails with SQLITE_BUSY instead of repeating.

Proof tests, `test/harness/pi/served-start.test.ts`, "a start whose clear the daemon never writes":
- the next run says no header, within the 2,000 ms event deadline, and a tool boundary after it neither; after thaw the store owes nothing;
- a tool boundary next says no header;
- an idle wait asked while the clear is pending ends at its cancel, within the deadline;
- control: a new worker says the header once, then not again.
The two earlier cases (delayed write, abandoned verdict) still pass.

## Part 2, row 005-109 (OpenCode, S1): commit `504596e3d`

Cause: `callBridge` resolved a held answer when it sent the commit verdict. The bridge commits after the signal and sends the clear to the daemon. OpenCode starts the next hook at once; its bridge read the header still owed and said it again.

Change: `src/harness/opencode/bridge-client.ts`: after the verdict, the call resolves the held answer at the bridge's exit, or at `COMMIT_GRACE_MS` (2,000 ms, the group killed then). The grace timer is unreferenced only for a background call, as the deadline timer is. A bridge already exited resolves at once. `src/harness/opencode/bridge.ts`: `runBridge` awaits `handOff.sent()` after the hand-over, as `writeThenCommit` does, so the exit comes after the daemon's write (written, or failed within the writer's bound).

What a frozen daemon gives: the call ends after the write's bound, within the grace; the clear was never confirmed, so the next call's bridge says the header again. Accepted: a duplicate only when the write was never confirmed. A dead daemon: the bridge exits at once (the write fails at once), same duplicate. The added delay per held answer is the daemon's write time, normally milliseconds.

Proof test, `test/harness/opencode/held-clear.test.ts`: two real bridge processes (built with esbuild from the source, no daemon start) through the real `callBridge`, with the daemon's socket in the test process.
- the daemon holds the clear for 100 ms from the verdict: the next `after` for a `read` tool says no header, and the store owes nothing;
- control, frozen daemon: the call ends within deadline plus grace, and the next `after` says the header once more.

## Commands and results

| Command | Result | Log |
| --- | --- | --- |
| New tests on the candidate's source (scratch copy, `git checkout 74f631461 -- src/harness/pi src/harness/opencode`, `node_modules/.bin/vitest run test/harness/pi/served-start.test.ts test/harness/opencode/held-clear.test.ts`) | exit 1, 4 failed, 4 passed; each failure `expected 1 to be +0` (the header said again) | `logs/red-on-candidate.log` |
| The same two files on `504596e3d`, `pnpm exec vitest run ...` | exit 0, 8 passed | `logs/green-on-fix.log` |
| `pnpm run lint` | exit 0 | (console) |
| `pnpm run typecheck` | exit 0 | (console) |
| Scratch build: `git clone --local` of this branch at `504596e3d` into `~/projects/squeal/.ai/squawk/t/b9454cb0/e2e-copy`, `node_modules` symlinked, then `node_modules/.bin/tsrs --fast -p tsconfig.build.json`, `node_modules/.bin/tsx src/harness/pi/build.ts`, `node_modules/.bin/tsx src/harness/opencode/build.ts` | exit 0; the Pi worker and the OpenCode plugin bundles carry both changes | `logs/e2e-build.log` |
| In the scratch copy, `timeout 900 node_modules/.bin/vitest run test/e2e/pi.test.ts` | exit 0, 5 passed | `logs/e2e-pi.log` |
| In the scratch copy, `timeout 900 node_modules/.bin/vitest run test/e2e/opencode.test.ts` | exit 0, 8 passed | `logs/e2e-opencode.log` |
| In the scratch copy, `timeout 900 node_modules/.bin/vitest run test/e2e/opencode-timeline.test.ts` | exit 0, 11 passed | `logs/e2e-opencode-timeline.log` |
| `squeal status --wait 60000 <changed paths>` (four waits) | no known failures; 18 selected files current and passing; 148 files queued "waiting for CPU" from 17:44 Europe/Warsaw on, so no verdict for them | `logs/squeal-status-*.log` |
| Direct run, because Squeal held them: the 55 test files outside `test/e2e` that import the Pi or OpenCode harness, the registration-owed code or the daemon-writes helper (`logs/direct-set.txt`), `timeout 900 pnpm exec vitest run --maxWorkers=4 ...` | exit 1: 53 files passed, 450 tests passed; 2 failed, `test/harness/pi/package.test.ts` and `test/harness/opencode/package.test.ts`, "worker.mjs differs from the build": expected bundle drift, since this round may not rebuild the committed bundles | `logs/direct-affected.log` |

Not run: a full suite (rule). The committed bundles are not rebuilt: the release rebuilds them, and the two package tests above then pass.
