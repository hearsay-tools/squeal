# Wave 13s: second review of wave 13r (001-227)

## Verification output

Candidate: `25c940f39e4514626c570e88c90cb261126ad7f4`, package 0.1.98. Executable range: `afe8d2b0..81ec9101`; HEAD adds only the coordinator's documentation commit `25c940f3`, as allowed in the brief. HEAD matched that permitted candidate. The tracked tree was clean throughout the checks and external probes, before this report. This is the second round on `wave-13r.md`, bounded to B1, B2 as amended by the human, S1, N1 and the repair delta.

Linux, Node 24.21.0. The assigned independent Vitest suite was run directly, not replaced by a Squeal checkpoint. `npm run build` was forbidden and was not run. Build reproducibility is **unverified**, not a blocker. Both committed CLI bundles contain the repair, including the lazy deadline behavior described in B2; both front-desk bundles carry `sync-forget`. Source inspection is not a rebuild.

```text
$ git rev-parse HEAD
25c940f39e4514626c570e88c90cb261126ad7f4
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.98 lint
> biome check .
Checked 749 files in 195ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.98 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run
Test Files  10 failed | 328 passed | 1 skipped (339)
     Tests  10 failed | 2429 passed | 10 skipped (2449)
    Errors  1 error
Duration 371.89s
(exit 1)

$ npx vitest run test/scheduler/claims.test.ts test/harness/waiter.test.ts test/harness/stop-retry-bound.test.ts test/watcher/linked-dirs.test.ts test/watcher/backend.test.ts test/runners/node-test/adapter-observed.test.ts test/runners/node-test/graph-cost.test.ts test/scheduler/ordering.test.ts test/scheduler/discards.test.ts test/e2e/lifecycle.test.ts --maxWorkers=1
Test Files  10 passed (10)
     Tests  53 passed | 5 skipped (58)
Duration 105.36s
(exit 0; no unhandled error)

$ npx vitest run --config <external>/vitest.config.mts --disableConsoleIntercept
# External copy of held-answers.test.ts with absolute imports into the candidate.
# Actual scheduler/adapter/handlers/SyncRequests; real invalidate held at a barrier.
# Synthetic discharge entries and Vitest Date/setTimeout/clearTimeout advanced >1 h.
{"advancedMs":3600002,"holds":32,"kept":10050,"liveRequests":32,"ended":8}
{"afterForget":true,"holds":0,"kept":10000,"liveRequests":0,"ended":40}
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration 28.17s
(exit 0; assertions reproduce B2, not assert its absence)

$ npx vitest run --config <external>/contracts.config.mts --disableConsoleIntercept
# Actual scheduler and SyncRequests, refinement completion controlled by a promise.
forgetFirst=true: result=INCOMPLETE_ANSWER, holds=0
forgetFirst=false: result=answered, holds=0
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration 26.83s
(exit 0; also checks pre-aborted signal and repeated/unknown forget)
```

The full suite was not green. Its failures were five 5 s timeouts (`claims.test.ts:108`, `waiter.test.ts:43`, `stop-retry-bound.test.ts:125`, `backend.test.ts:88`, `adapter-observed.test.ts:64`), and five assertions: a hook took 2,296 ms against 2,000 (`e2e/lifecycle.test.ts:80`); a nominally fast run produced extra 2 s timeouts (`discards.test.ts:76`); measured file durations reversed the expected order (`ordering.test.ts:111`); the first symlink-watch batch contained only `lib` (`linked-dirs.test.ts:64`); graph re-resolution took 292 ms against a 161 ms cold build (`graph-cost.test.ts:97`). The unhandled error was the timed-out waiter test's timer calling `apply` after its store closed (`waiter.test.ts:45`, `ERR_INVALID_STATE: database is not open`). All changed test files, including the actual worker-thread forget route, both cleanup overlap classes, the held-window controls and the lighter opening test, passed in this run. The key-format guard passed too.

Host load sampled 86.69 to 106.72 during the full run. A causal connection between these failures and this repair is **unverified**. All ten complete files passed in the serial rerun without changing source, assertions or timeout settings, with no unhandled error. The serial recovery cannot rewrite the independent full result. The coordinator's 2,436-pass/3-timeout gate is supplied evidence, not a substitute for this run.

The deadline probe reproduces the candidate's existing 40-request regression through its real interfaces up to the protected overflow of 10,050 entries. It replaces the test's synthetic later `note` with `vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })` and `await vi.advanceTimersByTimeAsync(HOLD_MS + 1)`. It reads `holds`, `size`, `SyncRequests.size` and completed-answer count without calling `note`, `hold` or `intact` again. All 32 retained requests still hold history and none has failed. Restoring timers and forgetting their IDs, while refinement is still blocked, releases every hold and fails every answer. The probe simulates elapsed time and discharge volume; it does not claim an actual hour-long stall or a naturally observed 10,050-file edit. The timer simulation gives any registered expiry timer a chance to execute; source inspection confirms there is none.

The race probe uses the actual initialized scheduler and its actual discharge ledger, with only `refined()` replaced by a controlled promise. Resolve refinement and forget in the same synchronous turn: abort wins before the scheduler reads membership and the answer fails. Resolve and await normal completion first, then forget: the complete answer remains complete and release is harmless. Both end with zero holds and zero live requests. A signal aborted before entry takes no hold. There is no new await between intact checking and membership reading.

## Verdict

**FAIL 25c940f3: 1 proven blocker, 0 should-fix, 0 nits.** Prior B1, S1 and N1 are closed. Prior B2 is partially closed: eviction is connected to the actual request ID, forgetting releases the hold while refinement stalls, and detected incompleteness fails safely. Its required one-hour backstop is still lazy and can be exceeded indefinitely. The blocker was sent to the parent for the human's decision.

## Blockers

### B2. A stalled answer's hold still outlives its one-hour deadline unless another discharge operation runs

**Proven by the actual-scheduler probe and source inspection.** `src/core/scheduler/discharges.ts:130` records `until = now + HOLD_MS`, but `#expire` at line 174 is called only from `note`, `hold` and `intact`. `src/core/scheduler/scheduler.ts:350` awaits only refinement or the request's abort, with no expiry timer. It cannot reach `intact` at line 351 until refinement resolves. Ordinary `sync-status` polls read the handler's saved state and invoke no expiry. No periodic daemon path calls discharge expiry.

The human's bounded B2 contract, now in D7 (`spec.md:139`), says that "each hold lasts an hour at most, read or not, as a backstop", including while the runner part is stalled. Row 001-226 and its board done-when require none past the deadline. This is a remaining break of that same blocker, not a request for the full CLI cancellation or admission-refusal design the human declined.

Concrete sequence:

1. Hold a real revision's adapter invalidation before refinement completes.
2. Start 40 sync requests with `resolvedSince`; the actual 32-entry handler map forgets eight. Their holds correctly release and their answers fail.
3. While the other 32 answers remain pending, record 10,050 synthetic discharges in their captured revision window. The cap is correctly suspended for those answers.
4. Advance the clock and timers by more than one hour, with no new `note`, `hold` or membership read. There are still 32 active holds, 10,050 retained entries and 32 live requests. Only the original eight answers have ended.
5. Forget the retained IDs without releasing refinement. All holds immediately release, every answer fails and retained count falls to 10,000.

Thus the request-map link works, but the backstop does not. A CLI that stopped polling is intentionally not cancelled in this design; without enough later requests to evict it, its stalled answer can keep protected history past the very budget intended to bound that case. More `sync-status` polling does not help. A live wait sees pending until its own timeout, not the promised incomplete answer at the hold deadline.

The new tests hide this case: `test/scheduler/held-answers.test.ts:150` supplies a later `note`, and `test/scheduler/discharges.test.ts` likewise tests expiry by recording another discharge. Both trigger `#expire` themselves. They prove rejection *after detected expiry*, not release at the deadline independently of runner progress.

One worker's fix: enforce the hold deadline with an independent timer or bounded periodic sweep that runs while refinement is blocked, and reject the pending answer as `INCOMPLETE_ANSWER` when that expiry wins. Use `HOLD_MS` consistently, make expiry/forget/normal completion idempotent, and clear timers/listeners on every end path. Prune using the expiry time, not only `#latest`'s possibly hour-old discharge time, so age-only excess is released too. Keep the socket and CLI unchanged. Own `src/core/scheduler/discharges.ts`, the held-answer path in `scheduler.ts`, `sync-requests.ts` only if needed for timer ownership, and their tests. The coordinator handles any unreleased version-2 re-pin and bundle rebuild.

Required regression: stall the real refinement, cover entries exceeding both age and count bounds, advance timers to the one-hour deadline without another discharge/hold/read operation, and assert zero expired holds, pruned unprotected history and an incomplete error on each retained request. Keep a younger hold's membership intact. Race expiry against normal answer and forget in both orders; verify no double release or unhandled rejection. Preserve the existing 40-request eviction test and normal overflow/hour membership controls.

## Should-fix

None.

## Nits

None. Prior N1's documentation work is present; its stated deadline is the implementation failure in B2, not another documentation task.

## What fits and answers to the brief

| Question | Finding and evidence |
| --- | --- |
| Prior B1: can cleanup still name only the wrong last tier? | Closed for the reported case. `afterEachRun` accumulates run IDs across the shared interval. `Found.own` distinguishes the lane-marked carrier from the bare-marker/group-orphan class; attribution is attached per stopped process. Shared leftovers say `one of runs long-run, short-run`, while a lane carrier names its own run. The new real bare-child and orphan overlap regressions use disjoint file lists and exercise the actual wrapper/sweeper. The existing run-record test still connects a real run ID to its files. Process identity checks remain in `terminate`. |
| Prior B2: does eviction release the actual request's hold? | Yes. The handler's ID is passed through `requestSync`, `FromDesk.sync`, `SyncRequests.run` and the scheduler's abort signal. The dropped ID is sent by `sync-forget` on the internal thread channel. Same-direction messages are delivered in order, so a request is registered before its forget. The scheduler's abort listener releases immediately before rejecting, independent of refinement. The new front-desk tests cover both worker and in-thread routes; the real-scheduler 40-request probe confirms only the eight evicted answers end before the control forget. |
| Can a hold outlive its request? | Not after the eviction message is handled or normal answer construction finishes. Caller stop/timeout still does not send cancellation, as explicitly chosen by the human; those requests depend on eviction or the one-hour backstop. The latter remains broken: B2. No stricter prompt-cancellation requirement is imposed here. |
| Can a hold outlive its deadline? | Yes, proven by the no-operation simulated-hour probe: B2. Once `note`, another hold or a completed refinement triggers expiry, `intact` rejects the old answer. That correctness does not establish timely release. |
| Can an incomplete answer read as quiet? | It does not become a successful truncated edit-window answer. Detected expiry, forget and a window whose prior history was pruned reject with `INCOMPLETE_ANSWER`; the handler leaves revision null and records the error. `status-sync.ts` maps that to `unsupported`, so no edit window is installed. The unchanged fallback in `status-wait.ts` can say general quiet only when nothing is pending at all after settlement, and can return on any check's news. That general quiet is the fallback explicitly allowed by the amended D7, not the lost-membership bug. With stalled refinement still pending, it cannot say quiet. |
| Is forget versus normal answer safe? | Yes for both tested orders. Pre-abort is checked before taking a hold. Synchronous abort ends the hold and rejects the race; intact check and membership read have no intervening await. Once membership is complete, a later forget is harmless. `HeldAnswer` deletes its hold once, the scheduler removes its listener in `finally`, and `SyncRequests` removes only the matching controller. Unknown and repeated IDs do nothing. |
| Prior S1: deterministic default and bounded child cost? | Closed. The 500 ms held-write-lock case is unchanged as the correctness discriminator. The smoke test now opens two stores and reopens them in four rounds with eight children, blocking on readline/stdin rather than spinning. Each rendezvous/report has a 20 s deadline; its `finally` kills every child and awaits their completion. The lock-holder control also kills and awaits its child. No assertion depends on the smoke statistically reproducing the WAL race. |
| Prior N1: accepted D7/D12 and dated amendments? | Closed. D7 describes held windows, internal eviction, one-hour bound, incomplete fallback and idempotent forget. D12 describes parent, age, escalation and per-process lane/shared attribution. `status.md` records 001-212, 001-214 and the final 001-226 contract. No board or status file was edited by this review. |
| Added `sync-requests.ts` outside the worker's grant? | Inspected. The small internal registry gives the production daemon ownership by socket request ID and introduces no dependency/schema/socket change. Its abort and identity-guarded cleanup work in the actual seam and race probes. It does not independently enforce a deadline; B2 remains in the hold path. Its extra ownership should be acknowledged by the coordinator. |
| Optional scheduler signal outside the grant? | Inspected. It is a backward-compatible final optional argument. The production call order is `after, captured revision, resolvedSince, signal`; existing three-argument callers keep working. Its interface comment documents abort and the intended deadline, and the early-abort/normal/forget paths are exercised. No key acceptance or stored-result meaning change was found beyond the already guarded source change. |
| Optional `prepareFrontDesk` worker parameter outside the grant? | Inspected. Default/null retains prior script discovery and source fallback. The test-only override loads the actual TypeScript worker with explicit Node loader arguments, allowing the cross-thread forget route to be exercised. Production still calls it without an argument; no runtime caller selects a custom script. It uses the same startup/error/discard handling as the production worker. No behavioral defect found; coordinator acknowledgment of this ownership expansion is still appropriate. |
| Version 2 re-pinned in place and shipped paths? | The constant remains 2; the shipped version-1 hash is unchanged. Re-pinning 2 follows the explicit unreleased-version instruction. Both plugin versions are 0.1.98 and both bundles contain the repair paths. The key-format guard passed in the independent full suite. Build drift was not checked because the build was forbidden. |

## Inputs for the next wave

Route B2 to the human. This is the second round; do not automatically start a third review or widen the accepted design. If the human chooses repair, the worker needs an independently enforced expiry and the no-operation timer regression above, not another map cap or CLI/socket protocol. Retain the `sync-forget` link and the distinction between incomplete fallback and complete edit-window membership. B1's process attribution, S1's lighter smoke and N1's amendments need no further repair from this review. The coordinator should acknowledge the added internal registry and the two interface additions when integrating the repair.

## Background status before the report

The six background baseline failures (daemon start, Codex bundle parsing, liveness, pre-tool-use, node-test package rerun, graph-cost timing) all recovered under unchanged candidate inputs. This is separate evidence from the independent run and its serial recovery.

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.94/dist/cli/squeal.mjs status
Revision: 0
Known failures: 0
Affected checks: 2778 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 0
Worktree: candidate HEAD 25c940f, dirty state not known: no revision recorded yet
Daemon: running, last heartbeat 4 s ago
(exit 0)
```

The daemon retained its earlier startup note about dependencies not yet installed and no initial revision record; the observed completed baseline counts above followed `npm ci`. No additional checkpoint was requested for this documentation-only report. All external probes were removed before committing; only this review file is committed. No product source, test, board, spec, bundle or status file was edited.
