# 001-320 notes: more tests that hit the 5 s default under load, and `isAlive`

001-309's method: for each test, what it waits on, why load broke the wait, and the fix. None showed a product defect, so every change is to tests.

## `isAlive` (`reviews/wave-13ay.md` S1)

`test/daemon/strays.ts` `isAlive` now reads only `ENOENT` or `ESRCH` from `/proc/<pid>/stat` as gone, the process reaped between the signal probe and the read. Any other read error (`EACCES`, `EIO`) is no evidence of exit and answers alive, as before 001-309. Outside Linux it still answers alive. The stat reader is an optional second parameter, so `test/daemon/strays.test.ts` injects each error: a missing stat after a successful probe is gone, a zombie is gone, a permission or I/O error is alive. A live pid and a dead one are checked for real.

## Per-test bounds: CPU and child processes under the 5 s default

Each of these waits on its own work finishing: in-process hooks or CLI commands on a real SQLite store, git or bundle processes. Nothing in them waits on a timer the product could skip. The fix is the bound, as 001-309 (4) and (5) did, at describe level where every sibling has the same shape, so a sibling does not fail next (001-309 (3)).

| Test | Waits on | Bound |
| --- | --- | --- |
| `test/cli/status-wait.test.ts` (every describe) | The CLI's `status --wait` returning: its own wait of 300 ms to 5 s plus a store open and read every 250 ms poll | 30 s (`WAITS`) |
| `test/harness/stop-retry-bound.test.ts` | Three hooks in process, each opening the store | 30 s |
| `test/harness/stop-slow-untold.test.ts` | Both Stop entries in process; the waiting one polls the store up to `slowWaitMs` | 30 s |
| `test/cli/remove.test.ts` "deletes nothing and exits 1 while a daemon will not let go of its lock" | The product's 300 ms lock wait, after the store open and the stop request to a daemon that is not there | 30 s |
| `test/cli/setup/gates.test.ts` (both describes) | A fixture repository built by git processes, then `buildPlan` | 30 s (`FIXTURES`) |
| `test/cli/setup/setup-changes.test.ts` | `squeal setup --yes`, which runs git for each file it shows | 30 s |
| `test/harness/codex/bundles.test.ts` "without a usable store" | A bundle process per test | 60 s, the file's build bound |
| `test/daemon/escaped-overlap.test.ts` "afterEachRun, a mark per lane" | Up to two 10 s polls (`gone`, the nice-10 priority) and the stop's 1 s grace, which already ran past the 5 s test default | 30 s |

## `test/daemon/helpers.ts`: the daemon suite's `afterEach`

**Cause: the 10 s hook default, 001-309 (6)'s shape.** The shared `afterEach` of `daemonSuite` sends SIGTERM to each daemon a test started and waits for it to exit, with SIGKILL only after 60 s (`stopProcess`, `stopStrays`). In this row's full gate at load about 60, it timed out in `test/daemon/died.test.ts` "a stopped daemon still holds its lock and is not called dead". The next test, "an ordinary note before the kill does not hide the death", then failed on its own fixture directory, already removed (`ENOENT` on `flag`). The file passed 6 of 6 alone.

**Fix:** the `afterEach` gets `SLOW.timeout` (180 s), the bound the file's daemon tests already use. Its waits are unchanged, and each still ends by its own 60 s SIGKILL.

## `test/cli/codex-trust.test.ts`: the real Codex app-server

**Cause: a product deadline sized for a person, not a loaded runner.** `CODEX_APP_SERVER_TIMEOUT_MS` (10 s) bounds each app-server answer. The real app-server missed `initialize` within it at load 62 (`reviews/wave-13aw.md`).

**Fix:** the real-Codex test calls `initCodex` with `timeoutMs: 60_000` instead of `main`, so it waits on the same answer with a bound sized for CI. The test timeout goes from 120 s to 300 s to hold two app-server sessions and two `codex plugin` commands. The 10 s product default is unchanged. The stub's tests still go through `main` with `--trust --yes` (`:231`), and `:276` still checks that a silent app-server ends the command at its deadline (300 ms there).

## `test/scheduler/backlog-tiers.test.ts`: 200-file backlog against a direct run

**Cause: unpaired minima, 001-309 (8)'s shape.** The best of two direct runs was measured first, then one backlog minutes later under different load: backlog 15,336 ms against direct 5,103 ms in 001-309's background run.

**Fix:** a cold direct run first, unmeasured. Then three rounds, each a direct run immediately followed by a config edit that re-queues all 200 files. The median of the three backlog-to-direct ratios is asserted `< 2`, the same bound. Each round still checks 200 files, every tier completed and at most 3 tiers. The test timeout goes from 300 s to 600 s. At load about 100 it took 116 s.

## `test/e2e/lifecycle.test.ts`: the dead-daemon hook budgets

**Cause: a clock bound.** `HOOK_BUDGET_MS` (2 s, spec 001 D9's `timeout: 2`) asserted on one hook's wall time. Measured here at load 115, the same hook kind ranged from 94 to 2,189 ms (codex session-end) across one file's run. Squeal's baseline at load about 120 saw 5,281 ms for "is named in the delivered header" (`told`).

**Fix: pair it with the bundle's fixed cost.** Right after each budgeted hook, three PreToolUse runs go through the same plugin bundle. PreToolUse only reads the store and never ensures a daemon (`src/harness/shared/ensure.ts` is called from PostToolBatch, Stop, SessionStart and the prompt hook only), so the extra runs change nothing the test reads next. The bound is `max(HOOK_BUDGET_MS, 5 × median)`. One PreToolUse took 115 ms (claude-code) and 273 ms (codex) here at load 115, so the 2 s budget decides until the median passes 400 ms. A hook stuck on a 2 s socket timeout on a calm runner still fails. Under load the bound grows with the bundle's own start. A load spike on the budgeted hook alone can still fail it. That is the same trade as 001-309 (1): an inflated reference can hide a smaller delay. This covers the replacement SessionStart, `pre` and `told`.

"a bad squeal.config.json > yields one note and a running daemon" makes no `HOOK_BUDGET_MS` assertion, and its 240 s bound is far from the 5 s default. It failed once here at 52.8 s, in the first run after the edit above at load about 50. I did not capture the message. It passed in the next five runs (one alone, four in parallel) and is unchanged. If it fails again, keep the message: its waits are `registered`, `e.edit`, the `stop` CLI and `daemonReady`, each with its own bound in `test/e2e/harness.ts`.

## Seen beside this row, not changed

- `test/harness/stop-slow-untold.test.ts` "13an S2: a pending file moved and failed between two polls blocks once" (codex) failed once in a parallel batch with these files at load about 90: decision `block`, reason not matching `FAILS_AT(2)`, at 5,098 ms. It was an assertion, not a timeout. I did not capture the reason. Injected 2.1 s stalls at the first and second poll each gave the expected reason. It then passed 8 parallel runs of the file (320 tests). If it fails again, capture the reason first.

## A suspected product defect: the waiting Stop's handoff slack (reported, not fixed)

Stress run 15 at load 114: `test/harness/stop-slow-untold.test.ts:90` "13an S2: a pending file moved and failed at a newer key before its first read blocks" (claude-code) got `undefined` where `block` was expected, after 6,932 ms. This is not the 5 s default. The test bound is now 30 s.

`handedOver` (`src/harness/shared/stop-slow.ts:188`) counts the 2 s entry's handoff only if it was recorded after `now() - STOP_SLOW_HANDOFF_SLACK_MS` (2 s), with `now` read when the waiting entry reaches the check. That comes after its own Node start, policy read, store open and `recordStopWait`. The test runs the 2 s entry, then the waiting one. In a session the harness starts both at once. In both cases, if the waiting entry reaches the check more than 2 s after the 2 s entry recorded its handoff, the handoff reads as stale. The entry then polls for `STOP_SLOW_HANDOFF_MS` (3 s), returns `null` and says nothing. The turn ends with an untold slow failure, the case 004 D9 (as amended) and 001-305 block on. A scratch schedule that stalls the clock's first call (the handoff check) by 2.1 s reproduces it for both harnesses: waiting `{}`, turn `idle`.

The fix this suggests is product code: anchor the slack at the process's start (`performance.timeOrigin`, or `Date.now() - process.uptime() * 1000`), not at the check. A test-only fix, pinning the test clock's first call to the 2 s entry's end, would hide exactly this, so the test is unchanged. The coordinator filed it as its own product row, 001-326.
- Squeal's baseline in this worktree at load 113 to 126, while my own runs added load, hit the 5 s default in more files of the same shape as 001-309's "nine hook-bundle tests": `test/harness/{bundles,hooks,liveness,pre-tool-use,primer-coverage,session-lifecycle,starting-daemon,stop-nudge,stop-require-slow,stop-slow-boundary}.test.ts` and `test/evals/malformed.test.ts`. `test/harness/codex/latency.test.ts` and `test/harness/starting-daemon.test.ts` hit the 10 s hook default in `test/store/helpers.ts`. The same baseline failed `test/daemon/handover.test.ts`, `test/daemon/step-down.test.ts` (`alive` where `spawned` was expected) and `test/cli/warmup.test.ts`. All three passed together at load 58 (16 of 16). The row does not name them, so they are unchanged. They are the shared cause 001-309's notes name: the 5 s default against a loaded host.
