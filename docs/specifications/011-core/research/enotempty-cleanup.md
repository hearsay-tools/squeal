# What writes into a test's folder after the test removes it (row 011-333)

Researcher, 2026-11-14. Brief: `../tasks/wave-85.md` R2. Board rows ci-43472769648, ci-43160803419. Diagnosis only; nothing here changes code.

## Verdict

Three different writers, one shared shape. Each test removes a folder while a process that the test, or the code under test, started still writes there, and no step waits for that process. One shared amplifier makes the two open cases fail on Node 22 only: on Node 22.19, `rmSync`'s `maxRetries` retries only the last `rmdir` and never removes the new entries again, so the retries that `32c2dc0aa` and `21bc74400` added cannot work on the Node 22 shards. On Node 24 and 26 each retry repeats the whole removal, and since `21bc74400` landed no Node 26 shard failed this way.

| Test | Writer | Tag | Status |
|---|---|---|---|
| `test/runners/node-test/run.test.ts` "reports nothing of a run stopped after the checkout holding its store went" | The busy-loop file's own processes as they start: Squeal's module recorder appends `graph-1-<pid>.ndjson` by path (`src/runners/node-test/runtime/recorder.cjs`, `appendFileSync` per resolved import), and `node --test` creates `events-1.ndjson`, its reporter destination | verified by experiment | open: 5 CI failures, all Node 22, 3 after the retry landed |
| `test/harness/opencode-dispose.test.ts` "serve: input routed to the re-created instance drops the old turn's report" | The Squeal OpenCode plugin's `end` bridge (`hooks/end.mjs`). `callBridge` spawns it with `detached: true` (`src/harness/opencode/bridge-client.ts:101`), so `runOpenCode`'s kill of OpenCode's process group misses it, and nothing waits for it. It opens the run's store under `proj/.git/squeal` with `O_CREAT` while the removal runs | verified by experiment (it writes during the removal); the entry that made the top folder non-empty on CI is inferred | open: 6 CI failures; 4 on Node 26 before `21bc74400`, 2 on Node 22 after it |
| `test/daemon/died.test.ts` "an ordinary note before the kill does not hide the death" | The runner host a SIGKILLed daemon leaves. It logs its cancelled run with a recursive `mkdir` that recreates the removed fixture folders (row 018-37) | read in source code and board row 018-37 | fixed: CI 43160803419 ran at `4d758d722`, before `2a21588ec` (018-37) and 0.1.449 (018-38) landed; no `died.test.ts` ENOTEMPTY in the 42 CI runs since 2026-11-13 00:51Z |

## Findings

### 1. Node 22.19's `rmSync` retry cannot outlast a writer (read in source code, verified by experiment)

Node v22.19.0 `lib/internal/fs/rimraf.js`, `_rmdirSync` (lines 234–279): on `ENOTEMPTY` it lists the folder and removes each child once, then loops `for (let i = 1; i <= tries; i++) { try { return fs.rmdirSync(path); } … sleep(i * options.retryDelay) }`. The loop retries only `rmdirSync(path)`. An entry made after the child sweep stays, and every retry meets it. With `maxRetries: 20, retryDelay: 50` the sleeps add up to 50 × (1 + … + 20) = 10,500 ms. The failed CI tests took 10,710 ms (43472769648) and 11,211 ms (43485856699): the retries ran in full and could not succeed.

Node v24.15.0 and v26.13.0 `src/node_file.cc`, `RmSync`: each retry calls `std::filesystem::remove_all(file_path)` again, so a retry removes the new entries too. (Their delay is `sleep(i * retryDelay / 1000)` in whole seconds: 0 s for `retryDelay: 50` until `i` reaches 20.)

Probe `probes/enotempty-cleanup/rmsync-retry.mjs`: a second process adds files for 300 ms and then stops, while the first runs `rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })`. Results on this host (load average 114–118, other sessions' work): Node 22.19.0 `ENOTEMPTY` 3 of 3, with the late files still there; Node 24.15.0 removed 3 of 3; Node 26.13.0 removed 1 of 1 (stopped after one to spare the host).

CI history agrees (scan of the failed attempts of the 200 `ci.yml` runs since 2026-11-10, 83 logs, `gh run view --attempt N --log-failed`): the OpenCode test failed on Node 26 four times before `21bc74400` added retries (43189918961, 43197577327, 43213689304, 43334789670) and never on Node 26 after it; it failed twice on Node 22 after it (43498778395, 43514823592 attempt 2). The node:test run test failed only on Node 22: twice before `32c2dc0aa` (43319782267 attempts 1 and 2) and three times after it (43472769648, 43485856699, 43522974496).

### 2. node:test run test: the run's own processes (verified by experiment)

The test waits for `stdout-1.log`, then removes the checkout, then aborts the run. `startGroup` opens `stdout-1.log` before it spawns the file's processes (`src/runners/process/group.ts:41`), so the delete starts while `node --test` and its test child are still loading tsx. Each resolved import appends a line to `<logDir>/graph-1-<pid>.ndjson` by path (`recorder.cjs`, "written at once, so a process killed at the deadline keeps what it loaded"); an append by path makes the file again after a delete.

Probe `probes/enotempty-cleanup/node-test-writers.ts` repeats the test's steps on Node 22.19.0, empties the log folder at the test's moment, then deletes and lists each new entry for 3 s. One run at load average 114: 36 entries made again, `graph-1-<pid>.ndjson` from 357 ms to 1,295 ms after the sweep, and `events-1.ndjson` at 377 ms. Each one lands directly in `edge`, the folder CI names. The test removes the checkout during the run on purpose (row 018-38), so these writes are expected; only the removal method is wrong.

### 3. OpenCode dispose test: the detached `end` bridge (verified in part)

One `strace -f` run of the test on Node 22.19.0 (`probes/enotempty-cleanup/late-writes.py` reads the trace). Its three attempts missed their barriers under strace and load, so each run folder went through `runOpenCode`'s error path, not `run.cleanup()`. In all three removals a process running `node /tmp/sq-oc-*/hooks/end.mjs` opened `proj/.git/squeal/store.sqlite`, `-wal` and `-shm` with `O_CREAT` 86–330 ms after the removal began; the bridge had started 40–80 ms before the removal. On SIGTERM, OpenCode ends the plugin, which spawns this bridge in its own process group. `runOpenCode` kills only OpenCode's group (`test/helpers/opencode.ts:239`) and returns, and `afterEach` removes the folder while the bridge still starts.

Two points stay open. (a) In the trace, every late entry was below `proj/.git/squeal`, and all three removals succeeded. Node 22's removal names the folder whose last `rmdir` failed, and CI named the top folder `squeal-opencode-*`, so on CI some writer made a new entry directly in it (for example with a recursive `mkdir` of `xdg/…`, `tmp/…` or `proj/…`). The bridge, as traced, makes no such entry. Not determined which process did; candidates are other processes outside OpenCode's group. (b) The error path removes the folder before it kills OpenCode: `catch { rmSync(dir) }` runs before `finally { killGroup(child, "SIGKILL") }` (`test/helpers/opencode.ts:236–239`). The trace shows OpenCode's own processes still reading the run folder during that removal. This is a second race of the same kind, on a path CI has not failed yet.

### 4. Daemon `died.test.ts`: fixed by rows 018-37 and 018-38 (read in source code)

`test/daemon/helpers.ts` at `4d758d722`, the commit CI 43160803419 ran, has no `awaitRunnerHosts`. The current file explains the race (lines 345–354): "a daemon a test kills with SIGKILL leaves its runner hosts … `writeRunLog` makes `.git/squeal/runs/<id>` with a recursive mkdir", which recreates the fixture's `main`. Row 018-37 (`2a21588ec`, committed 2026-11-12 10:41Z) makes the teardown wait for those hosts, and row 018-38 (0.1.449) stops a run log from recreating a removed folder. In the 83 scanned logs the last `died.test.ts` ENOTEMPTY is CI 43194712526 (2026-11-12 10:03Z), before the fix.

## Recommendation

One tests-only row under spec 011, for a worker. It touches no product code.

1. **A shared removal helper** in `test/helpers/`, for example `removeTree(dir, { timeoutMs })`. It repeats the whole `rmSync(dir, { recursive: true, force: true })` until the folder is gone, or fails at the deadline and names what is left. It replaces `maxRetries` in the two open tests, so the removal behaves the same on Node 22, 24 and 26. Eight other test files also pass `maxRetries` to `rmSync` (`test/store/helpers.ts`, `test/code/helpers.ts`, `test/lint/helpers.ts`, `test/lint/oxlint/helpers.ts`, `test/lint/provider/helpers.ts`, `test/policy/repository-inputs.test.ts`, `test/e2e/harness.ts`) or to `rm` (`test/keys/validity/self-test.test.ts`, the callback form, not examined); the synchronous ones have the same Node 22 gap; the worker moves them only where a writer can outlive the test.
2. **node:test run test**: rename the checkout away in one step (`renameSync(checkout, gone)`). The checkout then disappears at once, which is the test's subject. Remove the renamed folder after `await running`, when the run's processes have ended. Alternative: `removeTree` while the run is live.
3. **OpenCode helper**: before `cleanup()` removes the folder, wait for the plugin's bridges, which `detached: true` puts outside OpenCode's process group. `stopStrays` and `awaitRunnerHosts` in `test/daemon/helpers.ts` already do this from `ps`: here, wait for processes whose command runs `<built.dir>/hooks/*.mjs`, with a deadline, and kill them after it. On the error path, kill OpenCode's group and wait for it to exit before the `rmSync`. Use `removeTree` as the last step.
4. **Daemon test**: no change. Resolve board row ci-43160803419 as the 018-37 race, fixed after that run.

Owner: the coordinator of spec 011, as one row after the human's decision. Evidence that the fix works: a Node 22 shard log where the two tests pass, and the next 20 or more main runs without this ENOTEMPTY (5 of the last 42 runs had it).

## Open questions

- Which process made the new top-level entry in `squeal-opencode-*` on CI (section 3a). A trace of `run.cleanup()` on the success path would show it. That needs a run in which the barriers hold, which this host's load (average 114–118) did not give in three attempts.
- Whether product code has the same Node 22 gap: no `src/` file passes `maxRetries` (checked by grep), so none was found.

## Sources

- CI logs: `gh run view <id> --attempt N --log-failed` for 43472769648, 43485856699, 43498778395, 43160803419, and the failed attempts of the 200 `ci.yml` runs since 2026-11-10.
- Node v22.19.0 `lib/internal/fs/rimraf.js`, `lib/fs.js` (`rmSync`): https://raw.githubusercontent.com/nodejs/node/v22.19.0/lib/internal/fs/rimraf.js
- Node v24.15.0 and v26.13.0 `src/node_file.cc` (`RmSync`): https://raw.githubusercontent.com/nodejs/node/v26.13.0/src/node_file.cc
- Repository at `f206c9146`: `test/runners/node-test/run.test.ts:235–264`, `src/runners/node-test/run/run.ts`, `src/runners/node-test/runtime/recorder.cjs`, `src/runners/process/group.ts`, `test/helpers/opencode.ts:170–241`, `src/harness/opencode/bridge-client.ts:84–110`, `test/daemon/helpers.ts:320–375`, `.github/workflows/ci.yml` (Node 22.19 pinned; Node 26 full suite on push).
- Probes, throwaway: `probes/enotempty-cleanup/` (README there).
