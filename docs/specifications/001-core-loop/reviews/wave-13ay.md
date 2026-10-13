# Wave 13ay: review of the test-only 001-309 landing

Candidate: `373df1da1a1cefc391de99df833f7b195f5606bd`.
Range: `b36a5b5b..373df1da`. Implementation row: 001-309. Review task: 001-324.
Contracts: the row's eight named conditions and done-when; 001 D2, D10 and D12; the existing node:test enumeration contract (003 D6). Inputs: `tasks/001-309/notes.md`, `spec.md`, `status.md`, the diff and the immediate callers/callees.

## Verdict

**PASS**. 0 blocking findings, 1 plausible nonblocking should-fix note, 0 nits. Product code is unchanged. The first independent full gate was red under the load spike; the single user-requested repeat, started below load 24 without edits, passed.

## Verification output

All repository gates ran at the exact assigned candidate with a clean tracked tree. The findings file was written only after verification. The build reproduced both committed plugin distributions without drift. No product code or board was edited by this review. No model eval sessions were run.

```text
$ git rev-parse HEAD
373df1da1a1cefc391de99df833f7b195f5606bd
$ git status --porcelain
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)

$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.146 lint
> biome check .

Checked 976 files in 395ms. No fixes applied.
(exit 0)

$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.146 typecheck
> tsc --noEmit

(exit 0)

$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.146 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.146 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

(exit 0)

$ git status --porcelain
(no output after build)

$ git diff --quiet b36a5b5b..373df1da -- src plugins package.json package-lock.json vitest.config.ts
(exit 0: no product/build/config change)
```

Each npm/npx command also emitted the unknown `store-dir` environment-config warning. It did not change any exit status.

### First independent full gate

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354

 ❯ test/daemon/departure.test.ts (6 tests | 6 skipped) 13197ms
 ❯ test/harness/codex/command.test.ts (7 tests | 1 failed) 9265ms
   ❯ bundled Codex hooks name a CLI the agent's shell runs (2)
     × in the SessionStart primer and a FAIL report's last line, with no squeal on PATH 5017ms
 ❯ test/harness/ensure.test.ts (12 tests | 1 failed) 5529ms
   ❯ ensureDaemon (8)
     × is alive when the socket accepts a connection, and spawns nothing 883ms
 ❯ test/harness/stop-slow-untold.test.ts (40 tests | 1 failed) 12423ms
   ❯ the waiting Stop blocks on a slow failure not told, claude-code (20)
     × 13an S2: a pending file moved and failed at a newer key before its first read blocks 5046ms
 ❯ test/scheduler/backlog-tiers.test.ts (4 tests | 1 failed) 296115ms
   ❯ scheduler: backlog work runs in machine-wide tiers (D5, defect 25) (4)
     × caps a backlog tier at half of runner.timeoutMs of last known file time 26110ms
 ❯ test/cli/setup/plan.test.ts (10 tests | 1 failed) 11263ms
   ❯ squeal setup --plan --json (5)
     × calls a missing config, an untracked one and one only in the main checkout outdated 6039ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354/test/fixtures/scheduler/.tmp/989c10af-c22e-4e93-a8a4-89a0a7d03e00/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354/test/fixtures/scheduler/.tmp/eec87753-2261-4eb4-93be-889bef988a44/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 2732589
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/departure.test.ts [ test/daemon/departure.test.ts ]
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ daemonSuite test/daemon/helpers.ts:335:3
    333|   const roots: string[] = [];
    334|   const cleanups: (() => void)[] = [];
    335|   beforeAll(() => {
       |   ^
    336|     built = buildCli(options);
    337|   });
 ❯ test/daemon/departure.test.ts:33:15

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/ensure.test.ts > ensureDaemon > is alive when the socket accepts a connection, and spawns nothing
AssertionError: expected 'unavailable' to be 'alive' // Object.is equality

Expected: "alive"
Received: "unavailable"

 ❯ test/harness/ensure.test.ts:84:69
     82|     await listen(socketPathFor(worktreeIdFor(repo.main)));
     83|
     84|     expect(await ensureDaemon(repo.main, { socketTimeoutMs: 100 })).to…
       |                                                                     ^
     85|     await sleep(200);
     86|     expect(existsSync(argsFile)).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  test/harness/stop-slow-untold.test.ts > the waiting Stop blocks on a slow failure not told, claude-code > 13an S2: a pending file moved and failed at a newer key before its first read blocks
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/stop-slow-untold.test.ts:82:5
     80|     });
     81|
     82|     it(`13an S2: a pending file moved and failed at a newer key ${when…
       |     ^
     83|       const r = await repo(harness, { requireSlowSuite: true, slowWait…
     84|       const out = await run(r, () => moveAndLand(r, "fail"));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  test/scheduler/backlog-tiers.test.ts > scheduler: backlog work runs in machine-wide tiers (D5, defect 25) > caps a backlog tier at half of runner.timeoutMs of last known file time
AssertionError: expected 10 to be 9 // Object.is equality

- Expected
+ Received

- 9
+ 10

 ❯ test/scheduler/backlog-tiers.test.ts:213:46
    211|     await h.scheduler.idle();
    212|     const sizes = h.runner.runs.map((r) => r.files.length);
    213|     expect(sizes.reduce((a, b) => a + b, 0)).toBe(9);
       |                                              ^
    214|     expect(sizes.length).toBeGreaterThanOrEqual(3);
    215|     expect(Math.max(...sizes)).toBeLessThanOrEqual(3);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  test/cli/setup/plan.test.ts > squeal setup --plan --json > calls a missing config, an untracked one and one only in the main checkout outdated
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/cli/setup/plan.test.ts:84:3
     82|   });
     83|
     84|   it("calls a missing config, an untracked one and one only in the mai…
       |   ^
     85|     const root = squealShaped();
     86|     git(root, ["rm", "-q", "--cached", "squeal.config.json"]);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  test/harness/codex/command.test.ts > bundled Codex hooks name a CLI the agent's shell runs > in the SessionStart primer and a FAIL report's last line, with no squeal on PATH
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/codex/command.test.ts:133:3
    131|
    132| describe("bundled Codex hooks name a CLI the agent's shell runs", () =…
    133|   it("in the SessionStart primer and a FAIL report's last line, with n…
       |   ^
    134|     const root = pluginRoot();
    135|     const PATH = pathWithoutSqueal();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯


 Test Files  6 failed | 452 passed | 1 skipped (459)
      Tests  5 failed | 3853 passed | 16 skipped (3874)
   Start at  17:17:21
   Duration  1109.90s (tests 96%, import 3%, transform 1%)

    Isolate  459 workers spawned · ~375ms startup each (spawn + environment, per file)
             at least ~42.67s faster with isolate: false — reuses workers across files instead of one per file

(exit 1)
```

The first red result is retained in full. Its six failed files are outside the candidate's changed test files: departure's existing daemon-build `beforeAll` exceeded 10 s; the Codex command, Stop-untold and setup-plan cases exceeded 5 s; the ensure test's 100 ms socket probe returned unavailable; the backlog-cap case counted ten file-runs instead of nine. The backlog test imports the changed scheduler helper, but its failing assertion runs before teardown; only that helper's afterEach timeout changed. No altered assertion or new predicate failed. All eight named row items passed in this run.

Sampled one-minute load rose from 31 to 310.76 during the first run. The user identified another coordinator's uncapped Vitest reviewer as the source and stopped it, then requested exactly one further full gate after one-minute load fell below 24. The red gate is **verified**; host contention as the cause of each failure remains **plausible**, not proven just by that attribution. None is a finding against this test-only range. Both independent runs are retained rather than replacing the first result with the second.

### Second independent full gate

Recorded start condition: `2026-10-13T15:37:06.827Z`, one-minute load `20.92`, strictly below 24. HEAD and clean tree were checked again before waiting for the threshold.

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354/test/fixtures/scheduler/.tmp/458cb96d-6a80-4588-a8fa-49de7625cda4/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ea038455-6286-4004-8247-ca74a6e89354/test/fixtures/scheduler/.tmp/6438499c-36b1-4541-9221-acab4bcd3c3d/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 3216952
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  458 passed | 1 skipped (459)
      Tests  3864 passed | 10 skipped (3874)
   Start at  17:37:07
   Duration  544.99s (tests 98%, import 2%, transform 1%)

    Isolate  459 workers spawned · ~133ms startup each (spawn + environment, per file)
             at least ~15.16s faster with isolate: false — reuses workers across files instead of one per file

(exit 0)

$ git rev-parse HEAD
373df1da1a1cefc391de99df833f7b195f5606bd
$ git status --porcelain
(no output after both gates)
```

No files were changed between the two runs. All eight named row items passed again. The second run's sampled one-minute load ranged from 17.30 to 25.13 after its below-24 start. The second gate validates the candidate; it does not erase the first gate's six failed files. Fixture `repair: gitdir incorrect` and experimental type-testing diagnostics, and cleanup of an earlier nested run's process, are preserved above; they did not fail the second gate or produce an unhandled-error result.

Squeal separately reported eight baseline failures at revision 0 during the load spike (including 5 s timeouts at recorded loads 217 to 283), then eight recoveries at the same revision with no edits. Those background messages are supplementary evidence, not either independent full gate and not a Squeal full-suite checkpoint.

### Read-only helper probe

The candidate's actual `isAlive` function was stripped with Node's `stripTypeScriptTypes` and evaluated with its normal process object. Only its stat-read dependency was replaced for fault injection. The pid was this probe's real live process; `kill(pid, 0)` succeeded. No source was edited and no probe file was added to the repository.

```text
real Linux pid: alive=true
real live pid, injected stat ENOENT: alive=false
real live pid, injected stat EACCES: alive=false
real live pid, injected stat EIO: alive=false
(exit 0)
```

## Blockers

None.

## Should-fix notes

### S1. Plausible, nonblocking: only disappearance proves the process is gone

Location: `test/daemon/strays.ts:130` to `:133`; consumers include the five new `gone` polls in `test/daemon/escaped-overlap.test.ts:86` and the test-run sweep in `test/global-teardown.ts:78`.

The new Linux catch correctly fixes the race where `kill(pid, 0)` succeeds but `/proc/<pid>/stat` disappears before the read. It also returns false for every other read error. If a live process's stat read fails with `EACCES` or `EIO`, the new polls can report that it exited, and cleanup can skip killing it. This is a possible false pass introduced by the change; no such read error was reported by either independent gate. A throwaway read-only probe evaluated the candidate's actual function with a real live pid and injected stat errors: normal read returned true; `ENOENT`, `EACCES` and `EIO` all returned false. That establishes the branch behavior, not that a supported test host encounters the latter errors. The failure scenario is therefore **plausible**, not a blocker.

One test-harness worker can narrow the gone case to a missing process (`ENOENT`/`ESRCH`), preserving the old conservative true fallback for other errors and for platforms without `/proc`. Add a helper-level check that a missing stat after a successful signal probe is gone, a zombie is gone, and a permission or I/O error is not evidence of exit. No product file needs to change.

## Nits

None.

## What fits

The range contains nine files under `test/`, the task notes and the coordinator's board update. `src/`, both committed plugin distributions, manifests, lockfile and Vitest configuration are byte-identical across the range. There is no product interface, transaction, status formatter, key or delivery change. The vision's current-state honesty rules therefore have no new product path to prosecute; the changed hung-daemon tests retain the existing honesty assertions.

The eight row items were checked at their waits and immediate callees:

| Item | What completes the work | Assertion preserved / changed |
| --- | --- | --- |
| 1. SIGKILL replacement, `test/daemon/lifecycle.test.ts:47` | A successful socket ping, bounded at 30 s, for both cold start and replacement. The original daemon also reaches ready and its exit is awaited before replacement. | Stale socket exists and refuses connections; serving pid equals the newly spawned replacement. The former load-gated 1 s bound becomes an always-enforced `< 3 * cold` comparison; the 200 ms target remains printed. |
| 2. Overlapping escaped processes, `test/daemon/escaped-overlap.test.ts:86` | `expect.poll(isAlive)` becomes false, bounded at 10 s. `terminate` sends SIGKILL after its 1 s grace and returns without waiting for kernel exit. | All five dead-process expectations remain false, now eventual. The fixtures sleep for 600 s if no signal reaches them, so the 10 s poll cannot rescue a missed stop. Other-lane live-process expectations and exact run-attribution notes remain intact. S1 qualifies unexpected stat-read errors only. |
| 3. Install after watch start, `test/watcher/linked-exclusions.test.ts:139` | First an install-path batch; then the actual inotify-watch count fits the unchanged exclusion bound; then a source edit yields a batch with trigger `watch`. | The same three predicates remain, each with a 30 s bound; the describe permits 120 s for fixture writes and reconciliation. The reconciliation interval is 60 s and `watched` explicitly requires `watch`, so a periodic reconciliation cannot satisfy the final source-watch assertion. Siblings retain their exclusion-count and resumed-watch assertions. |
| 4. Scratch Codex homes, `test/cli/codex.test.ts:105` | Two synchronous CLI subprocesses return. | Only the test timeout becomes 60 s. Empty stderr, exit 0, byte-for-byte home snapshot and repository config existence remain required. There is no sleep or delayed success predicate. |
| 5. Every Codex bundle parses, `test/harness/codex/plugin.test.ts:90` | All seventeen synchronous `node --check` subprocesses return successfully. | Only the test timeout becomes 60 s. The exact five verbatim runtime files, twelve bundles, CommonJS require preamble and syntax checks remain required. A syntax failure still throws. |
| 6. Own-write integration cleanup, `test/scheduler/helpers.ts:59` | The same cleanup promises settle in reverse order: scheduler close waits for its pumping run; runner close waits for Vitest; store and fixture cleanup follow. | The shared afterEach now has the existing scheduler `SLOW.timeout` of 120 s rather than the 10 s hook default. The integration test body and its empty stored-results / exact unknown-reason assertions are byte-identical. Cleanup still awaits every operation and propagates errors. |
| 7. Hung daemon, `test/harness/hung-daemon.test.ts:73` | On Linux, the daemon's actual `/proc/<pid>/stat` state is `T` after SIGSTOP, bounded at 10 s. | Replaces the unawaited signal and the second test's 50 ms sleep. Past-grace down state, `unresponsive` probe, unavailable ensure, every-edit no-result warning, read silence and post-SIGCONT recovery remain. `toMatchObject({state: "unresponsive"})` is equivalent to the former equality on `probe.state`, with a better failure diagnostic. SIGCONT remains in finally. |
| 8. Enumeration cost, `test/runners/node-test/enumerate.test.ts:351` | All 200 files enumerate in each of nine rounds, immediately followed by a new graph's cold build and lazy reverse-index construction. | Each round still checks nonempty enumeration of every file. The fixture still has exactly 200 files. Each graph is a new `Graph` with a new `ModuleTable` and resolver; the denominator never switches to a reused or incremental graph. The numerical bound stays `< 0.5`, now on the fifth sorted paired ratio instead of separate minima. |

The two timing comparisons are deliberately relative performance checks. The cold and replacement measurements both start before spawn and end on their first successful ping. Neither includes the baseline ready wait in its timed region. The replacement's ping must identify its own child. The assertion is no longer skipped above load average 8. A stuck restart still times out; a replacement that consistently takes at least three times the paired cold start still fails. An inflated cold-start sample can hide a smaller restart delay, so this is not an absolute latency guarantee. The row explicitly says “A D10 target stays a measured figure, not a test bound”; retaining the target log satisfies that scope.

For enumeration, sorting nine nonempty ratios and selecting index four is the median. Five or more ratios at or above 0.5 fail; up to four preempted outliers do not decide the verdict. Every measured enumeration still does the actual file reads and source parse. Warming `stripTypeScriptTypes` is unchanged. A stable enumeration regression crossing half the corresponding cold-build cost still fails. This does not assert worst-case wall time, and the previous best-of-three check did not do so either.

The Linux process helper retains the zombie regex and signal probe. The intended reaped-process race is corrected; a live readable stat still returns true, and other platforms retain the previous true fallback when the stat read fails. S1 is the only uncovered error distinction.

The candidate's task notes explain all eight causes and changed conditions. The board reports twenty consecutive loaded passes for each item, but the committed notes do not retain the repetition command, per-item counts or raw stress output. This review did not independently replay that twenty-run campaign. Treat that historical stress claim as **unverified reviewer evidence**, not a proven failure or a blocking finding. The two independent gates recorded above are separate evidence at the assigned candidate.

## Inputs for the next wave

- No product repair or interface migration is indicated by this review. If S1 is accepted, dispatch one test-harness row for `test/daemon/strays.ts` and its focused helper tests; keep the five eventual-exit polls and every attribution/live-lane assertion.
- Preserve the event order: cold ping, ready, SIGKILL, awaited exit, refused stale socket, replacement ping with matching pid. Keep the 200 ms figure reported and the relative comparison enforced under load.
- Keep process-exit polls bounded at 10 s and distinguish a kernel-confirmed exit from an unreadable stat. Hung-daemon tests must await stopped state before probing, use the injected future clock for grace and always resume in finally.
- Keep watcher waits on install observation, exclusion watch count and actual source-watch delivery, in that order. CLI and syntax tests must still wait for subprocess completion and assert the unchanged outputs. Shared scheduler teardown must await close operations before closing stores and removing fixtures.
- Keep enumeration and cold-build samples adjacent, all nine rounds performing real work, the 200-file and nonempty-check assertions, and the `< 0.5` median bound.
- 001-320 already owns further load-sensitive test timeouts. This review does not broaden 001-309 into a global test timeout or a product change. Retain the commands and per-item results when documenting another stress campaign.
