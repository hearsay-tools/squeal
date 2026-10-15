# 008 wave 3b review

Verdict: **FAIL 5f425783**. **2 proven blockers**, no separate should-fix or nit findings. Exact candidate: `5f4257834a6c7a12b595b352f6caa329752839b3`, `cand/0.1.188`. Range: `fc323b37..5f425783`. Reviewed 2026-10-15 against spec 008 goal 4, D3 to D5, the 008-32 brief fetched from `origin/main`, lessons defect 5 and session 030-s4, and `reviews/wave-3.md` including its passing repair round.

## Verification output

All candidate commands and probes ran at the exact candidate with a clean tracked tree. Probes and logs were outside the repository; no product or test file was edited. The report was added afterwards. The brief assigns the independent full-suite run to the coordinator, so none was run here. Real OpenCode ran only through `squealOpenCode` or the e2e fixture, both of which use `runOpenCode` and its isolated directories and scripted provider.

```text
$ git rev-parse HEAD
5f4257834a6c7a12b595b352f6caa329752839b3
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.188 lint
> biome check .
Checked 1256 files in 1108ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.188 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.188 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.188 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)

$ npx vitest run test/harness/opencode/ test/harness/opencode-*.test.ts --maxWorkers=2 --no-color
FAIL test/harness/opencode-dispose.test.ts > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the held Stop ended without answering, seen +2064 ms after idle: the plugin kills it at its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +69 (pid 3961825), dispose +163, input +1378; the held Stop's deadline: +2000
Test Files  1 failed | 21 passed (22)
     Tests  1 failed | 156 passed (157)
  Duration  155.09s
exit 1

$ npx vitest run test/e2e/opencode.test.ts --testNamePattern 'news at the end|wakes it' --maxWorkers=1 --no-color
Test Files  1 passed (1)
     Tests  3 passed | 5 skipped (8)
  Duration  86.93s
exit 0
```

The focused suite's failure exhausted all three attempts before reaching the causal barrier for the newer request. The first two attempts reported the same missing Stop answer at +2,139 and +2,095 ms. This is **proven** failure of that verification attempt, not proof of stale report storage or a new product blocker. The failure now supplies useful ordering and timing. The test-name skips above are filtering. Load was 60.69 on this 24-CPU host during these commands; timing alone does not prove the cause of process exit.

**Unverified full-suite result.** The first Squeal checkpoint joined the baseline. After more than ten minutes it had not completed (the last status before the bounded request: 519 of 590 files done, 71 pending and 195 unknown). I then issued a bounded checkpoint request; that newer request replaced the first, and both CLI waits returned exit 3. No independent full run was substituted, per the brief. Background work continues in the daemon; this report does not wait for or certify it.

```text
$ node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs" run --all --wait
Checkpoint 83127997-a186-4371-8788-c4076438b49a has no verdict: it was abandoned before every test file had a result (a newer request replaced it, a tier crashed or timed out, or the daemon stopped)
Checkpoint 83127997-a186-4371-8788-c4076438b49a started at revision 0: 590 test files to run, 12 already current, joining the baseline checkpoint e7ab0bdc-6159-480e-b37e-270ea8dc079f already running them (0 of 590 test files done); it ends when that one ends
exit 3

$ node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs" run --all --wait 1000
Checkpoint a7ebe45c-0c17-4f77-a54e-7186ade29acf has no verdict: the deadline passed with 263 test files pending at revision 0; the checkpoint goes on in the daemon
Checkpoint a7ebe45c-0c17-4f77-a54e-7186ade29acf started at revision 0: 263 test files to run, 339 already current
Revision: 0
Known failures: 1 (1 test)
  FAIL test/scheduler/capacity-pool.test.ts > scheduler: the per-user pool (001 D11 Capacity, task 001-376) > runs an edit's tier without a grant while the pool and the daemon's free worker are taken
       expected false to be true // Object.is equality
       at test/scheduler/capacity-pool.test.ts:108:35, observed at revision 0, current
Affected checks: 2874 passed (2534 tests, 340 test files loaded), 0 running, 0 queued, 1 skipped (1 test); 262 test files without checks yet: 37 running, 225 queued
Full-suite checkpoint: none completed at any revision
Test files without checks: 262 pending, 0 unknown
exit 3
```

This failure is outside the changed files; its cause is **unverified**, not assigned to this wave. Squeal still reported “no revision recorded” and the earlier no-dependencies note after `npm ci`. Its last snapshot included inherited results from the parent's candidate and later `f4f1c3c`; that is not evidence from an independent clean run at the pinned SHA. The two blockers below stand on the independent focused probes, not this incomplete checkpoint.

After the report was added (revision 1, a docs-only change), Squeal reported the capacity-pool check recovering: `Flaky: FAIL -> PASS under the same inputs`. That later recovery does not erase the failed observation above. At that update, 213 test files still had pending results and no full checkpoint had completed. This is not a completed candidate-suite verdict.

The two discriminating external probes used the committed source and candidate build, without replacing the changed production logic:

```text
$ npx vitest run --config /tmp/008-32-review/vitest.config.mts /tmp/008-32-review/aborted.test.ts --no-color
stdout: abort hook completed before releasing reply
stdout: after abort planned requests: 3
FAIL an aborted continuation whose check already recovered must not continue again
AssertionError: expected ... to have a length of 2 but got 3
Test Files  1 failed (1)
     Tests  1 failed (1)
  Duration  9.87s
exit 1

$ npx vitest run --config /tmp/008-32-review/vitest.config.mts /tmp/008-32-review/timeline.test.ts --no-color
stdout: idle's deadline ... +2000
stdout: dispose's deadline: not in OpenCode's log, the store's +2500
stdout: dispose's end bridge started +2300
stdout: +2400 run exited
stdout: reading: ... the idle held dispose until the store's deadline (+2500) ... D4's silence at a missed deadline
FAIL an early drop before the store deadline is not a proven deadline miss
AssertionError: expected true to be false
Test Files  1 failed (1)
     Tests  1 failed (1)
  Duration  636ms
exit 1
```

An earlier ungated abort probe also received three requests (23.08 s). The displayed replay strengthens its causal ordering: a delegating plugin wrapper marks the abort only after the real event hook returns, and the test waits for that marker before releasing the reply.

The first external attempt could not load its config because an absolute `vitest/config` path did not resolve. A plain config export corrected the external runner before either probe ran; that setup error supplies no candidate evidence.

## Blockers

### B1. An aborted continued turn can still produce a second continuation

**Proven.** `src/harness/opencode/turns.ts:276`, through `src/harness/opencode/bridge-turn.ts:146`. Spec goal 4: “one continuation, and never twice in a row”; D3: an idle preceded by `MessageAbortedError` ends the turn with “no continuation.” The 008-32 brief explicitly includes a continuation the user aborts.

The new request flag is sent only when `turn.aborted` is false. A turn can be both continued and aborted. Its `endTurn` therefore takes the unchanged `delivery.endTurn` path, whose undelivered entries include already-current news. The newly armed waiter delivers that news immediately and starts a further model request. The abort's second idle does not prevent the first waiter's wake.

Real OpenCode 1.18.35 reproduction, using the same candidate bundle and `squealOpenCode` fixture as the added continued-turn test:

1. Start `serve` at a passing baseline, with `stop.waitMs: 1500` and prompt `edit`. In `onRegistered`, apply `r.fail()`. The first scripted reply is `done` with a 1,500 ms delay.
2. The resulting `PASS -> FAIL` continues the session. Hold the second provider reply with a release-file barrier. Wait until the second planned request actually exists.
3. While it is held, call `r.queue("k2")` and `r.apply(r.pass())`. The recovery is current before the turn ends.
4. Await a successful `POST /session/<id>/abort`, with `x-opencode-directory: r.root`. A delegating wrapper marks `MessageAbortedError` after the real plugin event hook returns; wait for that marker, then release the held provider reply.
5. Observe four seconds without sending a new user message. Expect two planned requests; observe **three**. The third's last user message begins `SQUEAL · 1 check changed (1 test) at revision 4` and contains `FAIL -> PASS`. Its header says `1 current`, `0 pending`.

The third request, not an expired timer or a missed barrier, proves the break. The external test's decisive body is:

```ts
const planned = () => live.requests.filter(q => q.model === PLANNED_MODEL);
await expect.poll(() => planned().length, { timeout: 30_000 }).toBe(2);
r.queue("k2");
r.apply(r.pass());
const aborted = await fetch(`${live.url}/session/${live.sessionID}/abort`, {
  method: "POST",
  headers: { "x-opencode-directory": r.root },
});
expect(aborted.ok).toBe(true);
await expect.poll(() => existsSync(seen), { timeout: 30_000 }).toBe(true);
writeFileSync(release, "");
await sleep(4_000);
expect(planned()).toHaveLength(2); // receives 3
```

**One-worker repair:** preserve the continued-turn restriction when an abort is also set. Add this barrier-ordered real test and a hook/bridge regression for `continued && aborted`; assert silence and delivery of the recovery at the next real user prompt. Keep the existing ordinary-abort and pending-file wake semantics. Rebuild the OpenCode bundles after the source repair.

### B2. Retry eligibility treats an early report loss as a proven deadline miss

**Proven.** `test/e2e/opencode-timeline.ts:277` and `:287`, consumed by `test/e2e/opencode.test.ts:340`. The 008-29 row requires failures to name their cause; its 008-32 review question expressly rules out hiding failures other than proven D4 deadline misses. The code and retry comment promise that the timeline proves the miss.

`HELD_MS = 250` changes “at the deadline” into “up to 250 ms before the deadline.” An end bridge starting in that interval establishes neither an expired storage/read deadline nor why the report was dropped. Nevertheless `missedDeadline` becomes true and the stored-once assertion is skipped for a fresh attempt. A transient product failure in that interval can be hidden by a later passing attempt.

The external probe calls the exported `timeline()` with small fixture databases, an assistant reply completed at idle, no stored report, and these observations (ms after idle):

| Observation | Time |
| --- | ---: |
| Stop bridge starts | +10 |
| Stop records delivery | +100 |
| Stop bridge last alive | +200 |
| Dispose's end bridge starts | +2300 |
| End bridge last alive | +2350 |
| OpenCode last alive, no consumer rows | +2390 |
| Run exits | +2400 |
| Timeline's storage deadline | +2500 |

The whole run ended before that storage deadline. Stop also finished far inside its own +2000 ms deadline. `timeline()` nevertheless returns `missedDeadline: true` and the categorical text quoted in verification. This proves an incorrect retry classification; it does **not** claim that the passing real e2e happened to take this route. The equivalent `removed.after` comparison has the same 250 ms acceptance window.

The dispose test's separate `stopGone()` at `test/harness/opencode-dispose.test.ts:165` has the same evidence problem: any PID disappearance without an `answered` mark is retryable, without checking elapsed time against the idle deadline. An early crash or cancellation is not thereby a deadline expiry. This source observation belongs to the same repair; no such early process death was reproduced here.

**One-worker repair:** make uncertain causes fail the assertion with their observations, or label them unresolved without enabling retry. Require evidence of actual deadline expiry for retry eligibility; a near-deadline end or PID disappearance alone is insufficient. Add small discriminating timeline tests for early report loss, genuine expiry, and missing timing evidence. Preserve the stored-once assertion, attempt limit and each attempt's diagnostics.

## Should-fix and nits

None separate from B1 and B2. The focused barrier failure above remains in the verification record; it is not promoted to a product finding.

## What fits

- **Proven by passing candidate tests:** the ordinary, un-aborted continued-turn reproduction stays silent with a current recovery, and its next user prompt receives `FAIL -> PASS`. The bridge tests preserve a wake for a file genuinely pending at the continued idle. Ready news is left in the delivery view, rather than acknowledged and lost.
- **Proven by source:** an ordinary continuation and a waiter-created wake share `say()`, which sets `continued` before submitting their message. Both take the new path at their un-aborted idle. A child bypasses root turn handling: `hooks.ts:134` unregisters its consumer at idle and arms no root waiter. The requested focused suite passed those existing hook, child and wake cases.
- **Proven by source:** `endContinued` keeps the original store transaction and registered-consumer guard and delegates key, revision, new-file and pending-file selection to the same core `endTurn`. The old call supplied neither `atRevision` nor `handoff`; its defaults did no liveness touch. Thus no used revision fence, handoff or liveness operation was lost in this replacement. The intentional difference is omission of the undelivered-entry files. It does not write the consumer's view, so the next prompt or tool boundary can deliver them. This does not excuse B1's alternate path.
- **Proven by historical source:** the mechanism for defect 5 already exists at the reviewed 0.1.184 commit `26d306c8`: a continued idle calls plain `endTurn`, then arms the waiter, and the bridge delegates to `delivery.endTurn`, including undelivered-entry files. Wave 3 did not introduce that mechanism. This is source evidence, not a fresh run of the historical binary.
- **Proven by the shipped-copy e2e:** normal `run` still stores one report read once by `run --continue`; ordinary `serve` continues once; an idle pending-file result wakes the session. These three cases passed in this review.
- **Proven by source and completed checks:** `watchRun` reads the supplied fixture database, fixture package paths and `/proc` process metadata; it starts no child process. OpenCode's logs and database are under `runOpenCode`'s isolated run directory, not the real HOME. Its read-only database closes in `finally`. The directly invoked OpenCode checks and probes ended; `runOpenCode` kills its process group in `finally`, including when the abort assertion fails. The separate background checkpoint may still run OpenCode tests, as qualified above. Process ownership elsewhere on the host was left alone.
- **Proven:** all committed bundles match the build and the 0.1.188 metadata; no core, runner or daemon source change is hidden in this range. The substantive production change is confined to the three OpenCode source files.

## Inputs for the repair and re-review

- Repair B1 before landing. Check both flags together, retain news for the next user boundary, and replay the abort reproduction using the real built plugin through `runOpenCode`.
- Repair B2 in the test-only ownership of 008-29. Retry only with proven deadline evidence; preserve all unexpected failures and their observations.
- Keep one idle deadline, the existing 3-second disposal deadline and reserve, root/child identity, disposal's supersession checks and ordinary `run --continue` storage. This review does not reopen wave 3's settled storage design.
- Re-review the exact repaired candidate and rebuilt bundles. The coordinator retains its independent host-lock gate and branch-CI responsibility. This report claims no independent full-suite verdict.

## Round 2: repair re-review at 74f093ba

Verdict: **FAIL 74f093ba**. **B1 closed; B2 remains a proven blocker.** No new blocker, should-fix or nit. Reviewed 2026-10-15 at exact candidate `74f093babc6cf20c9535e7fa180b911adbdd8e78`, range `5f425783..74f093ba`, against the first round above and the 008-33 brief fetched from `origin/main`. Scope: the coordinator's `4ec92772` abort repair and hook test, `f4f1c3c5` deadline slack removal, `d3978509` bundle, and 008-33's three test commits (`d7e0a0ad`, `73affe97`, `74f093ba`).

### Verification output

The candidate was clean for the build, checks and external probes. Real OpenCode ran only through `squealOpenCode` and the e2e fixture, which use `runOpenCode`; the scripted provider, homes, configuration and databases were isolated. External probes lived outside the repository and imported this worktree, replacing no production logic. The original abort probe built the plugin through the candidate's build function; `npm run build` left the committed bundles unchanged. The review file was added after the checks. No independent full suite or Squeal full-suite checkpoint was requested in this narrow round.

```text
$ git rev-parse HEAD
74f093babc6cf20c9535e7fa180b911adbdd8e78
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.188 lint
> biome check .
Checked 1253 files in 760ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.188 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.188 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.188 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)

$ npx vitest run test/harness/opencode/ test/harness/opencode-*.test.ts test/e2e/opencode*.test.ts --maxWorkers=2 --no-color
FAIL test/harness/opencode-dispose.test.ts > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2025, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +67 (pid 1367768), dispose +223, input +1584, kill +2025 (pid 1367768); the held Stop's deadline: +2000
attempt 1 of 3: plugin killed the held Stop at +2369
marks: idle +0, stop +94 (pid 1349175), dispose +176, input +762, kill +2369 (pid 1349175)
attempt 2 of 3: plugin killed the held Stop at +2083
marks: idle +0, stop +99 (pid 1358222), dispose +266, input +1406, kill +2083 (pid 1358222), disposed +2507
Test Files  1 failed | 24 passed (25)
     Tests  1 failed | 180 passed (181)
  Duration  203.85s
exit 1

$ npx vitest run --config /tmp/008-32-round2-probes/vitest.config.mts /tmp/008-32-round2-probes/aborted.test.ts /tmp/008-32-round2-probes/timeline.test.ts --no-color
Test Files  2 passed (2)
     Tests  2 passed (2)
  Duration  14.08s
exit 0

$ npx vitest run --config /tmp/008-32-round2-probes/vitest.config.mts /tmp/008-32-round2-probes/abort-next-prompt.test.ts --reporter=verbose --silent=false --no-color
abort hook completed before releasing reply
after abort planned requests: 2
next real prompt received recovery, planned requests: 3
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  18.92s
exit 0

$ npx vitest run --config /tmp/008-32-round2-probes/vitest.config.mts /tmp/008-32-round2-probes/missing-dispose.test.ts --no-color
FAIL missing dispose timing cannot prove expiry of its storage deadline
AssertionError: expected true to be false
Test Files  1 failed (1)
     Tests  1 failed (1)
  Duration  471ms
exit 1
```

The last failure is the discriminating B2 probe below, separate from the candidate's own tests. It is not a product-delivery reproduction. The focused suite's dispose failure exhausted three attempts before the new request's causal barrier; each now names an observed matching plugin kill after +2000. It supplies no evidence of stale storage, and is not an additional blocker. All other candidate tests, including the new real abort regression, six held-Stop classifier cases, seven pure timeline cases and eight shipped-copy e2e cases, passed with no skips. Sampled load was 28.69 to 50.77 on this 24-CPU host; timing alone is not assigned a cause.

### B1: closed

**Proven by source and experiment.** `src/harness/opencode/turns.ts:277` now selects `continued: true` whenever the turn was continued, including when it was also aborted. Ordinary aborts still take plain `endTurn`. The hook regression pins both flags together.

I replayed the original independent, barrier-ordered abort probe against this candidate's built plugin: hold the first continuation's reply, make the recovery current, abort through OpenCode's API, wait for the real plugin event hook to finish handling `MessageAbortedError`, then release the reply. After four seconds there were exactly two planned requests, rather than the original three. A second replay added a real user prompt after the silent interval: exactly one further request arrived, with that prompt and `FAIL -> PASS`. B1's cancellation and retained-news requirements hold in both probes. The new candidate regression also passed with that same next-prompt delivery.

### B2: still open, missing dispose timing authorizes retries

**Proven.** `test/e2e/opencode-timeline.ts:188` to `:198` substitutes `idle` when the dispose timestamp is missing. The three dispose-based retry paths (`:270`, `:279`, `:289`) then treat that estimated deadline as proven. The new missing-timing guard rejects only a missing *idle*, not a missing *dispose*. `test/e2e/opencode.test.ts:340` uses the resulting `missedDeadline` to skip the stored-once assertion and retry. This remains the first round's B2 requirement: uncertain timing must not make a missing report retryable.

Removing 250 ms of slack fixes the original +2300 case; my original early-loss probe now passes. It does not repair the substituted deadline. The comment that dispose happens about 10 ms after idle is an observation, not a bound on this run. The plugin's storage budget actually begins in `hooks.ts`'s `dispose`, with 2,500 ms left after its 500 ms reserve.

The external pure probe presents exactly the same bridge and process observations twice, with a single difference: one input has a dispose log at +100 and the other has lost that log. No OpenCode is launched by this probe.

| Observation, ms after the reply/idle reference | Both inputs |
| --- | ---: |
| Stop starts / last alive | +10 / +200 |
| Stop delivery | +100 |
| Dispose end bridge starts / last alive | +2500 / +2550 |
| OpenCode last alive / run exit | +2590 / +2600 |
| Stored report | none |

```text
With dispose observed at +100:
  dispose's deadline: +3100, the store's +2600
  reading: ... before the store's deadline (+2600) with nothing stored ...
  missedDeadline: false

With that single observation absent:
  dispose's deadline: not in OpenCode's log, the store's +2500
  reading: ... the idle held dispose until the store's deadline (+2500) ...
           D4's silence at a missed deadline
  missedDeadline: true
```

Losing evidence converts the same early loss into permission to retry. The complete observation set establishes that +2500 is 100 ms before the storage deadline. The incomplete set cannot establish otherwise. This proves a retry-classification bug, not that a real passing e2e took this route or that production lost a report. The new tests at `opencode-timeline.test.ts:120` and `:134` instead require `true` with no dispose evidence, so their green result preserves this gap. The consumer-removal and still-live-host branches use the same substituted deadline.

**Repair sized for one test-only row:** do not authorize a dispose-based retry without evidence sufficient to bound that run's actual dispose/store deadline. Missing dispose timing must remain unresolved and non-retryable; it need not disable an independently proven Stop deadline expiry. Add the paired input above, with and without the dispose observation, to the pure tests. Make genuine-expiry fixtures establish their own deadline rather than infer it from idle, and cover the consumer-removal and live-host alternatives too. Keep the attempt limit, diagnostics and stored-once assertion.

### What fits and next input

- **Proven by source:** the held-Stop classifier now requires an observed plugin SIGKILL of the matching live process group at or after idle +2000, with no own-exit mark. Early kill, own exit, mismatched or absent kill, missing idle and answered Stop are non-retryable. `reached()` throws `Missed` only for that positive classification, and `ordered()` catches only `Missed`. PID disappearance or a late poll alone no longer enables a retry.
- **Proven by experiment:** all six pure held-Stop cases and its new real deadline-kill test passed. The original B1 abort and B2 early-loss probes are repaired; the extra B1 replay preserves delivery at the next real prompt.
- No product repair is requested for B1. B2 remains in the timeline's test-only ownership. This narrow round does not reopen the reviewed continuation, pending-file wake, child or disposal-supersession design. Per process step 6, a second FAIL goes to the human through the coordinator.

## Round 3: B2-only re-review at 854d66ae

Verdict: **PASS 854d66ae**. **B2 closed; 0 blockers, 0 should-fix findings, 0 nits.** Reviewed 2026-10-15 at exact candidate `854d66aed2a0c368e3c4bbf365242eb7f92ed231`, range `74f093ba..854d66ae`: one test-only commit, `test/e2e/opencode-timeline.ts` and `test/e2e/opencode-timeline.test.ts`. This human-authorized round checks only Round 2's "B2: still open", read after `git fetch origin` from `origin/main` (`efc02ad3`). B1 and the other settled product behavior stay outside this round.

### Verification output

The candidate was clean for all checks and probes below, and remained clean after the build and targeted tests. The original round-2 missing-dispose probe was copied outside the repository with only its worktree import repointed to this exact candidate. Its observations and assertions were unchanged. No product or test file was edited. Real OpenCode ran only through `squealOpenCode` and its `runOpenCode` fixture. No full suite or Squeal checkpoint was requested, per the brief. This is a narrow review, not a full-suite certification.

```text
$ git rev-parse HEAD
854d66aed2a0c368e3c4bbf365242eb7f92ed231
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 13s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.188 lint
> biome check .
Checked 1253 files in 1033ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.188 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.188 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.188 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)

$ npx vitest run test/e2e/opencode-timeline.test.ts --maxWorkers=1 --no-color
Test Files  1 passed (1)
     Tests  11 passed (11)
  Duration  1.38s
exit 0

$ npx vitest run --config /tmp/008-32-round3-probes/vitest.config.mts /tmp/008-32-round3-probes/missing-dispose.test.ts --no-color
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  352ms
exit 0

$ npx vitest run test/harness/opencode-dispose.test.ts test/harness/opencode-wake.test.ts --testNamePattern 'abort of the new turn|news at idle continues' --maxWorkers=1 --no-color
FAIL test/harness/opencode-dispose.test.ts > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2251, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +79 (pid 1605686), dispose +232, kill +2251 (pid 1605686); the held Stop's deadline: +2000
attempt 1 of 3: plugin killed the held Stop at +2453
marks: idle +0, stop +46 (pid 1574355), dispose +93, input +1013, kill +2453 (pid 1574355)
attempt 2 of 3: plugin killed the held Stop at +3018
marks: idle +0, stop +155 (pid 1589132), dispose +355, kill +3018 (pid 1589132)
Test Files  1 failed | 1 passed (2)
     Tests  1 failed | 1 passed | 4 skipped (6)
  Duration  82.25s
exit 1

$ git status --short
(no output)
```

The four skips are the explicit name filter. The one passing real test was `opencode-wake`'s `serve: news at idle continues the turn once, then silence`. Sampled load was 38.32 before verification, 52.91 during the targeted run, 72.27 near the dispose failure and 78.29 after the command, on this 24-CPU host.

### B2: closed

**Proven by source and experiment.** `test/e2e/opencode-timeline.ts:188` to `:192` makes both dispose deadlines `null` without OpenCode's dispose line. The guard at `:272` to `:276` returns `missedDeadline: false` with an explicit unresolved reading before all three dispose-based paths: a live host holding its consumer (`:279`), consumer removal (`:285`), and an observed end bridge (`:298`). None can authorize a retry from missing dispose timing. The earlier no-delivery outcome is also non-retryable. There is no remaining idle substitution for dispose's deadline.

Stop's separate proof stays independent: `:266` checks its last observed life against the idle deadline before that guard. The missing-idle guard still prevents any deadline classification when neither log nor completed reply times the idle. The two Stop-expiry tests (`opencode-timeline.test.ts:160` and `:216`) exercise observed and missing dispose timing; both retain `missedDeadline: true` for Stop alive at idle +2000.

The original missing-dispose probe now passes. For the same observed Stop (+10 to +200), end bridge (+2500 to +2550), host (+2590) and exit (+2600), a dispose line at +100 yields the known +2600 store deadline and no retry. Removing that line yields unknown dispose/store deadlines, an unresolved reading and no retry. Losing evidence no longer creates retry permission.

The new pure pair at `opencode-timeline.test.ts:183` pins those exact observations with and without the dispose line, including both diagnostic readings. `:197` covers missing dispose timing for consumer removal and the still-live host. Genuine-expiry fixtures now write their own dispose log line at +0; their positive cases establish their deadline instead of inferring it from idle. The live-host positive case at `:222` also passes. The consumer's bounded attempt count and stored-once assertion in `opencode.test.ts` are unchanged.

### The two reported real-OpenCode failures

- **Proven deadline miss, no evidence of a further defect:** the coordinator's dispose-abort failure names the matching plugin kill at +2021, after idle +2000, before the new-request barrier. This review's replay exhausted three attempts with the same positive kill classification at +2453, +3018 and +2251. It never reached the causal order needed to test old-report storage after an abort. These are failed verification attempts, not stale-storage reproductions. Neither the supplied failure nor this replay looks like more than a missed deadline.
- **Unverified cause, no demonstrated further defect:** the coordinator's wake miss (one planned request instead of two, once in three alone) is compatible with the shared idle budget expiring. `hooks.ts:129` to `:139` puts consumer lookup, Stop and continuation inside one deadline; `turns.ts:193` to `:215` can withhold or abort the continuation when it expires. But a request count and host load do not prove which boundary missed or rule out another cause. The replay here passed, including the four-second silence assertion. I see no positive evidence of more than a deadline miss, but do not certify the coordinator's wake failure as a proven deadline miss. It remains a load-sensitive verification note, outside this test-only B2 repair.

### What fits and next input

B2's requested repair and paired regression are complete. No further repair is requested in this scope. Keep both the missing-dispose guard and the independent Stop proof when changing these diagnostics. The coordinator retains the landing decision and any broader verification; this verdict does not turn the named real-test failure into a passing run.


## Round 4: shared-file re-review at 63289a86

Verdict: **PASS 63289a86**. **0 blockers, 0 should-fix findings, 0 nits.** Reviewed 2026-10-15 at exact candidate `63289a86abccc899884d42ea8240b89a46278baf` (`cand/0.1.192`). This is row 008-35, read after `git fetch origin` from `origin/main` at `b35512d1408a4109fd7e97a743f9637f26fcf302`. Scope is process step 6's shared-file re-review after Round 3's PASS on `854d66ae`: the eight version files and 31 bundles also changed by intervening main work. B1, B2 and the other settled OpenCode behavior are not reopened.

### Verification output

HEAD matched the assigned candidate and the worktree was clean before installation. `npm ci` ran before all checks. The tree remained clean after the build and targeted test. Only this review file was appended afterward. No full suite, Squeal checkpoint, real OpenCode session or external probe was requested in this round. The coordinator retains its independent gate under the host lock.

```text
$ git rev-parse HEAD origin/main
63289a86abccc899884d42ea8240b89a46278baf
b35512d1408a4109fd7e97a743f9637f26fcf302
$ git status --short
(no output)
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
added 196 packages, and audited 197 packages in 18s
32 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
  @google/genai@2.21.0, @parcel/watcher@2.6.0, esbuild@0.28.2,
  msgpackr-extract@3.0.4, opencode-ai@1.18.35, protobufjs@7.6.6
exit 0
$ npm run build
> squeal@0.1.192 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.192 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)
$ npm run lint
> squeal@0.1.192 lint
> biome check .
Checked 1272 files in 7s. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.192 typecheck
> tsc --noEmit
exit 0
$ npm run check:version -- origin/main
> squeal@0.1.192 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main
version bump: 0.1.190 -> 0.1.192, ok
exit 0
$ npx vitest run test/keys/key-format.test.ts
Test Files  1 passed (1)
     Tests  29 passed (29)
  Duration  5.47s (tests 75%, transform 18%, import 8%)
exit 0
$ git status --short
(no output)
```

Content comparison also completed at the clean candidate:

```text
$ git range-diff --no-color --creation-factor=80 981e2ce7..854d66ae 837f3424^..f6b22661
14 non-build commits paired in order; each pair differs only in its
commit message's added cherry-pick trailer. No patch hunk differs.
5f425783 and d3978509 are omitted build commits, with no counterpart.
exit 0
$ git range-diff --no-color 74f093ba..854d66ae e0f14111..f6b22661
854d66ae -> f6b22661: only the added cherry-pick trailer differs.
exit 0
```

The range-diff output above is summarized. As a separate content check, a read-only Python comparison obtained each ordered non-build commit's patch with `git diff <commit>^ <commit> --no-ext-diff --binary`: all 14 original/rebased pairs were byte-identical. It also compared every source/test file changed by `981e2ce7..854d66ae` with its copy at HEAD: all 14 files were byte-identical.

### What fits

- **Proven by Git content comparison:** the shared non-doc paths of `981e2ce7..854d66ae` and `981e2ce7..837f3424^` are exactly eight version files and 31 files under `plugins/*/dist`. There is no shared source, test or eval path. The candidate's separate OpenCode plugin bundle also rebuilt without drift. The cherry-pick introduces no content change to the previously reviewed patches, including Round 3's B2 repair.
- **Proven by parsed metadata and diff:** `package.json`, `plugins/{claude-code,pi,opencode}/package.json`, `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/codex/.codex-plugin/plugin.json`, `install.sh`'s `SQUEAL_VERSION`, and both root and `packages[""].version` in `package-lock.json` all contain `0.1.192`. Those eight files change only their versions from `0.1.190`; no dependency, export or install logic changes. The version gate against the fetched main passes.
- **Proven by clean installation and build:** the committed bundles reproduce from this candidate's lockfile and combined source tree. `npm ci` and `npm run build` leave no tracked drift. Lint and typecheck pass on that same clean tree.
- **Proven by source comparison and the targeted test:** `src/core/keys/key-format.ts` is byte-identical to fetched main, including `KEY_FORMAT_VERSION = 10` and its current pin `5f033c149d273283caf5babd97a9f657b81a158e2ef107821a067cfb870d92d5`. All 29 key-format tests pass, so combining these reviewed OpenCode changes with main requires no further key re-pin in this candidate. This does not claim that main's guarded-source pin is identical to the earlier 0.1.188 tree.

### Inputs for landing

No repair is requested in this scope. Preserve the exact candidate and its reproducible bundles. Round 3's settled findings stand; its load-sensitive real-test notes remain qualified as written. This PASS covers the shared files at `63289a86`, with no independent full-suite verdict from this worker. The coordinator owns the remaining landing gate and CI decision.


## Round 5: shared-file re-review at 9ffd66f4

Verdict: **PASS 9ffd66f4**. **0 blockers, 0 should-fix findings, 0 nits.** Reviewed 2026-10-15 at exact candidate `9ffd66f43a6285c163694ba0ee9d3f7982e752d1` (`cand/0.1.192`). Row 008-36 was read after `git fetch origin` from `origin/main` at `cd79540c56c42cdc24a0ce3da0663b871bc529d7`. This round covers process step 6's shared files after 007-42 landed 0.1.191 (`85d830c5`), following Round 4's PASS at `63289a86`. The 14 non-build commits were re-picked onto `7f739bc6`, then built and versioned once. B1, B2 and the other settled OpenCode behavior remain closed and outside this round.

### Verification output

HEAD matched the assigned candidate. The worktree was clean before installation and remained clean after all checks, including the build. `npm ci` preceded the checks. The existing review file matched fetched main's Rounds 1-4 byte-for-byte before this append. No full suite, Squeal checkpoint or real OpenCode session was requested. The targeted Vitest run is the explicit key-format gate required by the brief.

```text
$ git rev-parse HEAD origin/main
9ffd66f43a6285c163694ba0ee9d3f7982e752d1
cd79540c56c42cdc24a0ce3da0663b871bc529d7
$ git status --short
(no output)
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
added 196 packages, and audited 197 packages in 8s
32 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
  @google/genai@2.21.0, @parcel/watcher@2.6.0, esbuild@0.28.2,
  msgpackr-extract@3.0.4, opencode-ai@1.18.35, protobufjs@7.6.6
exit 0
$ npm run lint
> squeal@0.1.192 lint
> biome check .
Checked 1272 files in 773ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.192 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.192 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.192 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ npm run check:version -- origin/main
> squeal@0.1.192 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main
version bump: 0.1.191 -> 0.1.192, ok
exit 0
$ npx vitest run test/keys/key-format.test.ts
Test Files  1 passed (1)
     Tests  29 passed (29)
  Duration  2.33s (tests 80%, transform 14%, import 6%)
exit 0
$ git status --short
(no output)
```

The Git comparison ran on the same clean candidate:

```text
$ git range-diff --no-color '63289a86~15..63289a86~1' 'HEAD~15..HEAD~1'
 1: 837f3424 =  1: 16a4bb59
 2: b17ff54d =  2: bab92f0a
 3: 4c5a8f3a =  3: 455ac4cf
 4: c3ba3cef =  4: d977252e
 5: 3478535c =  5: 77140223
 6: 0685b5bc =  6: cfb94901
 7: 4cf4c624 =  7: 40153c7d
 8: 2930b56c =  8: 61fd8923
 9: b69ab6f1 =  9: 07d84780
10: b64dcc77 = 10: df161fac
11: b00b958a = 11: ef3543ad
12: 6e53f421 = 12: 746c94c5
13: e0f14111 = 13: e3b4ab63
14: f6b22661 = 14: bd7f8dda
exit 0
```

The range-diff above omits subjects only. An additional read-only Python comparison of `git diff --no-ext-diff --binary <commit>^ <commit>` confirmed all 14 ordered patch pairs are byte-identical. All 14 source/test files touched by the previously reviewed candidate are also byte-identical between `63289a86` and `9ffd66f4`.

### What fits

- **Proven by Git comparison:** intersecting the non-doc paths changed by `63289a86~15..63289a86` with those changed by `63289a86~15..9ffd66f4~15` gives exactly eight version files and 31 files under `plugins/*/dist`. No source, test or eval path is shared. Fetched main differs from the new base `7f739bc6` only in the board and wave-3 task brief. The new build commit changes only version metadata and bundles.
- **Proven by parsed metadata and diff:** version `0.1.192` appears in root `package.json`, all three plugin package files (`claude-code`, `pi`, `opencode`), both manifests (`claude-code`, `codex`), `install.sh`'s `SQUEAL_VERSION`, and both root and `packages[""].version` in `package-lock.json`. These eight files change only their versions from `0.1.191`. The version gate against fetched main passes.
- **Proven by clean installation and build:** the committed bundles reproduce from the combined source tree and lockfile without tracked drift. Lint and typecheck pass on the same clean candidate. This verifies that the shared bundles include the combined sources without carrying the earlier build commit forward.
- **Proven by source comparison and the targeted test:** 007-42's `src/runners/pytest/adapter.ts`, `test/runners/pytest/adapter-files.test.ts` and `src/core/keys/key-format.ts` are preserved byte-for-byte from the new main base. The key-format file also matches fetched main: format remains 10 with pin `a0457b0f84c025c51a5ee196d689b6d45d2f08278081680696cffaceededf806`. All 29 key-format tests pass. No additional re-pin is required by this candidate.

### Blockers, should-fix and nits

None in this scope. No plausible or unverified defect is raised. **Unverified in this round:** full-suite behavior and real OpenCode execution, intentionally excluded by the brief. Round 3's qualified load-sensitive real-test notes remain as written; this round supplies no new evidence about them.

### Inputs for landing

No repair is requested. This PASS applies to the shared files at exact candidate `9ffd66f43a6285c163694ba0ee9d3f7982e752d1`. Keep the reproduced bundles and 007's key pin. The coordinator owns the remaining landing gate under the host lock and CI decision.
