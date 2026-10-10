# Wave 13t: third review of wave 13r (001-230)

## Verification output

Requested candidate: `d3cbd205`, package 0.1.99. Range: `d9d268d9..d3cbd205`, bounded to `wave-13s.md` B2 and repair 001-229. HEAD is `a5a1415814fe9c4e9f7914bc929da71efb26adcb`, a mismatch with the requested candidate. `git diff d3cbd205..HEAD --name-only` lists only `docs/board.md`: the coordinator's task-status update. There is no executable, test, configuration or dependency delta. The checks below ran at that HEAD with a clean tracked tree, before this report. They verify executable-equivalent inputs; an exact-HEAD gate at `d3cbd205` is **unverified**. This report does not review the identity fix, process changes or spec 005 research in the range.

Linux, Node 24.21.0. The independent full Vitest suite ran directly as required for reviewers. It was not replaced by the coordinator's supplied gate or Squeal's background results. `npm run build` was forbidden and was not run. Build reproducibility is **unverified**, not a blocker. Inspection confirms both committed CLI bundles carry the new expiry timer and scheduler rejection path; that is not a rebuild.

```text
$ git rev-parse HEAD
a5a1415814fe9c4e9f7914bc929da71efb26adcb
$ git status --short
(no output)
$ git diff d3cbd205..HEAD --name-only
docs/board.md

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.99 lint
> biome check .
Checked 751 files in 394ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.99 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run
Test Files  5 failed | 334 passed | 1 skipped (340)
     Tests  5 failed | 2438 passed | 10 skipped (2453)
Duration 321.61s
(exit 1; no unhandled error)

$ npx vitest run test/watcher/linked-dirs.test.ts test/harness/user-prompt-submit.test.ts test/harness/codex/review.test.ts test/e2e/lifecycle.test.ts test/e2e/transitions.test.ts --maxWorkers=1
Test Files  5 passed (5)
     Tests  32 passed (32)
Duration 47.88s
(exit 0; no unhandled error)

$ npx vitest run --config <external>/vitest.config.mjs
# Actual initialized scheduler; refinement controlled by promises.
# Expiry, forget, normal completion and refinement rejection each remove
# the abort listener and leave zero holds and zero timers. A refinement
# rejection after expiry/forget is consumed; later abort/expiry is harmless.
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration 8.00s
(exit 0; no unhandled error)

$ node --import tsx --input-type=module <no-operation deadline probe>
# Unmodified predecessor Discharges from d9d268d9 and candidate Discharges.
# Three protected entries, cap 1, entries older than the hour at expiry.
# Only setTimeout delays scaled: one real millisecond represents one minute.
# No discharge, hold or membership read after taking the holds.
[{"name":"before","holds":1,"kept":3,"expired":0},{"name":"candidate","holds":0,"kept":0,"expired":1}]
(exit 0; predecessor reproduces B2, candidate ends the hold and prunes by age)

$ node --import tsx --input-type=module <process-exit probe>
{"holds":1,"message":"returning with an outstanding hour hold; only its timer remains"}
(exit 0 in 0.106s, without releasing the hold or waiting an hour)

$ node --import tsx --input-type=module <delayed-callback probe>
# Unmodified candidate Discharges, real Node timer dispatch and busy loop.
# Scale delays and elapsed epoch times equally: 1 real ms = 1 logical minute.
{"minute":132,"youngDeadlineMinute":91,"holds":1,"expired":[{"name":"old","minute":132}]}
{"afterRearm":true,"holds":0,"expired":[{"name":"old","minute":132},{"name":"young","minute":165}]}
(exit 0; reproduces advisory S1 below, not the original async-stall regression)
```

The full suite was not green. Two tests exceeded their 5 s timeout (`harness/user-prompt-submit.test.ts:25`, `harness/codex/review.test.ts:66`). A symlink watch did not meet its condition within 3 s (`watcher/linked-dirs.test.ts:94`). Two hooks exceeded their 2 s budget: 6,016.85 ms (`e2e/lifecycle.test.ts:80`) and 2,494.01 ms (`e2e/transitions.test.ts:46`). There were no unhandled errors. All changed test files, the 40-request eviction regression, the no-operation stalled-refinement regression, race controls and key-format guard passed in this full run.

Host one-minute load sampled 12.49 to 95.86 during the full run and 5.22 after the serial rerun. A causal link between these five failures and the B2 repair is **unverified**. All five complete files passed serially under unchanged inputs, assertions and timeouts. This does not change the independent full result. The coordinator's supplied 2,440-pass/3-timeout gate and green CI at `f8addfaa` are context, not this review's evidence.

The external end-path probe used the actual initialized scheduler and its actual discharge ledger. Only `refined()` was replaced by a controlled promise; Vitest's Date and timeout clock simulated the hour. `getEventListeners(signal, "abort")` checks listener removal, and `vi.getTimerCount()` checks timer cleanup. It also rejects the losing refinement promise after expiry or forget and lets the event loop run, covering a failure after the answer has already failed. The no-operation red/green and delayed-callback probes exercise the discharge API with synthetic entries and scaled timers, not an actual hour-long daemon run. All probes were outside the tracked tree and removed before committing.

## Verdict

**PASS d3cbd205: 0 blockers, 1 proven should-fix note, 0 nits.** The prior B2 reproduction is closed: refinement may remain suspended, no other discharge operation is required, expiry ends the hold and fails the answer, and history protected only by that hold is pruned using the deadline. The new delayed-callback behavior in S1 is an advisory note under the bounded re-review, not another round on unrelated settled findings. The independent full-suite result is reported above without converting a serial recovery into a green full run.

## Blockers

None in this B2 re-review. No automatic further repair or review is requested.

## Should-fix

### S1. A late expiry callback postpones a younger hold instead of catching up to the current time

**Proven by the scaled real-timer probe and source inspection.** `src/core/scheduler/discharges.ts:215` passes the timer's scheduled timestamp `at` to `#see`, `#expire` and the subsequent `#arm`, rather than the time when the callback actually runs. For an asynchronous refinement stall with a responsive event loop, this correctly closes B2. After an event-loop or process pause, it adds avoidable delay beyond the pause.

Concrete sequence: take an old hold at minute 0, a younger one near minute 31, and pause callback dispatch from minute 50 through minute 132. At resumption, both deadlines (60 and 91) have passed. The first callback sweeps only through minute 60, releases the old hold, and schedules the younger hold roughly 31 minutes *from resumption*. With no further discharge/hold/read, the younger hold and its pending answer stay live until minute 165. Unprotected age-only history is likewise pruned using the older scheduled time. The probe scales both epoch elapsed time and timer delay by 60,000 and uses an actual synchronous busy loop; it does not claim a naturally observed hour-long pause. Source inspection establishes the same arithmetic for unscaled delays.

This is a new runtime-pause case in the timer delta, filed as a note according to the re-review scope. No JavaScript timer can act during a pause; the concern is the additional postponement after it can run again. A normal answer that resumes after its deadline still fails safely through `intact(now())`; this note demonstrates excess retention/pending time, not an incomplete answer being accepted as quiet.

One worker's fix: give the discharge timer access to the same clock as its hold timestamps, sweep and prune at the actual callback time, and re-arm relative to that time. Keep the timer unref'd and the existing idempotent end paths. Own `discharges.ts`, its construction/clock seam only if needed, and tests under `test/scheduler/`. A regression should delay the first callback until both staggered holds are overdue, then run that callback and assert both are released and both pending answers fail immediately, with no second relative delay. Preserve the existing exact-deadline/younger-live control and red/green no-operation case. The coordinator handles any unreleased key-format re-pin and bundle rebuild.

## Nits

None.

## What fits and answers to the brief

| Question | Evidence and judgment |
| --- | --- |
| Does a hold now end at its deadline while refinement stalls? | Yes for prior B2's asynchronous stall. `Discharges.hold` arms one earliest-deadline timer (`discharges.ts:155`, `:207`); its callback releases expired holds without a subsequent operation. `#see(at)` advances pruning time before `#end` prunes, so age-only history no longer relies on the last discharge. The full-suite `held-deadline.test.ts` regression uses the actual stalled adapter, scheduler, handlers and SyncRequests; three old requests fail while the younger request retains its own news and later answers normally. The independent discharge probe is red on the predecessor and green on this candidate. Runtime-pause catch-up is S1. |
| Can expiry, forget and a normal answer double-release? | The actual release is guarded by `#held.delete(hold)` (`discharges.ts:188`). Expiry removes the hold before invoking its callback; the callback's `forget` and the scheduler's `finally` therefore do nothing further. Repeated aborts and unknown/settled request IDs remain harmless. The committed race test covers expiry/forget and expiry/normal completion in both orders, including refinement resolve and expiry in one synchronous turn; overdue membership cannot be read successfully because `intact(now())` precedes `rekeyedSince` with no intervening await. |
| Can a losing rejection go unhandled? | No defect found in the reviewed paths. `Promise.race([this.refined(), ending])` attaches handlers to both participants (`scheduler.ts:351`), including a refinement failure after expiry has already won. `finally` removes the abort listener and releases the hold on success and rejection. The external end-path probe verifies all four outcomes and late rejection without an unhandled error. SyncRequests still removes only its matching controller; both the in-thread handler and worker-thread desk register rejection handlers that preserve the incomplete error. |
| Does any new timer keep a daemon alive? | No. The only new timer calls `handle.unref?.()` (`discharges.ts:219`). A fresh real Node process with one active hold exits in 0.106 s. Normal completion, forget and final expiry clear the timer; the external cleanup probe verifies zero timers after each end path. When other holds remain, the shared timer stays available for them; an earlier wake for a removed oldest hold cannot re-notify that removed hold. |
| Are eviction and normal retention controls preserved? | The 40-request regression remains routed through the real handlers and SyncRequests and passed in the full run. The discharge count/hour controls also passed. The refactor to `held-socket.ts` retains the actual adapter stall and handler route; it does not substitute a fake scheduler. |
| Can expired membership read as quiet? | Expiry invokes the scheduler's `end` and rejects with `INCOMPLETE_ANSWER` before runner refinement returns. The handler records an error with revision null, so the unchanged CLI takes its existing unsupported-sync fallback. No socket or CLI changes occur in this repair. The settled fallback semantics from wave 13s are not re-prosecuted. |
| Key-format and shipped paths? | Version remains 2; the released version-1 hash is unchanged. The version-2 re-pin follows the explicit unreleased-version instruction. Both plugins are version 0.1.99 and their committed CLI bundles contain the timer and rejection paths. The key-format guard passed in the full suite. Build drift remains unverified because building was forbidden. |

## Inputs for the next wave

No remaining B2 blocker from the prior reproduction. Keep `requestSync`'s argument order (`after, resolvedSince, requestId`) and the scheduler order (`after, captured revision, resolvedSince, signal`); capture and taking the hold still have no intervening await. Preserve the 32-request eviction link, incomplete-answer fallback, shared unref'd timer, and synchronous intact check plus membership read. S1 can be dispatched as a small clock/catch-up follow-up if accepted; it needs no CLI cancellation, admission refusal or socket change. B1, S1 and N1 from wave 13r were already settled by wave 13s and were outside this task. The review changes only this report; no board, spec, status, source, tests or bundles are edited.

## Background status before the report

Squeal separately reported two baseline 5 s harness timeouts (`turn.test.ts:188`, `waiter.test.ts:90`, load 88.18) and then their recovery under unchanged inputs. Both FAIL messages were read. The independent full run did not fail those files. This background evidence does not replace either direct Vitest command above.

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.94/dist/cli/squeal.mjs status
Revision: 0
Known failures: 0
Affected checks: 2783 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 0
Worktree: HEAD a5a1415, dirty state not known: no revision recorded yet
Daemon: running, last heartbeat 4 s ago
(exit 0)
```

The daemon's status retained its pre-install startup note and its note that no initial revision record existed. The completed baseline counts above followed `npm ci`. No further checkpoint was requested for the documentation-only report.
