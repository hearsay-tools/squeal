# 008 wave 2 review

Verdict: **PASS 20647e10**. **0 proven blockers**, 1 proven should-fix note, no nits. Reviewed 2026-10-15 (Europe/Warsaw). Exact candidate: `20647e1005368879e3c811406e44effadbc4b1be`, `cand/0.1.184`; range `38c71b05..20647e10`. Scope: 008-21, 008-22, 008-19, the coordinator's test edits and the version/bundle integration. The 008-23 brief was read from `origin/main`. This is the candidate review; the full-suite evidence is qualified below.

## Verification output

The starting HEAD matched the candidate and the tree was clean. All commands below ran at that HEAD. Installation, static checks, build, the targeted suites and external probes ran on the clean candidate before this report was written. The late Squeal failure below was produced at clean revision 0, then inspected after this report created docs-only revision 1. Final full-suite checkpoint verification returned to a clean checkout of the exact candidate at revision 3; the worker branch was then restored for the report-only follow-up. The brief's explicit host policy overrides the reviewer skill's usual independent full run: Squeal supplies the checkpoint; the coordinator owns the concurrent independent gate. No independent full suite was started here.

```text
$ git rev-parse HEAD
20647e1005368879e3c811406e44effadbc4b1be
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.184 lint
> biome check .
Checked 1223 files in 4s. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.184 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.184 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.184 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)
$ git diff --check 38c71b05..20647e10
(no output)
exit 0
```

`npm ci` also printed the `node-domexception` deprecation and six allowScripts notices. Installation succeeded. Build regenerated all four committed plugin trees without drift.

```text
$ npx vitest run test/harness/opencode/bridge-client.test.ts test/harness/opencode/idle.test.ts test/harness/opencode/hooks.test.ts test/harness/opencode/turn.test.ts test/harness/opencode/fresh-store.test.ts test/harness/opencode/latency.test.ts test/harness/opencode/package.test.ts test/harness/opencode-hooks.test.ts test/e2e/opencode.test.ts test/keys/key-format.test.ts --maxWorkers=2
Test Files  10 passed (10)
     Tests  100 passed (100)
  Duration  172.45s
exit 0
```

There were no skips in this targeted run. Real OpenCode ran only through `runOpenCode`, with its isolated HOME, TMPDIR, XDG directories, config and git repository. The shipped-package e2e uses the candidate's copied tracked files and the real `opencode plugin file:<current> -g`, including the copied CLI's actual daemon. The other real-host tests build into temporary directories and use controlled daemon/store fixtures; they are not substitutes for that shipped-package proof.

The full checkpoint did not yield a verdict within the ten-minute review allowance. The original unlimited CLI waiter was stopped (exit 143); this stopped the waiting CLI, not the daemon. A 1 ms bounded request returned exit 3 before its request was recorded. The subsequent 1 s bounded request joined the already-running checkpoint and returned the following actual output. Neither bounded request forced already-current files to run.

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait 1000
Checkpoint 63b3f27b-4808-47aa-b84b-9cdc2b1d44e3 has no verdict: the deadline passed with 386 test files pending at revision 0; the checkpoint goes on in the daemon
Checkpoint 63b3f27b-4808-47aa-b84b-9cdc2b1d44e3 started at revision 0: 386 test files to run, 200 already current, joining the `run --all` checkpoint b28e4c38-cb35-4afe-b8a0-61802c0984c6 already running them (0 of 386 test files done); it ends when that one ends

Revision: 0
Known failures: 0
Affected checks: 2158 passed (1958 tests, 200 test files loaded), 0 running, 0 queued; 386 test files without checks yet: 186 running, 200 queued
Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs" run --all` requests one)
Checkpoint in progress: `run --all` requested at revision 0, started 11 s ago: 0 of 386 test files done (`node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs" run --all --wait` waits for it)

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/68edb989-c07e-4f04-8400-5e8cec1128d0 (HEAD 20647e1, dirty state not known: no revision recorded yet)
Daemon: running, last heartbeat 4 s ago
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without checks: 386 pending, 0 unknown
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  no revision recorded for this worktree yet
  2026-10-14T23:48:16.501Z, revision 0: no dependencies are installed in this worktree; Squeal lists and runs no tests until an install
exit 3
```

**Initial verification limit, superseded by the final checkpoint below.** The first checkpoint progressed through 400 of 586 files; an intermediate status had 200 unknown files and 186 still running. The bounded follow-up has 200 already current and 386 pending, with zero known failures. The daemon is alive and continues the requested work. The revision remains 0 with no recorded revision provenance; this is not evidence of a clean-revision full-suite pass. No independent full suite was run, per the brief. No cause is assigned to the missing verdict, and this verification limit is not a product finding against the range. At that point the coordinator still needed its passing landing gate; the targeted pass was not a full-suite substitute. The final checkpoint below closes this review's full-suite verification.


### Late full-run failure

After the bounded output above and before the report commit, Squeal delivered a **proven test timeout**, produced at clean revision 0 and commit `20647e1`:

```text
FAIL test/watcher/parcel-root.test.ts > parcel backend, an event @parcel/watcher erased from the root watch > stats at most 1024 entries of the named directories per batch
Test timed out in 5000ms.
at test/watcher/parcel-root.test.ts:201:3
load average 96.08 when it ran

$ squeal why "test/watcher/parcel-root.test.ts > parcel backend, an event @parcel/watcher erased from the root watch > stats at most 1024 entries of the named directories per batch"
Known state: FAIL, current, observed at revision 0, commit 20647e1
Summary: Test timed out in 5000ms.
FAIL ... (this worktree), revision 0, commit 20647e1, clean
run 401c9fa5-8988-4795-a31e-f9adb826c138, 11938 ms

$ squeal status
Revision: 1
Known failures: 1 (1 test)
Affected checks: 3319 passed (2934 tests, 385 test files loaded), 0 running, 0 queued, 7 skipped (7 tests); 201 test files without checks yet: 199 running, 2 queued
Full-suite checkpoint: none completed at any revision
Checkpoint in progress: 185 of 386 test files done
```

The shortened `squeal` labels use the same absolute CLI command as above. The inspection's revision 1 changes only this review document; it does not relabel the recorded failure as clean-revision-1 evidence. The watcher test and watcher implementation have no changes in the candidate range. **Plausible:** host contention contributed to the timeout. **Proven on follow-up:** Squeal delivered `FAIL -> PASS` for this failure and explicitly labelled it `Flaky: FAIL -> PASS under the same inputs`. This is the current run's recovery, not the older historical recovery mentioned by `why`. This is a known verification failure outside the review's code range, not a proven new adapter break. The final checkpoint below includes the recovery and zero known failures. The intermediate one-failure snapshot is retained to make the loaded timeout visible; it is superseded by the final result.

### Final full-suite checkpoint

**Proven:** the watched work finished, all 586 test files became current, and the watcher timeout recovered under the same inputs. The completed revision-2 checkpoint was first read on the report-only descendant. I then detached at the exact candidate `20647e1005368879e3c811406e44effadbc4b1be`, confirmed a clean tree, and obtained the following revision-3 checkpoint. It reused all 586 current files and started no new test run. The full-suite verdict is therefore the brief's required Squeal verdict on the clean candidate, not an independent full-run claim.

```text
$ git rev-parse HEAD
20647e1005368879e3c811406e44effadbc4b1be
$ git status --short
(no output)
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait 60000
Checkpoint 77602fb3-c0ce-47b2-91c8-3e76be89ed95 completed at revision 3: no known failures; 586 test files, 586 already current, 0 run now
Checkpoint 77602fb3-c0ce-47b2-91c8-3e76be89ed95 started at revision 3: 0 test files to run, 586 already current

Revision: 3
Known failures: 0
Affected checks: 5439 passed (4853 tests, 586 test files loaded), 0 running, 0 queued, 10 skipped (10 tests)
Full-suite checkpoint: completed at revision 3

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/68edb989-c07e-4f04-8400-5e8cec1128d0 (HEAD 20647e1, clean at revision 3)
Daemon: running, last heartbeat 2 s ago
Inherited from other worktrees: 37 current results (36 tests, 1 test file loaded)
  37 (36 tests, 1 test file loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dda82ed-d43b-4fa4-9246-d474cf5f9d89 at 20647e1
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  2026-10-14T23:48:16.501Z, revision 0: no dependencies are installed in this worktree; Squeal lists and runs no tests until an install
exit 0
```

Squeal's 37 inherited current results comprise 36 tests and one loaded file from the coordinator's worktree at the same candidate. The remaining results were run here. Ten tests are marked skipped; no pending, stale or unknown files remain. The old no-dependencies note is historical and does not override the current completed verdict. Restoring the worker branch and committing this amended report changes only the review document.

A supplemental latency run printed the measurements suppressed in the default passing-test output:

```text
$ npx vitest run test/harness/opencode/latency.test.ts --maxWorkers=1 --silent=false --disableConsoleIntercept
OpenCode bridge beside Codex hooks, p95 ms, best of up to 1 rounds of 5 cold runs, interleaved; bare bridge (ping) p95 100; load 38.30 31.47 25.90, above 4 or in CI: reported only
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  18.55s
exit 0
```

| Bridge / Codex hook | OpenCode p95 ms | Codex p95 ms |
| --- | ---: | ---: |
| register / session-start | 144 | 244 |
| prompt / user-prompt-submit | 189 | 270 |
| before edit / pre-tool-use | 117 | 226 |
| before bash / pre-tool-use, silent | 168 | 219 |
| after / post-tool-use | 207 | 229 |
| after / post-tool-use, silent | 139 | 209 |
| stop / stop | 235 | 261 |
| stop / stop, silent | 214 | 195 |
| endTurn / interrupt | 123 | 129 |
| end child / subagent-stop | 155 | 181 |

These are **proven loaded measurements**, not proof of the calm-load 10 ms margin. The loaded idle regression passed in the targeted run; this review did not independently repeat the worker's ten-run check.

### Discriminating probes

External throwaway probes ran against the clean candidate and changed no project files.

1. **Proven:** actual Node **22.13.0** and **24.21.0** executed `bridgeStart`'s arguments and preload. Each tested an absent switch, an empty switch and `"1"`, then spawned a child and grandchild using Node's normal inherited environment. All six cases passed:

```text
Node         input     bridge / child / grandchild
v22.13.0     absent    present=false, value=null, carried=false
v22.13.0     empty     present=true,  value="",   carried=false
v22.13.0     "1"       present=true,  value="1",  carried=false
v24.21.0     absent    present=false, value=null, carried=false
v24.21.0     empty     present=true,  value="",   carried=false
v24.21.0     "1"       present=true,  value="1",  carried=false
exit 0
```

This executes the minimum supported Node, rather than inferring support from a later Node 22. The committed bridge-client test also proves that the bridge skips Node's HTTP-agent proxy setup while its child sees the switch. **Read in source:** `ensureDaemon` (`src/core/daemon/ensure.ts:189`) spawns the daemon with the restored process environment; `bridgeDeps` also exposes that restored environment. Nothing in this diff changes the daemon-to-runner environment contract. The shared bridge path uses the local socket and store, not HTTP. The matrix directly tests descendant inheritance; it is not a separate actual-daemon/real-test environment experiment.

2. **Proven:** an external Vitest file tested the real `after`, `prompt` and `register` handlers. A git repository with `squeal.config.json` and no store returns `{text: null}` from an `after` requesting a primer, and a null primer from `prompt`. A registered consumer's policy was then changed to a node:test project named `review-node` with `checks/**/*.test.js`; the next prompt's primer named both. Explicitly removing that consumer and prompting again re-registered it and returned the new coverage. Result: **1 file, 2 tests passed, 1.29 s, exit 0**.

3. **Proven:** an external copy of `bridge-client.test.ts` retained its actual `afterEach`, started a stalling bridge and grandchild, recorded their pids, then deliberately failed before the bridge deadline. The one selected test exited **1 for the intentional failure**, and both recorded pids were **gone** afterward. The failure was induced in the external probe only. It is not a candidate test failure. This exercises the teardown on a red path rather than relying on the ordinary passing deadline test.

## Blockers

None. No proven break of the candidate's changed contracts was found.

## Should-fix

### S1. Proven: retain the empty-switch and changed-coverage cases in the committed tests

`test/harness/opencode/bridge-client.test.ts:149`, `:177`; `test/harness/opencode/turn.test.ts:80`.

The committed environment tests execute restoration only for `"1"`; the absent case checks the returned arguments/environment without launching the bridge, and no test launches the empty case. The new prompt-primer test only checks that the unchanged primer contains the CLI command. Thus it does not establish the behavior named by its title, coverage changing since registration. The external probes above prove that the current implementation handles all these cases; this is a **proven regression-coverage gap**, not a product break and not blocking.

Fix, one test-only row: parameterize the execution probe over absent/empty/`"1"`, asserting both presence and value in descendants and no carried variable. Extend the real-handler prompt test to change coverage policy after registration, then expire/unregister the consumer and verify re-registration preserves the new coverage. Run those two test files. No production API change is needed.

## Nits

None.

## What fits

- **Proven, 008-21 / 001 D11:** the preload removes startup proxy work and restores the exact switch, including absence and empty-string semantics, before descendants inherit it. It executes on Node 22.13.0. Other environment values are preserved by the object rest operation. Temporary carrier metadata is removed before the entry runs.
- **Proven, 008-21:** the Stop-start and release barriers order the abort/input overlap by causal facts. The tests retain no-continuation and report-once assertions without relying on independent process-log order. Recorded bridge/grandchild pids are cleaned after an intentional failed test.
- **Proven, 008-22 / D3:** `after` produces a primer only after `deliver` has registered/found the consumer. `prompt` checks `isRegistered` in its second context and refreshes coverage. Missing stores produce no new primer. All three primer sources feed the same system transform, whose 8,000-character cap is unchanged and tested.
- **Proven by code and targeted checks, D4:** the second store open occurs inside the same prompt bridge process. `chat.message` creates one absolute deadline, passes its remainder to `callBridge`, and kills the process group on expiry. Opening twice spends that same budget; it does not add another 2 s. The loaded prompt p95 was 189 ms. No lock-contention latency promise is inferred from that sample.
- **Proven, 008-19:** the shipped-copy e2e establishes registration after the first cold-store tool boundary, the primer in subsequent model requests, baseline, regression and recovery in tool results, once-only denial and re-issued write, one end-of-turn continuation, one pending-file wake under `serve`, shell consumer attribution/status pull, and silence when Squeal is not set up. It asserts the copied daemon and global file-plugin entry. The helper constructs an environment from its allowlisted values rather than spreading the real environment, and uses the same isolated home for the plugin-install subprocess.
- **Proven / honest test scope, coordinator edit:** `opencode-hooks.test.ts:131` still asserts the child consumer ended at child idle. It drops the immediate root-dispose assertion and states that scope explicitly. D3 permits dispose to miss its deadline; D3/D8 and 001 D10 end that root through its recorded OpenCode process. `bridgeDeps` records OpenCode's pid, `dropGoneHarnesses` checks namespace/start time/death, and the daemon runs that sweep at heartbeat. The changed test uses a stand-in daemon, so it cannot prove the fallback sweep. It no longer claims to. There is no changed cleanup contract hidden by the assertion.
- **Proven:** all four regenerated committed bundles match the build; OpenCode package parity and key-format guard pass. No shared core, daemon or runner source changes in the range. The version metadata and install script consistently name 0.1.184.

## Inputs for the next wave

- Keep `after.primer` opt-in while the plugin has no primer, the per-prompt refreshed primer, and the common capped system transform. A cold store may leave the first request without the primer; the first request after successful consumer registration must carry it.
- Keep one deadline covering identity lookup and every bridge operation. The new context read stays inside that bridge budget.
- Keep the carried-switch restoration before daemon spawn; removing the switch permanently would change test environments under 001 D11.
- 008-20 still owns real-model interpretation of Squeal's user-message continuations/wakes, TUI behavior and open-session updates. This wave's scripted `run`/`serve` proof does not establish those.
- The previously accepted limitation of cancelled reports held only in plugin memory remains as recorded in `status.md`; this diff does not repair or reopen it. Do not cite the new serve-continuation test as proof of restart durability.
- Persist S1's cheap adversarial cases in a test-only follow-up. No fix wave is required by this review.

## Round 2

Verdict: **PASS 26d306c8**. **0 proven blockers**, no new should-fix notes or nits. Narrow range: `20647e10..26d306c8`; exact candidate `26d306c84c102a04f46cb144395e9b39bd1e355a`. Reviewed 2026-10-15 after the coordinator reported Node 24 branch CI run `38656267613` failing the proxy-setup control at `bridge-client.test.ts:174`.

The complete delta is one comment and `vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:3128")` in the existing proxy-startup test. It changes no product code, dependencies, version or bundle. This round checks that repair only; the original review's S1 remains a nonblocking follow-up.

### Verification

Fetched `origin cand/0.1.184`, detached at the exact new candidate, and verified the tree was clean. Both independent targeted runs use Node 24.21.0 and one worker. No independent full suite was started.

```text
$ git rev-parse HEAD
26d306c84c102a04f46cb144395e9b39bd1e355a
$ git status --short
(no output)

$ npx vitest run test/harness/opencode/bridge-client.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  10 passed (10)
  Duration  3.00s
exit 0

$ env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy -u NODE_USE_ENV_PROXY npx vitest run test/harness/opencode/bridge-client.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  10 passed (10)
  Duration  2.97s
exit 0

$ npm run lint
> squeal@0.1.184 lint
> biome check .
Checked 1221 files in 589ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.184 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.184 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.184 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)
```

The lockfile is unchanged, so the prior `npm ci` installation was reused. The completed build leaves no tracked drift. After the build completed, on the clean exact candidate:

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait 60000
Checkpoint 82d16818-4530-4de5-9537-1c688775ef2f completed at revision 6: no known failures; 586 test files, 586 already current, 0 run now
Checkpoint 82d16818-4530-4de5-9537-1c688775ef2f started at revision 6: 0 test files to run, 586 already current

Revision: 6
Known failures: 0
Affected checks: 5439 passed (4853 tests, 586 test files loaded), 0 running, 0 queued, 10 skipped (10 tests)
Full-suite checkpoint: completed at revision 6

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/68edb989-c07e-4f04-8400-5e8cec1128d0 (HEAD 26d306c, clean at revision 6)
Daemon: running, last heartbeat 0 s ago
Inherited from other worktrees: 48 current results (46 tests, 2 test files loaded)
  48 (46 tests, 2 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dda82ed-d43b-4fa4-9246-d474cf5f9d89 at 20647e1
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  2026-10-14T23:48:16.501Z, revision 0: no dependencies are installed in this worktree; Squeal lists and runs no tests until an install
exit 0
```

### Findings and judgment

- **Proven:** the repair makes the control independent of host proxy URLs. With all seven listed variables removed, a standalone Node 24.21.0 startup probe with only `NODE_USE_ENV_PROXY=1` reports `proxyAtStart: false`; supplying that same switch plus `HTTPS_PROXY=http://proxy.invalid:3128` reports `proxyAtStart: true`. The fixed test passes in both requested environments and retains its bridge `proxyAtStart: false`, restored-switch/child and plain-Node control assertions.
- **Proven:** `afterEach` already calls `vi.unstubAllEnvs()`, so the newly stubbed URL is restored after passing or failing tests. It is an inert URL for this test: neither the probe nor the bridge makes an HTTP request. No actual proxy or external network service is needed.
- **Proven:** the changed line is test setup for the proxy-startup precondition, not weakened production behavior or a removed assertion. D4's bridge semantics and 001 D11's descendant environment contract are unchanged.
- **Unverified here:** a green rerun of the remote GitHub Actions jobs. The local Node 24 checks above establish the named CI failure mode is repaired; the coordinator still owns reading branch CI before landing.

No repair row is required by this narrow re-review. Restore the worker branch only to commit this report; integrate no product change from this reviewer branch.
