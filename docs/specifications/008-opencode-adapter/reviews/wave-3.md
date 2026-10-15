# 008 wave 3 review

Verdict: **FAIL ceea98c2**. **1 proven blocker**, 1 plausible should-fix note, no nits. Exact candidate: `ceea98c24386f13d1b56d9a4f44be8445740c543`, `cand/0.1.186`. Range: `19379f39..ceea98c2`. Reviewed 2026-10-15 against spec 008 goals 4 and 6, D3 to D5 and D7 as amended, the 008-27 brief on `origin/main`, `reviews/wave-2.md`, and lessons defects 1, 2 and 4(a).

## Verification output

The worker started at the exact candidate. All commands and external probes below ran with that HEAD and a clean tracked tree. No product file was edited. Only this report was subsequently added. The brief assigns the independent host-lock full run to the coordinator; this reviewer used Squeal for its full-suite verdict.

```text
$ git rev-parse HEAD
ceea98c24386f13d1b56d9a4f44be8445740c543
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 13s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.186 lint
> biome check .
Checked 1232 files in 584ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.186 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.186 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.186 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)

$ npx vitest run test/harness/opencode/run-end.test.ts test/harness/opencode/idle.test.ts test/harness/opencode/bridge-client.test.ts test/harness/opencode/turn.test.ts test/helpers/opencode.test.ts test/cli/opencode-status.test.ts test/cli/update.test.ts test/cli/update-opencode.test.ts test/cli/update-pi.test.ts --maxWorkers=1 --no-color
Test Files  9 passed (9)
     Tests  82 passed (82)
  Duration  29.32s
exit 0
```

The shipped-copy end-to-end checks exercised both paths. The first run failed the new `run` assertion; its focused follow-up passed. Both outcomes are retained, with the unresolved cause in S1.

```text
$ npx vitest run test/e2e/opencode.test.ts --testNamePattern 'news at the end' --maxWorkers=1 --no-color
FAIL run: news at the end of the turn is stored in the session, and run --continue reads it once
AssertionError: expected [] to have a length of 1 but got +0
at test/e2e/opencode.test.ts:299:22
Test Files  1 failed (1)
     Tests  1 failed | 1 passed | 6 skipped (8)
  Duration  70.27s
exit 1

$ uptime
load average: 68.90, 39.31, 24.56
$ npx vitest run test/e2e/opencode.test.ts --testNamePattern 'run: news at the end' --maxWorkers=1 --no-color
Test Files  1 passed (1)
     Tests  1 passed | 7 skipped (8)
  Duration  33.09s
exit 0
```

The passing test in the first command is `serve: news at the end of a turn continues it once, then silence`. Those command-line skips are test-name filtering. The full checkpoint separately reports ten skipped tests.

The requested Squeal checkpoint initially had pending files and no verdict. It completed before this report was written. This final checkpoint reuses the now-current results and starts no new run:

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait 60000
Checkpoint a83b93a8-e3dd-4c02-a364-5a15fa7eda00 completed at revision 0: no known failures; 592 test files, 592 already current, 0 run now
Checkpoint a83b93a8-e3dd-4c02-a364-5a15fa7eda00 started at revision 0: 0 test files to run, 592 already current

Revision: 0
Known failures: 0
Affected checks: 5472 passed (4880 tests, 592 test files loaded), 0 running, 0 queued, 10 skipped (10 tests)
Full-suite checkpoint: completed at revision 0

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/5b5f792f-a850-4f21-a03d-ac9e57c1bd60 (HEAD ceea98c, dirty state not known: no revision recorded yet)
Daemon: running, last heartbeat 1 s ago
Inherited from other worktrees: 3167 current results (2811 tests, 356 test files loaded)
  3167 (2811 tests, 356 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dda82ed-d43b-4fa4-9246-d474cf5f9d89 at ceea98c
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  no revision recorded for this worktree yet
  2026-10-15T02:34:20.377Z, revision 0: no dependencies are installed in this worktree; Squeal lists and runs no tests until an install
exit 0
```

**Proven:** this is a completed Squeal verdict at the candidate, with no pending files. Its revision-0 metadata does not record a clean/dirty observation. The separate git checks above establish the clean checkout throughout verification; do not read the checkpoint as supplying that missing provenance. The no-dependencies note is historical. This is not an independent full-run claim. The external failing probes below are outside the configured suite and therefore do not appear in Squeal's known failures.

## Blockers

### B1. Proven: disposal stores an old continuation after newer input and an abort

`src/harness/opencode/hooks.ts:279`, `:144`, `:180`; `src/harness/opencode/turns.ts:162`, `:244`.

The 008-27 brief explicitly asks: “Do an abort or new input during dispose still cancel the continuation (review 008-16 B2)?” D3 requires no continuation after an abort; the reviewed epoch contract permits a continuation only for the turn that went idle, still live and not overtaken by a message.

The new disposal path sets `disposed = true`, then lets old idles finish and send `session.prompt({ noReply: true })`. While it waits, the event guard discards `MessageAbortedError` and the message guard discards input. OpenCode can also recreate the plugin state, routing the new `chat.message` to a new instance. The original turn's epoch then stays unchanged. `say` sees that old epoch as live and stores the report even though the user has already started and aborted another turn.

**Proven with public hooks:** two external tests registered and opened a root turn, gated its Stop, began `dispose`, delivered respectively an abort and a new message, then released Stop. Both expected `client.stored` to be empty. Both received one stored report. Result: **2 tests failed, 1.83 s, exit 1**. They use the candidate's hook factory and existing stub client/bridge, not a replacement turns implementation.

**Proven in real OpenCode 1.18.35:** two external Vitest probes used `squealOpenCode`, hence `runOpenCode`, its isolated home and scripted provider, and a fresh `buildOpencodeBundles()` output. Only the temporary Stop bridge was replaced by a file-gated answer. A wrapper around the temporary plugin recorded lifecycle events and released the barrier; it delegated all Squeal behavior to the unchanged built plugin. No project source or installed package was patched.

Reproduction for one repair row:

1. Use `serve`, `stop.waitMs: 1500`, a first reply `done`, and a second scripted reply delayed 5 seconds. Gate Stop after recording that it started; its eventual answer is `{ report: "SQUEAL · old turn report" }`.
2. In `afterReply`, wait for that Stop-start marker. Start `POST /instance/dispose` with `x-opencode-directory` naming the fixture project. A wrapper around the real `dispose` writes a marker immediately before awaiting it.
3. After that marker, call `live.message("new input")`. In a wrapper around the real `chat.message`, record seeing the new input and release the Stop barrier. Delegate the message to the original hook. This orders the new input before the old report, without a sleep deciding the race.
4. Await disposal and inspect `GET /session/<id>/message`. Its user messages are `[first + header, new input + header, SQUEAL · old turn report]`. The last message must be absent. The probe fails that assertion: **1 test failed, 6.01 s, exit 1**.
5. For the abort variant, release Stop only after the second planned model request has arrived and `POST /session/<id>/abort` has returned. The old and new plugin event listeners both observe `MessageAbortedError` before Stop answers. The same old report is still stored after the new input: **1 test failed, 6.08 s, exit 1**.

Recorded causal order, milliseconds from the first idle:

| Event | New-input probe | Abort probe |
| --- | ---: | ---: |
| first idle | 0 | 0 |
| original dispose enters | 70 | 72 |
| new input reaches `chat.message` | 175 | 208 |
| `MessageAbortedError` reaches the listeners | not needed | 1284 |
| old Stop answers | 178 | 1322 |
| original dispose returns | 642 | 1390 |

Both probes finish disposal inside its 3-second budget. This is not a missed-deadline result. An earlier ungated probe was inconclusive because input did not reliably precede the report; it is not the evidence for this blocker.

**Fix, one worker:** preserve cancellation of an in-flight disposal decision through aborts and newer user input, including input routed to recreated plugin state. Ending external work must not freeze the epoch while retaining permission to store. Retain the normal `run` storage path and the 3-second disposal bound. Add both causally gated cases to the real-OpenCode regression coverage, plus the corresponding hook tests. Simply removing the disposed guard in `chat.message` is insufficient when OpenCode routes that message to the new instance. Rebuild the OpenCode bundle before the candidate is reviewed again.

## Should-fix

### S1. Plausible: the new shipped-copy test misses a stored report when hook deadlines expire under load

`test/e2e/opencode.test.ts:258`, `:299`; `src/harness/opencode/turns.ts:181`.

**Proven observation:** the first focused `run`/`serve` command above missed the stored report; the focused `run` follow-up passed on the same candidate. Load was 68.90 immediately before that follow-up. **Unverified cause:** the failing attempt did not retain a bridge/store deadline trace, so load or deadline expiry cannot be asserted as its explanation. D4 deliberately permits silence on a missed deadline, which is why this single miss is not a second proven product blocker.

**Fix, one test-hardening row:** retain diagnostic timestamps for idle, Stop completion, disposal entry, store acceptance/cancellation and disposal return when this e2e assertion fails. Keep the stored-once assertion and the product deadlines. Establish whether the allowed deadline fallback caused the miss before changing any timing or behavior. Do not turn a later pass into a claim that the first attempt passed.

## Nits

None.

## What fits

- **Proven, 008-24 / wave-2 S1:** the committed bridge test now executes absent, empty and `"1"` proxy switches. It asserts exact presence/value in the bridge and descendant, no carrier metadata, and the Node proxy-startup control for `"1"`. The committed prompt test changes coverage after registration, unregisters, then verifies the refreshed primer on re-registration. These close S1.
- **Proven, 008-24:** stand-in worker exit and SIGTERM kill its spawned leader and grandchild. The SIGTERM case preserves signal termination. Source inspection of the installed Vitest fork entry finds its special SIGTERM-to-exit handler only with profiling flags; exit cleanup still kills groups there. **Plausible limitation:** another custom signal listener may see the re-raised signal twice. No changed Vitest termination failure was reproduced. SIGKILL cannot run cleanup and remains explicitly uncovered.
- **Proven, 008-25:** the focused passing shipped-copy check stores one report for `run --continue`, with the same session id, no extra registration header in the stored message and no extra model request. The normal `serve` continuation still runs once and then stays silent. `session.prompt` is selected only after `turn.stop` at disposal; the normal live-server path remains `promptAsync`. B1 concerns overlapping disposal, not the ordinary serve idle.
- **Proven by the targeted hook tests, D4:** a stalled store request is aborted within disposal's 3 seconds, and the end bridge is requested afterward. No-news disposal stores nothing. The normal successful store happens before the end request. As D3 already allows, consumer cleanup that misses its remaining deadline relies on process-liveness cleanup; the tests do not prove an unconditional immediate unregister under every host load.
- **Proven by source and the targeted tests:** `storedBySqueal` requires nonempty parts, all synthetic and all beginning `SQUEAL · `. Ordinary typed user text lacks that synthetic flag. OpenCode 1.18.35's compaction continuation text is `Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.`, not a Squeal prefix. The committed synthetic-compaction case still registers. **Unverified:** arbitrary third-party plugins deliberately creating synthetic Squeal-prefixed messages; no distinct ownership token is encoded here.
- **Proven, 008-26 / D7:** an external public-status matrix covers four causes (no setup, config only, store only, registered), main and linked worktrees, each at its root and in a nested directory, with and without a session id: 32 assertions, **1 test passed, 732 ms, exit 0**. The diagnostics name setup, installation or missing registration as appropriate; a registered session is silent. The CLI imports the existing `usesSquealAt`, and the built CLI retains that function without the unused Node-probing functions. The module has no startup probing side effect.
- **Proven, 008-26:** the committed update tests cover OpenCode alone, Claude Code alone, both, Codex and Pi. The reload sentence names only reload-capable targets present in the update. The names tested are the names `updateTargets` constructs.
- **Proven:** all rebuilt committed bundles and metadata match 0.1.186 without build drift. No shared core, runner or daemon source changes are hidden in this range.

### OpenCode source claims

The installed `node_modules/opencode-ai` identifies version 1.18.35 and ships an executable, not the original TypeScript files. I read the matching tagged source and checked the corresponding compiled control flow embedded in that executable:

- `cli/effect-cmd.ts:90-93`: the command's `finally` awaits `store.dispose(ctx)`. This does not impose a host-side 3-second cap; that bound is Squeal's.
- `plugin/index.ts:265-279`: disposal awaits each plugin's returned promise; event callbacks are invoked without awaiting them. The event unsubscribe finalizer follows the disposal finalizer. The abort probe directly observes events during disposal.
- `session/prompt.ts:1069`: message creation/storage precedes the `noReply` early return; the model loop follows it. This is why `prompt`, rather than fire-and-forget `promptAsync`, supplies storage acknowledgement.
- `effect/instance-registry.ts:11` and `effect/instance-state.ts`: disposal invokes registered disposers with `Promise.allSettled`; plugin state is a per-directory scoped cache invalidated by a disposer. Recreated plugin state is observed in the real probes, including the fresh registration on new input.

These host claims hold. The break is Squeal's cancellation ownership across those host lifecycles.

## Inputs for the repair wave

- Repair B1 before landing this candidate. Keep the original idle's ownership cancellable until its storage decision settles, even when disposal and a new plugin instance overlap.
- Order the real regression tests with barriers: Stop began, dispose entered, new input/abort observed, then Stop released. An input merely requested over HTTP is not proof that its hook preceded the report.
- Keep one disposal deadline of 3 seconds, the reserved end-consumer time, no-reply storage acknowledgement, and no continuation for aborted or superseded turns. Do not solve cancellation by dropping ordinary `run` news.
- Keep 008-24's proxy/coverage cases and signal cleanup tests, and 008-26's cause/reload wording. They need no repair from this review.
- S1 is diagnostic follow-up, not a reason to weaken the stored-once e2e assertion. The coordinator still owns its independent full run and branch CI. This file reports no independent full-suite result.

## Round 2: repair 008-28

Verdict: **PASS 2695a2ef**. **0 proven blockers**, no new should-fix or nit findings. **B1 holds and is closed at this candidate**: newer input and an abort cancel the old disposal report, including input handled by OpenCode's recreated plugin instance. Exact candidate: `2695a2efb556b9f7524602b3308380eff2bac031`, `cand/0.1.186`. Range: `ceea98c2..2695a2ef`, the three 008-28 commits and the rebuilt OpenCode plugin. Reviewed 2026-10-15. This is a narrow re-review of B1 against the 008-28 brief and this file on `origin/main`; the first-round findings above are preserved. **S1 remains outside this round and open for its separate row.**

### Verification output

All candidate checks ran at the exact SHA with a clean tracked tree. `npm run build` left every committed bundle unchanged. No product or test file was edited. The probes were external files under `/tmp/008-27-round2-7354/`; only this report was subsequently added. No independent full suite or Squeal full checkpoint was requested for this round.

```text
$ git rev-parse HEAD
2695a2efb556b9f7524602b3308380eff2bac031
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.186 lint
> biome check .
Checked 1231 files in 451ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.186 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.186 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.186 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)

$ npx vitest run test/harness/opencode-dispose.test.ts test/harness/opencode/overtaken.test.ts test/harness/opencode/run-end.test.ts test/harness/opencode/idle.test.ts test/harness/opencode/turn.test.ts --maxWorkers=1 --no-color
FAIL test/harness/opencode-dispose.test.ts > serve: an abort of the new turn, then the old Stop's answer, stores nothing
AssertionError: expected false to be true
at test/harness/opencode-dispose.test.ts:193:72
(waiting for the gated Stop's "answered" marker)
Test Files  1 failed | 4 passed (5)
     Tests  1 failed | 39 passed (40)
  Duration  61.10s
exit 1

$ npx vitest run test/harness/opencode-dispose.test.ts --testNamePattern 'an abort' --maxWorkers=1 --no-color
Test Files  1 passed (1)
     Tests  1 passed | 1 skipped (2)
  Duration  5.00s
exit 0

$ npx vitest run --config /tmp/008-27-round2-7354/vitest.config.mts --no-color
Test Files  2 passed (2)
     Tests  6 passed (6)
  Duration  12.45s
exit 0

$ npx vitest run --config /tmp/008-27-round2-7354/vitest.config.mts /tmp/008-27-round2-7354/b1.test.ts --no-color
Test Files  1 passed (1)
     Tests  2 passed (2)
  Duration  7.92s
exit 0

$ npx vitest run test/e2e/opencode.test.ts --testNamePattern 'news at the end' --maxWorkers=1 --no-color
Test Files  1 passed (1)
     Tests  2 passed | 6 skipped (8)
  Duration  21.44s
exit 0
```

The filtered e2e command runs both the stored-once `run --continue` test and the ordinary `serve` continuation test. Skips above are test-name filtering. The targeted command did fail; the later pass does not erase it. **Proven observation:** the committed abort test missed its Stop-answer barrier before reaching its stored-report assertion. **Unverified cause:** that attempt did not record the bridge's expiry or abort timing; no claim that load caused it. It is not evidence of stale storage and does not reopen B1. The independent probes below reached both required causal barriers and tested storage. No S1 diagnostic change is included in this verdict.

### B1 replay against the built candidate

**Proven by real OpenCode 1.18.35, through `squealOpenCode` and therefore `runOpenCode` only.** I independently instrumented the original B1 barrier procedure, using a temporary copy of the **committed** `plugins/opencode/dist` rather than a replacement turns implementation. The temporary Stop bridge answers once behind a file barrier; every other bridge is the candidate's. A wrapper delegates the plugin hooks, records message reads and any attempted no-reply store, and timestamps disposal. For new input it calls the real `chat.message` before releasing Stop, so the arrival is observed synchronously before the report can answer. For abort it waits for the second planned request, the successful abort request and the listeners' `MessageAbortedError`, then releases Stop. Both cases assert that the stored user messages contain the new input and contain no old report; no no-reply store was attempted.

The final instrumented run also waits for the wrapper's actual disposal-return marker before inspecting it. A preliminary timing-only attempt sampled that marker too early and failed in the external reporter with `TypeError`; this was probe instrumentation, not a candidate assertion. The corrected run above passed both cases.

Milliseconds from Stop's start in that final run:

| Event | New input | Abort |
| --- | ---: | ---: |
| disposal entered | 48 | 40 |
| new input reached the real message hook | 144 | 134 |
| abort reached the listeners | not needed | 944 |
| gated old Stop answered | 148 | 978 |
| candidate read session messages | 460 | 992 |
| message read returned | 480 | 997 |
| disposal returned | 525 | 1043 |
| old report stored | no | no |

Actual disposal durations: **477 ms** and **1,003 ms**, inside D3/D4's 3 seconds. Both cancellation cases pass without relying on deadline silence. This closes the two first-round B1 reproductions.

**Proven by source and the hook tests:** `hooks.ts:148` counts an abort before checking `disposed`; `hooks.ts:184` excludes synthetic stored reports before counting ordinary messages, and `:186` counts those messages before any await or disposed guard. The global map therefore sees the input routed to a recreated instance while the old instance is disposing. `turns.ts:272` snapshots that session's count at idle. In the stopping path, `:195` checks the session's newest message and compares the count after the read. A failed, empty, rejected or expired read is silence. The direct hook tests cover recreated-instance input, recreated-instance abort, a newer stored user message, failed reads, stalled reads and an assistant reply to the original user message.

### Arrivals, deadlines and the normal run path

**Proven by four additional external public-hook probes:**

- A second root session receives a new message and an abort while the first session is disposing. The first still stores its one report. The map is keyed by session ID, not directory, plugin instance or root consumer shared with a child.
- A fresh instance receives Squeal's synthetic stored report during the old instance's pending disposal. The arrivals count stays unchanged and the legitimate store still happens. This exercises the early `storedBySqueal` return, not an assumption about synthetic text.
- A live turn continues once through `promptAsync`; its own next message then ends silently. A subsequent ordinary user turn still stores at disposal despite the accumulated arrival count. No history read occurs on the live continuation path; one occurs for the later disposal store. Absolute count growth does not cancel a later turn because idle records a fresh snapshot.
- A history read delayed by 1,900 ms followed by a store that never acknowledges uses the remaining disposal budget, aborts the store signal and returns within the test's 3,300 ms scheduling allowance. It does not grant the store a new full timeout. The committed stalled-read test independently verifies read-signal cancellation and silence inside the disposal bound.

**Proven by source:** `turns.ts:160` bounds the new read by the existing stopping deadline; `:213` recomputes time remaining after that read for storage. `hooks.ts:291` keeps the existing 500 ms reserve for consumer cleanup inside the single 3-second disposal deadline. Read and store have abort signals. The new reads occur only on the stopping path. The live path remains `promptAsync`; storage remains `prompt({ noReply: true })`. The matching OpenCode source's `Session.messages` delegates `limit: 1` to `MessageV2.page`, which selects newest-first and reverses the returned page. Thus this reads the newest message, not the beginning of history; an assistant message whose `parentID` is the original user ID is accepted.

**Proven by the shipped-copy e2e:** normal `run` still exits, makes no extra model request, stores one report without a registration header, and `run --continue` reads it exactly once in the same session. Normal `serve` still continues once and then remains silent. Rebuilding all bundles produced no drift; the committed plugin contains the new arrivals and message-read checks.

No legitimate-store cancellation was reproduced in the requested two-session, continuation or synthetic-report cases. This is bounded evidence for those cases, not a claim about arbitrary third-party plugins impersonating Squeal.

### Inputs for landing and the next row

- B1 needs no further repair at `2695a2ef`. The coordinator retains the landing gate and branch-CI responsibility; this report is not a full-suite verdict.
- Preserve the initial targeted abort-test failure in verification history. It did not prove a product break; the focused rerun and both independent causal replays passed.
- S1 is unchanged and belongs to its separate row. This round neither implements nor accepts its diagnostics.
