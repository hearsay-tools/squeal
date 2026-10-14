# 009 wave 1 review

Candidate: `502eb7f1..7ac131dfa34fd26df129479daa6f633cb00efb65`. Row: 009-17.
Reviewed against spec 009 D3, D4, D7 and D9, D1 as amended in `status.md` on 2026-10-14, spec 005 D3 and the wave-1 done-when clauses. Wave-0 findings were read first. Idle wake and the fixture repairs are wave 2, not missing wave-1 work.

## Verdict

FAIL `7ac131df`: 1 proven blocker, 0 should-fix notes, 0 nits. Streaming input clears the continuation guard inside an existing run, allowing Squeal to continue it twice. The failure is reproduced with real Pi 1.0.4 over RPC through `runPi` and the candidate's committed extension bundle.

## Verification output

**Proven provenance mismatch, resolved for verification:** the dispatched checkout is `029e1d24c32b6ca86989511166efa38ab047e019`, two documentation commits after the candidate. The task explicitly authorizes building in a detached candidate worktree. All verification and probes below use `/tmp/review-009-w1` at `7ac131df`, Node 24.21.0. Only this review file is committed on the dispatched branch.

```text
$ git worktree add --detach /tmp/review-009-w1 7ac131df
HEAD is now at 7ac131df
$ git rev-parse HEAD
7ac131dfa34fd26df129479daa6f633cb00efb65
$ npm ci
added 174 packages, and audited 175 packages in 5s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 1123 files in 1288ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git status --short
(no output)
```

`npm ci` also reports four dependency install scripts not covered by `allowScripts`. The independent reviewer gate uses Vitest directly, not Squeal's checkpoint. Concurrency is capped at two workers on this shared host. The full suite passes. The temporary negative probe below exposes B1 despite that green suite. The candidate remains clean after all checks; the three-plugin drift command still exits 0.

```text
$ npx vitest run --maxWorkers=2
Test Files 530 passed | 1 skipped (531)
Tests 4465 passed | 10 skipped (4475)
Duration 1557.04s
(exit 0)
```

The temporary probes live in an ignored scratch directory, outside the candidate's source and normal test discovery. They use the committed Pi extension and `test/helpers/pi.ts`; no direct Pi invocation, credentials or access to the user's `~/.pi`. They are removed before the candidate worktree is retired.

```text
$ npx vitest run --config node_modules/.review009/config.mjs --maxWorkers=1 --reporter=verbose
real Pi delivers recovery in the next request and keeps repeats silent: PASS
a mid-continuation input does not permit a second Squeal continuation: FAIL
  expected requests to have a length of 3 but got 4
Test Files 1 failed (1)
Tests 1 failed | 1 passed (2)
Duration 2.24s
$ npx vitest run --config node_modules/.review009/config.mjs --maxWorkers=1 --reporter=verbose -t mid-continuation
STEER requests 4; cumulative policy reports [0, 1, 1, 2]
Test Files 1 failed (1)
Tests 1 failed | 1 skipped (2)
Duration 1.31s
```

**Unverified limits:** no independent Node 22 run, interactive TUI run, public release-archive download or installed-package end-to-end proof. The local installer tests use stub harnesses, as the brief requires. The native SQLite stall and fixture-isolation follow-ups remain the separately assigned wave-2 rows, 009-15 and 009-16.

## Blockers

### B1. Steering input reopens the continuation guard within the same run (proven)

`src/harness/pi/extension.ts:131` calls `startRun()` on every `input`, clearing `continued` at line 113. Pi also emits `input` for a prompt queued while the agent is streaming, with `streamingBehavior: "steer"` or `"followUp"`. That input does not fire `before_agent_start` or end the current run. At the next `agent_before_settle`, line 177 therefore permits a second Squeal continuation.

This breaks goal 4: “Squeal never continues a run twice,” and 009-12's one-continuation guard. D3 and the wave-1 amendment name input as a reset boundary; the real event trace proves why an input submitted during streaming must be distinguished from the start of a new run. No amendment permits two Squeal continuations before one `agent_settled`.

Reproduction against the committed bundle:

1. Create a `squealRepo()` fixture with one known failure and `stop.blockOnKnownFailures: true`. Use `piWorld(r)` for the isolated daemon stand-in.
2. Call `runPi` in RPC mode, `cwd: r.root`, one prompt, with the candidate's `plugins/pi/dist/extension.mjs` and the following additional extension. Its message exercises Pi's normal steering-input path without a second RPC client or direct Pi spawn:

   ```js
   export default function (pi) {
     let requests = 0;
     pi.on("context", () => {
       if (++requests === 2) {
         pi.sendUserMessage("steered input", { deliverAs: "steer" });
       }
     });
   }
   ```

3. Script the fake provider with `[{ text: "initial" }, { text: "continued", delayMs: 100 }, { text: "steered" }, { text: "extra" }]`. The unchanged known failure causes the first policy continuation. The extra extension queues input during that continuation.
4. Expect three requests: the initial response, Squeal's single policy continuation, and the queued steering response. The candidate makes four. The fourth request ends with a second identical `Squeal policy stop.blockOnKnownFailures ...` report.

The independent lifecycle trace is:

```text
input
before_agent_start
agent_before_settle
input { streamingBehavior: "steer" }
agent_before_settle
agent_before_settle
agent_settled
```

There is one `before_agent_start` and one `agent_settled`, so the second policy report belongs to the same run. The two identical reports are observed in the fake provider's requests, not inferred from mocked event shapes. Pi exits normally. The second probe adds only lifecycle logging and reproduces the same four requests.

Small fix for one Pi-events worker: reset the continuation guard at an actual new-run boundary, retaining it across input queued during streaming. `before_agent_start` already resets it and covers runs without input. Keep the input handler available for wave 2's waiter cancellation, without letting that cancellation reopen this guard. Add a recorded-event regression and the real RPC reproduction, for steering and follow-up input; assert one Squeal continuation per run and that a subsequent genuinely new run may continue once again. No core interface change is needed.

## Should-fix

None beyond the blocker. The previously assigned wave-0 notes are not new findings against this range.

## Nits

None.

## What fits

- **D3 delivery and deny:** the extension asks once per `turn_end` batch and not for a text-only final turn. The real fixture asserts next-request `PASS -> FAIL` delivery over three parallel results, and block then re-issue without repeating the regression. The independent recovery probe adds failing, passing and unchanged-passing results at three gated tool calls: `FAIL -> PASS` appears in the next request exactly once and the unchanged pass adds no report. These claims do not establish B1's guard.
- **D3 primer and lifecycle:** the primer is a capped system-prompt section, with the absolute Node and CLI command; it is retained when a later worker call gives no primer. The real RPC compaction test checks the section after compaction. Shutdown nulls the host before awaiting unregister; `ask` suppresses an answer after shutdown. An aborted or error settle does not call Stop; `agent_settled` ends its turn. Those abort assertions use recorded events, not an independent real RPC abort experiment.
- **D4 bounds and seams:** the shared delivery, denial and Stop calls stay on the worker. Ordinary event calls and `agent_settled` use 2,000 ms, settle uses the accepted fixed 2,000 ms, and shutdown uses 3,000 ms. Null answers produce no report, block or continuation. The extended protocol's request/answer kinds and handler argument order match. The worker disables `ExperimentalWarning`, and its error and exit listeners preserve silence. The native-stall bound has the previously documented wave-0 limitation.
- **D1 install and 005 D3:** the source archive is tied to `SQUEAL_VERSION`; its Pi manifest version is checked before moving the package into place. New directories are recorded before `pi install`, so a failed install can be retried without downloading again. Updates install first, then remove recorded older directories. Uninstall iterates recorded directories and preserves them when Pi is absent. The ordinary preservation and idempotency paths, Pi alone and all three harnesses, have stub tests. The completion argument remains the final line, so an incomplete script prefix cannot call an installation step.
- **Launcher format 2 and D7:** all three executable launcher copies match. Runtime discovery filters Pi directories lacking a CLI, compares numeric versions across the three harnesses and explains mixed versions, including the separate Pi update path. The status line states the observed absence of a consumer rather than claiming the extension never loaded; it covers no-store and unregistered cases, stays absent for a registered consumer and from JSON output, and names the local Pi package or installer command. Build verification reproduces all three committed dist trees. The key-format re-pin and new CLI rendering seam are consistent with the existing unreleased version-10 convention.

## Inputs for wave 2 and the fix

1. Repair B1 in the Pi event handler and its tests. Preserve the guard across `input` with streaming behavior; clear it once for a new run. The idle-wake worker also owns this input handler, so coordinate that edit with 009-15.
2. Keep worker requests typed by kind and current `{ sessionId, cwd }`, with the existing deadlines. Missing/failed worker answers remain silent. The idle wake should be a cancelled, unreferenced wait rather than a long pending deadline call.
3. Keep the accepted shared Stop behavior while adding the `"pi"` harness type in 009-15. Cancellation at input and shutdown must not create a second continuation of an already active run.
4. Preserve 009-16's isolation repair and 009-15's native-blocked exit proof. This review does not settle those already assigned notes or final real-model/TUI dogfooding.
