# Wave 13bb: review of 001-320

**FAIL ee834518e84d18f9334722a305167f7ae39fb646**

Range: `3844efe7..ee834518`, pinned to the requested candidate. Reviewer row: 001-329. One **proven blocker**, no should-fix findings, two **proven nits**. The blocker is incomplete test stabilization against the row's done-when, not a demonstrated product regression.

## Verification

All checks ran at the candidate above on a clean tracked tree. `git rev-parse HEAD` matched exactly. `npm ci` used the lockfile. The build left no tracked drift, including both plugins' bundles; the tree was still clean after the full run. No candidate code was edited. One independent full proof, no rerun to green, no Squeal checkpoint substituted for it.

Every executable check used this environment prefix:

```sh
env -u CODEX_SESSION_ID \
  HOME="$review_scratch/home" \
  CODEX_HOME="$review_scratch/home/.codex" \
  CLAUDE_CONFIG_DIR="$review_scratch/home/.claude" \
  XDG_CONFIG_HOME="$review_scratch/home/.config" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
```

`review_scratch` was a fresh directory outside this checkout under the review task's temp directory. The checks and their children received that scratch HOME. No eval runner was invoked. Host load samples during the full run ranged from about 26 to 89. The full run kept the requested four-worker cap. Output excerpts below omit routine npm notices and repeated experimental warnings.

```text
$ git rev-parse HEAD
ee834518e84d18f9334722a305167f7ae39fb646
$ git status --porcelain
[no output]

$ npm ci
added 56 packages, and audited 57 packages in 3s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
[exit 0]

$ npm run lint
> squeal@0.1.148 lint
> biome check .
Checked 977 files in 432ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.148 typecheck
> tsc --noEmit
[exit 0]

$ npm run build
> squeal@0.1.148 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.148 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
$ git status --porcelain
[no output]

$ npx vitest run --maxWorkers=4
RUN  v5.0.3

stdout | test/e2e/lifecycle.test.ts > a dead daemon, claude-code > is replaced by the next SessionStart
001-320: hook 4428 ms; PreToolUse median 155 ms

FAIL  test/e2e/lifecycle.test.ts > a dead daemon, claude-code > is replaced by the next SessionStart
AssertionError: expected 4428.4208 to be less than 2000
 ❯ test/e2e/lifecycle.test.ts:70:22
     68| const start = await e.hook("session-start", e.main, { session_id: …
     69| expect(start).toMatchObject({ code: 0, stderr: "" });
     70| expect(start.ms).toBeLessThan(await budget(e, start.ms));

FAIL  test/e2e/lifecycle.test.ts > a bad squeal.config.json, claude-code > yields one note and a running daemon
Error: timed out after 45000 ms waiting for a ready daemon in /tmp/squeal-e2e-Xs1lpm/repo
 ❯ until test/e2e/support.ts:43:13
 ❯ test/e2e/lifecycle.test.ts:150:5

 Test Files  1 failed | 458 passed | 1 skipped (460)
      Tests  2 failed | 3874 passed | 10 skipped (3886)
   Start at  18:54:40
   Duration  731.68s (tests 97%, import 2%, transform 1%)
[exit 1]
$ git status --porcelain
[no output]
```

The second failure is the unchanged bad-config restart body at `test/e2e/lifecycle.test.ts:150`. It matches the captured, accepted 45 s `daemonReady` timeout in the row's notes, this time on Claude Code rather than Codex. It is recorded as a verification failure, not another finding against the changed code. This run proves the timeout happened; it does not establish why the daemon was not ready. Passing alone does not distinguish a slow start from a startup or replacement fault. Preserve daemon notes and process/exit evidence on its next recurrence.

The remaining changed test files passed. The real Codex test's availability guard, `spawnSync("codex", ["--version"]).status === 0`, was also checked in the same isolated environment: `status=0, enabled=true`. Its containing file passed. No macOS execution was performed; the non-Linux `isAlive` branch was inspected, not exercised here.

The supplied notes do not establish twenty consecutive loaded passes of every named case. They explicitly report the separate handoff failure on stress run 15. That missing historical proof is a verification limit; B1 below has its own observed failure at the clean candidate.

## Blockers

### B1. Proven: the replacement budget still fails in the required loaded full run

**Location:** `test/e2e/lifecycle.test.ts:70`, with the reference measurement at `:45`.

**Contract:** board row 001-320's done-when: “Each passes 20 runs in a row under `--maxWorkers=4` with the full suite running; test-only.”

**Evidence:** the independent full run above failed the Claude Code replacement check: `start.ms = 4428.4208`, paired PreToolUse median about `155`, and `max(HOOK_BUDGET_MS, 5 × median) = 2000`. The successful exit/stderr assertion immediately before the timing check passed. The new timing method therefore still rejects a run in the workload this row is meant to stabilize. The failure is an assertion, not Vitest's 5 s default, not the accepted 45 s daemon-ready timeout, and not the handoff-slack defect assigned to 001-326.

The formula is implemented correctly. The notes also honestly acknowledge that an isolated spike on the target can still fail it. That acknowledgement does not fulfill the pinned done-when or explicitly exempt this observed failure. This finding proves the row's stability goal is not established by this candidate; it does not prove that the hook contains a product delay or that the reference caused the failure.

**One-worker repair:** own `test/e2e/lifecycle.test.ts`, its fixture helpers only as needed, and the row's notes. Capture where the target's time accrues relative to the three reference calls: process launch, store access and daemon ensuring/readiness. Resolve the measurement or fixture condition on that evidence, while retaining the named `max(HOOK_BUDGET_MS, 5 × median)` comparison and every replacement/header/regression assertion. Do not merely raise the multiplier, skip a loaded failure, or turn an assertion failure into a timeout. If the evidence identifies a product delay, report it for a separate product row. Record the required twenty consecutive loaded passes, or have the coordinator explicitly amend/accept the stability criterion before closing the row. An isolated green rerun alone does not resolve B1.

## Should-fix

None beyond B1. The unchanged bad-config timeout needs evidence on recurrence, not a speculative test-only workaround in this review.

## Nits

### N1. Proven: the notes' opening contradicts their defect report

**Location:** `docs/specifications/001-core-loop/tasks/001-320/notes.md:3`.

“None showed a product defect” contradicts the later captured assertion failure and the handoff-slack explanation assigned to 001-326 at `:58` to `:62`. The test-only scope is accurate; the opening explanation is not. One worker can change it to say the implemented fixes are test-only and the discovered product defect was reported separately. No product change or board edit is needed.

### N2. Proven: PreToolUse is not generally read-only

**Locations:** `test/e2e/lifecycle.test.ts:38` and `docs/specifications/001-core-loop/tasks/001-320/notes.md:46`.

Both say PreToolUse “only reads the store.” Its recorded input is an edit. Both harnesses call `denyOnRegression`; that interface can resume an idle consumer's turn and mark an undelivered regression as denied/told. `src/harness/shared/deny.ts:28` documents those writes, and `src/core/delivery/turn.ts:85` implements the idle-to-in-turn transaction. It does not ensure a daemon, which is the relevant property for these references.

The current references run with no untold regression to consume, and no following lifecycle assertion depends on the consumer's turn state. No semantic assertion bypass was found here. One worker can reword the comment and notes to say the reference starts no daemon and does not alter the lifecycle state these cases assert. Do not describe that as a general read-only contract.

## What fits

- **Scope:** all fifteen changed paths are tests, test helpers or the row's notes. No `src`, plugin bundle, policy, manifest or lockfile change; no version bump was needed. Board and status were not edited.
- **D5, backlog cost:** the cold direct run is unmeasured. Each of three measured rounds pairs a fresh direct run immediately before the config edit and its backlog. The test sorts the three individual ratios and compares their median with `< 2`, rather than dividing independently selected medians/minima. Every round still asserts all 200 file identities, completed tiers and at most three tiers. The baseline tier limit is also retained. This file passed the independent run.
- **Goals 3/5, D6/D7, honest delivery/status:** status-wait and lifecycle retain their revision, pending, no-daemon, since-time, replacement and once-only delivery assertions. No production header or status rendering changed. The budget references start no replacement themselves. The extra references do not consume a regression in these fixtures.
- **Goal 6, D9/D10, hook budgets:** `budget` actually runs three PreToolUse processes through the selected plugin immediately after the target and returns `max(2000, 5 × median)`. There is no load-based skip. On a calm reference below 400 ms the original 2 s ceiling still decides. Above it this is a relative timing check; it does not prove a real harness's absolute 2 s deadline. Inflated references can mask smaller extra delays, a trade the notes explicitly disclose. B1 is the observed failure of the opposite case: the target is slow and the reference is not.
- **Per-test bounds:** the changed describes/tests get the documented 30 s or 60 s bounds; no global `testTimeout` was introduced. Vitest 5's suite collector inherits suite options into each contained test, including the numeric third-argument form. Whitespace aside, the retry and slow-untold tests retain their fixtures, clocks, revision guards, decisions and reasons. Each still waits on its command/hook or explicit store condition. The product's lock/poll/grace budgets are unchanged.
- **Codex answer bound:** only the real app-server test bypasses `main` to inject the existing `initCodex` dependency `timeoutMs: 60_000`, for both sessions. Stub cases still cover `main`'s flags and a silent app-server's bounded failure. The production 10 s default and request/answer protocol are unchanged. The test's 300 s outer bound does not change an app-server answer into a timer-only success.
- **Daemon teardown:** `daemonSuite` now passes `SLOW.timeout` (180 s) to its shared `afterEach`. It still awaits each child's exit, then stops strays, then removes fixture resources. The individual 60 s SIGKILL escalation is unchanged. No cleanup assertion or leak detection was removed. This permits multiple shutdown waits; it is not an unconditional sleep or an unlimited teardown.
- **`isAlive`:** only Linux stat-read `ENOENT`/`ESRCH` now means reaped after the successful signal probe. Other read errors remain alive; zombie stat text remains gone. Outside Linux an unreadable `/proc` remains alive. The optional reader is confined to the test helper, with injected missing/permission/I/O errors plus real live/dead PID tests. That file passed. The pre-existing signal-probe behavior is outside this change.
- **D1 to D4, D8, D11/D12:** workspace discovery, watcher/key/runner semantics, store transactions, policy handling and product error paths have no changed implementation. No changed seam calls a newly mismatched product interface.
- **001-326:** the handoff assertion is intact. `stop-slow.ts` is absent from the range; the notes identify the first-clock/check-time anchor and report it to a separate product row. This candidate does not pin the test clock to conceal that defect.

## Inputs for the next wave

1. Dispatch B1 as a lifecycle timing investigation/repair, with N1 and N2 as small wording edits. Preserve the target-before-three-PreToolUse ordering and the named formula until evidence supports an explicit design amendment. Keep PID replacement, current headers, failure delivery and once-only liveness checks.
2. Use four workers for full runs, unset `CODEX_SESSION_ID`, disable global/system git configuration, and keep every executable probe and child away from the real HOME. Capture the target and all reference timings and the actual failure text. Twenty loaded consecutive passes remain missing.
3. Leave the untouched 45 s `daemonReady` timeout as the recorded accepted case. On recurrence, retain daemon notes and process/exit evidence before attributing it to load. The repeated bad-config timeout in this review is not a newly introduced product finding.
4. Keep the handoff-slack work with 001-326. Its repair must preserve the current untold-failure assertion and supply the stalled-first-clock proof on both harnesses; this review neither examines nor approves later commits implementing it.
