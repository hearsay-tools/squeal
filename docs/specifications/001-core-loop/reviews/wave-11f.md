# Wave 11f review: 001-111 and 001-112

## Verification

Candidate: `015e38cd5866adade62f7f12a899aba0c8491bd2` (0.1.23). Scope: the landed equivalents `c7398c1`, `e6d49d0`, `96c53a9`, `a6057ab`, `b882699`, `e39970d`, `7e3b4e6`, and their build in `015e38c`. These carry the seven worker commits named in the brief; the unrelated 001-109 implementation in the build is outside this review.

Initial `HEAD` was `e91d1b3470bd8b94a4604384441f24f4039d1e7a`. It differs from the requested candidate only in `docs/board.md` and `tasks/wave-11.md`. N1 records that mismatch. All verification and probes below ran after switching to detached `015e38c`, with empty `git status --short` before and after build and probes. The task branch was restored before writing this review. Throwaway probes lived under ignored `node_modules/.cache/wave11f` and were removed.

Commands and output:

```text
$ git rev-parse HEAD
015e38cd5866adade62f7f12a899aba0c8491bd2
$ npm ci
added 56 packages, and audited 57 packages in 13s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
> squeal@0.1.23 lint
> biome check .
Checked 491 files in 470ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.23 typecheck
> tsc --noEmit
$ npm run build
> squeal@0.1.23 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.23 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
$ git status --short
(no output)
```

Install, lint, typecheck and build exited 0. The committed bundles did not drift. The two shipped CLI bundles are byte-identical (`cmp` exited 0); both were independently exercised below.

The full suite ran once and exited 1. Its output follows. The host's load average reached 113.45; this is context, not proof that every failure is caused by load. Six failures are timeouts or elapsed-time assertions. The node:test fixture's child exit 1 was not diagnosed by this review and is **unverified as a wave regression**: its code is outside the range. None of these results is silently counted as a pass.

```text
$ npx vitest run
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ce96ba92-de71-4c4d-8997-a9ed2411ef6f

 ❯ test/cli/codex.test.ts (13 tests | 1 failed) 22368ms
   ❯ squeal init --harness codex (6)
     × touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI 12127ms
 ❯ test/runners/node-test/fixtures.test.ts (10 tests | 1 failed) 47901ms
   ❯ node:test fixtures under the current Node (10)
     ❯ gen-big.mjs (2)
       × writes 1,000 modules and 200 test files, deterministically, under 2 s 36396ms
 ❯ test/harness/liveness.test.ts (14 tests | 1 failed) 28747ms
   ❯ SessionStart after spawning a daemon (2)
     × registers after 750 ms and says so when no heartbeat arrives 2785ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ce96ba92-de71-4c4d-8997-a9ed2411ef6f/test/fixtures/scheduler/.tmp/09c87452-fe4e-48f3-ae00-29bcd52ca632/main/.git/worktrees/staged/gitdir
 ❯ test/harness/turn.test.ts (11 tests | 1 failed) 39312ms
   ❯ the idle waiter and the turn state (task 001-85) (11)
     × idle: once a pending file's result lands quiet, a re-run under the same key never wakes (review wave 10, P1) 6541ms
 ❯ test/harness/bundles.test.ts (32 tests | 1 failed) 58123ms
   ❯ bundled hooks, recorded JSON in and JSON out (1)
     × serve every event end to end 5323ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ce96ba92-de71-4c4d-8997-a9ed2411ef6f/test/fixtures/scheduler/.tmp/f26f7c9b-480a-49b0-a1f3-7debaf91e599/main/.git/worktrees/staged/gitdir
 ❯ test/harness/codex/bundles.test.ts (28 tests | 1 failed) 31761ms
   ❯ bundled Codex hooks, recorded JSON in and JSON out (1)
     × serve a codex exec session end to end 5131ms
 ❯ test/harness/latency.test.ts (1 test | 1 failed) 180078ms
   ❯ bundled hook latency (1)
     × stays under 80 ms p95 over 20 cold runs per hook 180076ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/cli/codex.test.ts > squeal init --harness codex > touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/cli/codex.test.ts:102:3
    100|   });
    101|
    102|   it("touches nothing under a scratch HOME/.codex or CODEX_HOME, run a…
       |   ^
    103|     const repo = fakeRepo();
    104|     const home = runtimeDir();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/7]⎯

 FAIL  test/harness/bundles.test.ts > bundled hooks, recorded JSON in and JSON out > serve every event end to end
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/bundles.test.ts:44:3
     42|
     43| describe("bundled hooks, recorded JSON in and JSON out", () => {
     44|   it("serve every event end to end", async () => {
       |   ^
     45|     const r = squealRepo();
     46|     r.apply(r.pass(), r.fail(SUBTRACTS));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/7]⎯

 FAIL  test/harness/latency.test.ts > bundled hook latency > stays under 80 ms p95 over 20 cold runs per hook
Error: Test timed out in 180000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/latency.test.ts:144:3
    142|
    143| describe("bundled hook latency", () => {
    144|   it(`stays under ${BUDGET_MS} ms p95 over ${RUNS} cold runs per hook`…
       |   ^
    145|     const r = seeded();
    146|     const dir = runtimeDir();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/7]⎯

 FAIL  test/harness/liveness.test.ts > SessionStart after spawning a daemon > registers after 750 ms and says so when no heartbeat arrives
AssertionError: expected 1266.017602 to be less than 1250
 ❯ test/harness/liveness.test.ts:226:21
    224|
    225|     expect(elapsed).toBeGreaterThanOrEqual(SPAWN_SETTLE_MS - 10);
    226|     expect(elapsed).toBeLessThan(SPAWN_SETTLE_MS + 500);
       |                     ^
    227|     expect(context(out)).toContain("No daemon is running; results are …
    228|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/7]⎯

 FAIL  test/harness/turn.test.ts > the idle waiter and the turn state (task 001-85) > idle: once a pending file's result lands quiet, a re-run under the same key never wakes (review wave 10, P1)
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/turn.test.ts:188:5
    186|     ["an edit made from outside", (r: SquealRepo) => r.queue("k3")],
    187|     ["a re-run under the same key", () => {}],
    188|   ])(
       |     ^
    189|     "idle: once a pending file's result lands quiet, %s never wakes (r…
    190|     async (_, edit) => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/7]⎯

 FAIL  test/harness/codex/bundles.test.ts > bundled Codex hooks, recorded JSON in and JSON out > serve a codex exec session end to end
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/codex/bundles.test.ts:86:3
     84|
     85| describe("bundled Codex hooks, recorded JSON in and JSON out", () => {
     86|   it("serve a codex exec session end to end", async () => {
       |   ^
     87|     const r = squealRepo();
     88|     r.apply(r.pass(), r.pass(SUBTRACTS));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/7]⎯

 FAIL  test/runners/node-test/fixtures.test.ts > node:test fixtures under the current Node > gen-big.mjs > writes 1,000 modules and 200 test files, deterministically, under 2 s
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ test/runners/node-test/fixtures.test.ts:265:24
    263|         ["test/unit/t000.test.ts", "test/unit/t199.test.ts"],
    264|       );
    265|       expect(run.code).toBe(0);
       |                        ^
    266|       expect(named(run, "test:fail")).toEqual([]);
    267|       expect(named(run, "test:pass").length).toBeGreaterThan(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/7]⎯


 Test Files  7 failed | 169 passed (176)
      Tests  7 failed | 1480 passed | 8 skipped (1495)
   Start at  00:35:00
   Duration  245.30s (tests 94%, transform 5%, import 1%)
```

The changed-area follow-up was justified by the failed liveness timing assertion and the loaded run. It exited 0:

```text
$ npx vitest run test/harness/liveness.test.ts test/harness/hung-daemon.test.ts test/daemon/symlinked-install.test.ts test/watcher/watch-spec.test.ts --maxWorkers=1
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ce96ba92-de71-4c4d-8997-a9ed2411ef6f


 Test Files  4 passed (4)
      Tests  27 passed (27)
   Start at  00:39:52
   Duration  12.34s (tests 92%, transform 6%, import 2%)
```

Six discriminating throwaway probes exited 0 on their focused retry. The first run had 5 passes and one 30-second Codex source-delivery timeout; the retry allowed the reconciliation interval and records the actual delay below. This establishes delayed discovery of an existing input, not an immediate watcher delivery. Three intermediate new-file probe runs were stopped after correcting reviewer-harness assumptions: `run --all` does not discover new files, its response does not track checkpoint completion, and check identities use `testPath`. They are not candidate findings. The final new-file proof reads completion from the store.

```text
$ npx vitest run --config <ignored probe config> <six-case probe>
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    102.36s
SPLIT: six positions, two refusals each, all 7 paths classified
claude-code LINKED SOURCE: hash changed; PASS -> FAIL delivered after 29812ms
codex LINKED SOURCE: hash changed; PASS -> FAIL delivered after 30017ms
claude-code GRACE: ""
codex GRACE: ""
claude-code DOWN: repeated=true; Read=""; Bash(no filesystem change)="SQUEAL · Not validated: no daemon has validated since 2026-10-07T22:40:45.451Z; this edit has no result."
codex DOWN: repeated=true; Read="SQUEAL · Not validated: no daemon has validated since 2026-10-07T22:40:45.451Z; this edit has no result."; Bash(no filesystem change)="SQUEAL · Not validated: no daemon has validated since 2026-10-07T22:40:45.451Z; this edit has no result."
claude-code SIGCONT: PASS -> FAIL delivered; no Not validated
codex SIGCONT: PASS -> FAIL delivered; no Not validated
SLOW TIER: heartbeat age=414ms; no Not validated in either plugin
UNKNOWN NAMED EDITOR: empty output despite down daemon
```

The final two-plugin new-file proof exited 0; its assertions prove the negative case and the config-refresh positive control.

```text
$ npx vitest run --config <ignored probe config> <two-plugin new-file probe>
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ce96ba92-de71-4c4d-8997-a9ed2411ef6f


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  00:46:08
   Duration  81.26s (tests 98%, transform 1%)
claude-code new test hint candidates=[]
claude-code after 35s: {"files":5,"counts":{"current":11,"pending":0,"stale":0,"unknown":0}}
claude-code run-all response={"schemaVersion":1,"ok":true,"type":"run-all","requestId":"f4bb3b08-6e32-4abc-a328-04ef28c3021c","checkpoint":null,"error":null}
claude-code completed forced checkpoint: {"end":"completed","revision":0,"files":["test/gen.test.ts","test/math.test.ts","test/plain.test.ts","test/strings.test.ts","test/upper.test.ts"]}
claude-code config refresh begins
claude-code after checkpoint: {"files":6,"counts":{"current":13,"pending":0,"stale":0,"unknown":0},"failures":[{"path":"src/added.test.ts","summary":"expected 1 to be 2 // Object.is equality"}],"fullSuite":{"atCurrentRevision":false,"lastCompletedRevision":0}}
codex new test hint candidates=[]
codex after 35s: {"files":5,"counts":{"current":11,"pending":0,"stale":0,"unknown":0}}
codex run-all response={"schemaVersion":1,"ok":true,"type":"run-all","requestId":"598e69aa-1c96-44f7-988a-6fa400887c35","checkpoint":null,"error":null}
codex completed forced checkpoint: {"end":"completed","revision":0,"files":["test/gen.test.ts","test/math.test.ts","test/plain.test.ts","test/strings.test.ts","test/upper.test.ts"]}
codex config refresh begins
codex after checkpoint: {"files":6,"counts":{"current":13,"pending":0,"stale":0,"unknown":0},"failures":[{"path":"src/added.test.ts","summary":"expected 1 to be 2 // Object.is equality"}],"fullSuite":{"atCurrentRevision":false,"lastCompletedRevision":0}}
```

## Verdict

**FAIL 015e38cd5866adade62f7f12a899aba0c8491bd2**.

1 blocking finding, 2 should-fix notes, 1 nit. B1, S1 and N1 are **proven**; S2 is **plausible**. Verification limitations above are not findings against the wave.

## Blockers

### B1. Proven: a newly added test under a source-directory symlink is never discovered, even by a forced full-suite checkpoint

Changed boundary: `src/core/watcher/git.ts:26` (every descendant is classified as ignored). Call seam: `src/core/watcher/candidates.ts:75` (an ignored hinted file is discarded unless already an extra file). Existing implementation facts needed to understand the failure: `src/core/watcher/chokidar-backend.ts:40` does not follow symlink directories, and reconciliation combines git's paths with the stat cache and known extras. Git lists the link, not the files behind it. These pre-existing modules are cited to establish the changed boundary's consequence, not reviewed independently.

Spec goal 3: "Everything the agent is told is true at the moment it is told". Goal 5 requires status for the current worktree and revision, including pending and unknown work and full-suite coverage. D2 promises ignored closure files are "watched individually, so a change to them creates a revision like any other input". The 001-111 brief explicitly includes "`node_modules` (or any directory under the root) is a symlink".

Reproduction, separately with each shipped plugin's CLI:

1. Copy `test/fixtures/scheduler/basic` into a fresh git repository. Move `src` to a sibling `linked-source`, and create `src -> ../linked-source`. Keep ordinary `node_modules` resolution. Configure Vite `resolve.preserveSymlinks: true` and Vitest includes `test/**/*.test.ts` and `src/**/*.test.ts`. This keeps the source paths inside the runner's worktree-relative closure, so this is not a runner resolving an input outside the worktree.
2. Start the daemon and settle its five-file baseline. Its known `src/math.ts` input is hashed. Adding such an already known input to extras does not cover unknown paths below `src`.
3. Create `src/added.test.ts` containing `it("new failure", () => expect(1).toBe(2))`. Even an explicit `candidatesFromHints` call with that exact absolute path returns `paths: []`. It is not in any closure or extra-file set yet.
4. Wait 35 seconds, beyond idle reconciliation. Both daemons still list five files, with eleven current checks and zero pending, stale or unknown checks. The added file has no hash-cache row. No revision describes the addition.
5. Request `run --all --force` and read the completed checkpoint from the store. It completes with only the old five files at the unchanged revision. A current-revision full-suite checkpoint therefore omits an on-disk failing test.
6. Append a newline to the ordinary `vitest.config.ts`. The resulting runner refresh discovers the sixth file and reports its assertion failure. This is the positive control: the file is a valid included test, not an unsupported extension, ignore pattern or broken fixture.

Existing linked source inputs are not permanently lost: both plugin probes eventually rehashed `src/math.ts` and delivered `PASS -> FAIL`, after 29.8 and 30.0 seconds. That is the stat-cache reconciliation escape hatch. A new file has no such escape hatch. Passing the existing linked-install test does not rule this failure out.

Fix sized for one worker: repair source-symlink observation and candidate classification together in `src/core/watcher/`, with daemon regressions. Distinguish ignored installation descendants from non-ignored project directories. Retain new project-file hints beyond a link and observe/enumerate those directories so previously unknown test paths can enter revisions and runner refinement. Preserve the linked-install lockfile extra, nested-repository opacity, loop avoidance and split-batch refusal handling. Test an existing linked source edit, a new colocated failing test, deletion of that test, and a forced checkpoint after its addition through both shipped CLIs. A fix limited to adding already known closure files to extras is insufficient.

## Should-fix

### S1. Proven, nonblocking: a no-op Bash call is described as an edit with no result

`src/core/delivery/format.ts:147`, invoked by `src/harness/shared/deliver.ts:52` and the `Bash` entry at `src/harness/shared/deliver.ts:16`.

With a real daemon SIGSTOPped and its heartbeat past grace, execute `bash -c true`, then supply its Bash tool boundary. Both shipped plugins emit "this edit has no result" without any filesystem change. Codex emits it for `Read` too because its existing handler supplies the shared default `edited = true`; the amendment log explicitly defers its tool filter to 002-21.

D9 deliberately says tools that *may* have changed files, so the conservative emission itself is in conformance and does not block this wave. The wording states more than that trigger establishes and should preserve uncertainty. Fix sized for one worker: keep the conservative trigger and change the sentence to qualify changes, for example "Any changes from this tool call have no validation result while the daemon is unavailable." Carry that wording into D9 and the tests. Complete the already planned Codex filter in its owning row; Bash still needs conditional wording after that filter.

### S2. Plausible, nonblocking: a named custom editing tool gets the read-only classification

`src/harness/shared/deliver.ts:24` and `src/harness/claude-code/hooks/post-tool-batch.ts:16`.

The predicate returns false for every named tool outside its six-name set. A registered consumer with an unavailable daemon, already told it is down, receives empty output for a recorded PostToolBatch naming `mcp__filesystem__write_file`. That predicate and hook output were probed. An actual installed custom tool's write and its Claude Code payload were not exercised, so the integration scenario remains plausible.

D9 says an "edit tool, a shell, or calls the harness does not name" may trigger the warning. The implementation handles absent names conservatively but treats unknown named tools as safe. A custom write tool could therefore edit without the per-boundary warning. Fix sized for one worker: make the classification conservative for unrecognized names, using an explicit known-read-only set or a harness-provided mutation classification; add a fixture that changes a file through a named custom editor and checks the repeated down-daemon warning. Do not apply the currently deferred Codex filter with the same false-negative policy.

## Nits

### N1. Proven: the dispatched checkout did not initially match the candidate

Initial `HEAD` was `e91d1b3`, not `015e38c`. The difference is a documentation-only board/task update (`docs/board.md:211`, `docs/specifications/001-core-loop/tasks/wave-11.md:153`). No product bytes differ. The reviewer explicitly checked out the requested candidate for verification and restored the task branch for the findings commit. Nonblocking; the next dispatch should pin the candidate or state that a documentation-only descendant is intentional. No board or status repair was made.

## What fits

- D2's split recursion retains all classifications. Six placements of a refused path, with a second refused path in each batch, classified all seven paths correctly. It does not silently keep only the last partial stdout. The existing test still rejects a broken repository rather than converting every failure to ignored.
- D3's linked-install path survives startup, hashes the installed lockfile and rehashes it through the link. The committed daemon regression passes. Known linked source closure inputs are also hashed and eventually validated; B1 identifies the missing discovery/observation path, not a missing known-input hash.
- D9/D10: within the two-heartbeat grace interval, both SIGSTOPped-daemon boundaries can be silent. This is the specified grace window, not a regression. Beyond grace, both shipped hooks repeat the warning at each edit; the unavailable socket does not cause a replacement daemon to be spawned.
- After SIGCONT, both consumers receive the source edit's `PASS -> FAIL`, with no extra "Not validated" warning. The Claude Code read-only boundary is silent while down after its first liveness change. Codex's read warning is the documented temporary lack of its tool filter.
- A real 12-second asynchronous tier continues to heartbeat. After 10.5 seconds of that tier the measured heartbeat age was 414 ms, and neither shipped hook says "Not validated". Slow validation alone does not trigger the new warning.
- Dead-daemon respawn behavior and repeated-warning suppression after `spawned` remain covered by the passing liveness cases. The new `EnsureDaemonResult | "fresh"` return is additive; existing callers that ignore it remain valid. Claude Code calls the shared `deliver` argument in the implemented order and preserves unnamed-tool fallback.
- Section-by-section scope check: D1/D8's repository and transaction contracts are unchanged; D2/D3 are the affected watcher/closure seam and B1; D4/D5 are followed only through file discovery and checkpoint coverage for B1; D6/D7 remain honest for the exercised liveness/slow-tier cases but miss B1's new file; D9/D10 pass the requested stopped/dead/recovery cases with S1/S2 as notes; D11/D12's policy and refusal behavior are unchanged. No unrelated architecture or earlier review/lessons file was re-prosecuted.
- No runtime dependency, schema change, or product-code rewrite was introduced by this review. Bundle generation is clean. Existing tests cover the specific linked install and post-grace SIGSTOP outcomes but do not cover a new test in a linked source tree.

## Inputs for the next wave

Dispatch one repair row for B1. Own watcher code and watcher/daemon tests; coordinate any runner-discovery seam change rather than changing another worker's adapter unnoticed. The required sequence is: observe an in-scope added path, keep it as a candidate, reconcile and append the revision without waiting on a tier, then let the existing runner refinement enumerate and key the new test. Keep the 100 ms quiet/500 ms maximum debounce, hook 2 s limit, socket 100 ms timeout and two-interval heartbeat grace. Do not solve discovery by a full-suite run at every tool boundary.

The done-when must show six files after adding the new colocated test under the source link, its failure delivered by both plugins, and a subsequent full-suite checkpoint including it. Also require direct existing-source edit observation rather than relying solely on 30-second stat-cache reconciliation. Keep the current symlinked-install and split-batch tests green. The coordinator chooses whether to fold S1 and S2 into that wave or their own delivery row; the already planned 002-21 remains the owner of Codex's tool filter. The full suite is not green in this review; retain the recorded seven failures until their causes are checked at suitable load, without treating their unproven causality as blockers for 001-111/112.
