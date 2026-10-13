# 001-320 notes: more tests that hit the 5 s default under load, and `isAlive`

001-309's method: for each test, what it waits on, why load broke the wait, and the fix. Every fix here is to tests. The one product defect found, the waiting Stop's handoff slack, is reported below and went to its own row, 001-326.

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

**Fix: pair it with the bundle's fixed cost.** Right after each budgeted hook, three PreToolUse runs go through the same plugin bundle. PreToolUse never ensures a daemon (`src/harness/shared/ensure.ts` is called from PostToolBatch, Stop, SessionStart and the prompt hook only) and changes no lifecycle state these cases assert. It is not read-only: it puts an idle consumer back in a turn and can mark an undelivered regression told (`src/harness/shared/deny.ts:28`), and these fixtures have no untold regression when it runs. The bound is `max(HOOK_BUDGET_MS, 5 × median)`. One PreToolUse took 115 ms (claude-code) and 273 ms (codex) here at load 115, so the 2 s budget decides until the median passes 400 ms. A hook stuck on a 2 s socket timeout on a calm runner still fails. Under load the bound grows with the bundle's own start. A load spike on the budgeted hook alone can still fail it. That is the same trade as 001-309 (1): an inflated reference can hide a smaller delay. This covers the replacement SessionStart, `pre` and `told`.

"a bad squeal.config.json > yields one note and a running daemon" makes no `HOOK_BUDGET_MS` assertion, and its 240 s bound is far from the 5 s default. It failed once here at 52.8 s, in the first run after the edit above at load about 50. I did not capture the message. It passed in the next five runs (one alone, four in parallel) and is unchanged. If it fails again, keep the message: its waits are `registered`, `e.edit`, the `stop` CLI and `daemonReady`, each with its own bound in `test/e2e/harness.ts`.

The coordinator's landing gate failed it again (codex, load about 55): `timed out after 45000 ms waiting for a ready daemon` at `test/e2e/lifecycle.test.ts:150`, the `daemonReady` wait. Run alone right after, the file passed 6 of 6. It is accepted as a load timeout and left unchanged.

## 001-331: where a budgeted hook's time goes under load (`reviews/wave-13bb.md` B1)

Review 001-329's full run failed the claude-code replacement SessionStart at 4,428 ms against `max(2000, 5 × 155)`. The repair measured before changing anything.

**Probe.** A scratch `--import` preload (not committed), passed to the fixture's hooks through `NODE_OPTIONS` by a temporary harness edit, timed each hook process from Node's start: the preload, every `node:sqlite` call (the database file's and WAL's size and mtime around each `COMMIT`), each socket connect, each `spawn`, each `timers/promises` sleep and the exit; the harness's wall time came beside it. The dead-daemon cases (both harnesses) ran 18 times while a full suite and another coordinator's gate ran, load 8 to 72: 856 hook processes.

| | p50 | p95 | max |
| --- | --- | --- | --- |
| In the process, outside SQLite | 54 ms | 155 ms | 584 ms |
| In SQLite | 2 ms | 349 ms | 4,193 ms |
| Outside the process (launch, exit, pipes) | about 15 ms | | |

- Every SQLite call over 200 ms was a `COMMIT`, a connection's `close` or a `ROLLBACK`, about 350 ms each. Each slow `COMMIT` took the WAL from 0 to 4,152 bytes (a header and one frame) and left the database file's mtime alone: the sync of a fresh WAL's header, not a checkpoint. A slow `close` is the last connection's checkpoint, with the daemon dead.
- The failure reproduced: "is named in the delivered header", claude-code, `pre` at 4,243 ms, 3,502 ms of it in one `COMMIT` and 4,193 ms in SQLite, against a PreToolUse median of 97 ms. Node's start to the preload took 23 ms and the exit 12 ms.
- The replacement SessionStart spends nothing in `settle`: the SIGKILLed daemon's heartbeat is still fresh, so the settle returns at once. Its socket probe answers `ECONNREFUSED` in about 4 ms and its `spawn` takes 3 to 6 ms. Its slow runs were `close` (245 to 491 ms). No SessionStart over 2 s recurred in these runs; by the distribution above the review's 4,428 ms is the same stall, an inference.
- A bare `fsync` of a new 4 KiB file: on `/tmp` (ext4, the host's root disk) 341 ms, then 2 to 4 ms each; on `/dev/shm` (tmpfs) 0 ms. The first sync of a new or truncated file waits for the file system's journal commit, which other processes' writes fill.

**Cause.** The time is the store's sync on a disk the host shares, not the process launch, the daemon ensure or a timer. The PreToolUse references pay the same kind of sync (their `COMMIT`s took 350 ms too), but a journal stall lands on one process: three references taken after the hook cannot predict it. Not a product delay of the kind D9 forbids: the hooks wait on no timer, socket or daemon there; it is D8's WAL with `synchronous=NORMAL` on a host whose journal commits stall. The coordinator recorded it as an observation for D8, with no product row.

**Fix: the fixture condition.** The two dead-daemon cases build their fixture on tmpfs (`FixtureOptions.tmpfs`, `/dev/shm`), store included, and fall back to `/tmp` where there is none (macOS). The formula, the three references and every replacement, PID, header, failure-delivery and once-only assertion are unchanged; the bad-config case stays on `/tmp`. Probed again on tmpfs, 6 runs at load 17 to 27, 288 hooks: SQLite p50/p95/max 1/3/9 ms, no call over 200 ms; outside SQLite 53/84/468 ms. What it still catches on a calm runner: a hook that waits on a timer, a socket or a daemon of its own for 2 s, since the median stays near 100 ms and the 2 s budget decides. What it gives up: a hook whose own syncs grow past the budget on a real disk; nothing here measured that before either, since the references paid the same syncs.

**Stress, at 0e9550f3.** The lifecycle file ran 20 times in a row, 19:36 to 19:53, while full suites ran one after another (both green: 460 files passed, 1 skipped, in 649 s and 572 s), another coordinator's work also loading the host, at load 25 to 82. The replacement checks passed in all 20 runs, as did both dead-daemon cases on both harnesses: 120 budgeted hooks, the slowest 430 ms against a PreToolUse median of 126 ms, no hook above 22 % of its bound, the largest median 339 ms. Run 8 failed only the bad-config case (below). `/dev/shm` held no `squeal-e2e-` directory afterwards.

**The bad-config `daemonReady` timeout recurred**, unchanged and on `/tmp`: stress run 8, claude-code, 19:42, load 82 at its start and 42 after, `timed out after 45000 ms waiting for a ready daemon in /tmp/squeal-e2e-QPl4gv/repo` at `test/e2e/lifecycle.test.ts:157` (the same wait, moved by the longer comment above). The fixture was already removed by cleanup, so that run left no daemon notes or processes. To catch the next one, the case ran 30 more times (both harnesses, 19:56 to 20:02, load 19 to 56, a full suite alongside) with an uncommitted diagnostic that, on that timeout, wrote the ping, status's daemon and notes, the fixture's daemon PIDs with `ps` (state, wait channel, age), the `stop` command's result, the third SessionStart's time and text, and the store directory. All 30 passed, so there is still no evidence of the cause. The test is unchanged. The diagnostic is in the next paragraph for whoever meets it again.

The diagnostic wraps `await e.daemonReady(e.main, first.pid)` in that case in a `try`. Before it, the case keeps the `stop` result, `daemonPids(e.plugin)` after the stop and after the third SessionStart, and that hook's result. On a throw it appends one JSON object to `$SQUEAL_DIAG_LOG` and rethrows. The object holds those values, `ps -o pid,ppid,stat,etime,pcpu,wchan:20,args` of the PIDs, `e.ping`, `e.status` (`daemon`, `revision`, `daemonNotes`), `ls -laR <repo>/.git/squeal`, `/proc/loadavg` and the error.

## Seen beside this row, not changed

- `test/harness/stop-slow-untold.test.ts` "13an S2: a pending file moved and failed between two polls blocks once" (codex) failed once in a parallel batch with these files at load about 90: decision `block`, reason not matching `FAILS_AT(2)`, at 5,098 ms. It was an assertion, not a timeout. I did not capture the reason. Injected 2.1 s stalls at the first and second poll each gave the expected reason. It then passed 8 parallel runs of the file (320 tests). If it fails again, capture the reason first.

## A suspected product defect: the waiting Stop's handoff slack (reported, not fixed)

Stress run 15 at load 114: `test/harness/stop-slow-untold.test.ts:90` "13an S2: a pending file moved and failed at a newer key before its first read blocks" (claude-code) got `undefined` where `block` was expected, after 6,932 ms. This is not the 5 s default. The test bound is now 30 s.

`handedOver` (`src/harness/shared/stop-slow.ts:188`) counts the 2 s entry's handoff only if it was recorded after `now() - STOP_SLOW_HANDOFF_SLACK_MS` (2 s), with `now` read when the waiting entry reaches the check. That comes after its own Node start, policy read, store open and `recordStopWait`. The test runs the 2 s entry, then the waiting one. In a session the harness starts both at once. In both cases, if the waiting entry reaches the check more than 2 s after the 2 s entry recorded its handoff, the handoff reads as stale. The entry then polls for `STOP_SLOW_HANDOFF_MS` (3 s), returns `null` and says nothing. The turn ends with an untold slow failure, the case 004 D9 (as amended) and 001-305 block on. A scratch schedule that stalls the clock's first call (the handoff check) by 2.1 s reproduces it for both harnesses: waiting `{}`, turn `idle`.

The fix this suggests is product code: anchor the slack at the process's start (`performance.timeOrigin`, or `Date.now() - process.uptime() * 1000`), not at the check. A test-only fix, pinning the test clock's first call to the 2 s entry's end, would hide exactly this, so the test is unchanged. The coordinator filed it as its own product row, 001-326.
- Squeal's baseline in this worktree at load 113 to 126, while my own runs added load, hit the 5 s default in more files of the same shape as 001-309's "nine hook-bundle tests": `test/harness/{bundles,hooks,liveness,pre-tool-use,primer-coverage,session-lifecycle,starting-daemon,stop-nudge,stop-require-slow,stop-slow-boundary}.test.ts` and `test/evals/malformed.test.ts`. `test/harness/codex/latency.test.ts` and `test/harness/starting-daemon.test.ts` hit the 10 s hook default in `test/store/helpers.ts`. The same baseline failed `test/daemon/handover.test.ts`, `test/daemon/step-down.test.ts` (`alive` where `spawned` was expected) and `test/cli/warmup.test.ts`. All three passed together at load 58 (16 of 16). The row does not name them, so they are unchanged. They are the shared cause 001-309's notes name: the 5 s default against a loaded host.
