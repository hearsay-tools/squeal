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
