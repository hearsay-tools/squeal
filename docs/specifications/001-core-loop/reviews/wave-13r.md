# Wave 13r: store opening, test fixes, cleanup provenance and discharge retention (001-215)

## Verification output

Candidate: `b4931389a12b9e18b1dc5ee2c6906afe68491f11`, package 0.1.97. Assigned range: `b2750ece..b4931389a12b9e18b1dc5ee2c6906afe68491f11`. HEAD matched and the tracked tree was clean throughout the checks and probes, before this report. Reviewed rows: 001-207, 001-208/209, 001-212 and 001-214. Documentation about later rows is not executable work delivered by this wave.

Linux, Node 24.21.0 for the independent full suite and discriminating probes. Node 22.23.3 for the focused compatibility checks and scratch repetitions. The human forbade `npm run build`; build reproducibility is **unverified**, not a blocker. Tests that normally compile private fixture CLIs still ran. Both committed CLI bundles contain the WAL retry, held-window logic, `rekeyedOnceRefined` daemon call and the new cleanup formatter. This source inspection does not substitute for rebuilding.

```text
$ git rev-parse HEAD
b4931389a12b9e18b1dc5ee2c6906afe68491f11
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.97 lint
> biome check .
Checked 743 files in 293ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.97 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run
Test Files  3 failed | 334 passed | 1 skipped (338)
     Tests  3 failed | 2426 passed | 10 skipped (2439)
    Errors  1 error
Duration 323.07s
(exit 1)

$ npx vitest run test/cli/codex.test.ts test/cli/status-wait-window.test.ts test/harness/forks.test.ts --maxWorkers=1
Test Files  3 passed (3)
     Tests  29 passed (29)
Duration 5.00s
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run test/daemon/escaped-identity.test.ts test/scheduler/discharges.test.ts test/keys/key-format.test.ts test/store/open.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  61 passed (61)
Duration 3.99s
(exit 0)

$ npx vitest run --config <external>/vitest.config.mts --disableConsoleIntercept
# Actual Discharges instance, actual Scheduler.rekeyedOnceRefined and createHandlers;
# real adapter invalidation held at a barrier; synthetic discharge entries/timestamps.
first sync-status: ok=false, error="unknown request id <id>"
active holds=40, retained=10051, cap=10000, captured revision=1
after refinement: active holds=0, retained=1
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration 3.25s
(exit 0; assertions reproduce B2, not assert its absence)

$ node --import ./node_modules/tsx/dist/loader.mjs <external>/overlap.mts
short-ended: notes=[]
long-ended: "stopped 1 process a test left running after its tier (run long-run): <pid> ... (parent <ppid> ..., 0.4 s old, SIGTERM)"
runFiles: short-run=[test/short.test.ts], long-run=[test/long.test.ts]
(exit 0; the stopped child was spawned by short-run, B1)

$ node --disable-warning=ExperimentalWarning --import ./node_modules/tsx/dist/loader.mjs <external>/wal.mts
without retry: database is locked, errcode=5, elapsed=0 ms
candidate: elapsed=608 ms, journalMode=wal, synchronous=1, busyTimeoutMs=5000
existing WAL with writer: elapsed=1 ms, kept=yes
daemon timeouts: starting=120000, ready=5000
(exit 0; only the external copy has the retry removed)
```

The full suite's three failures were 5,000 ms timeouts in `test/cli/codex.test.ts:103`, `test/cli/status-wait-window.test.ts:122` and `test/harness/forks.test.ts:107`. The unhandled error was a timer from the timed-out status-window test calling its fixture's `finish` after teardown closed the store: `ERR_INVALID_STATE: database is not open`, `Connection.transaction` through `test/cli/status-wait-fixture.ts:78` and `status-wait-window.test.ts:125`. All three complete files pass in the focused rerun without source or timeout changes, including no unhandled error. Host load reached 96.15 during the full suite. A causal connection between these timeouts and this wave, or specifically its opening stress test, is **unverified**. The independent full run was not green; the targeted recovery does not rewrite that result. Every changed test file passed in that run.

The background Squeal baseline separately reported timeouts in claims-restart and Codex bundles and a lifecycle latency assertion. All three recovered under the same inputs, and Squeal reported its baseline checkpoint complete at revision 0. That is separate evidence, not this reviewer's independent gate.

The scratch scope used an external copy of the candidate test with only its first test registered twenty times via `it.each`, absolute imports back to the candidate helpers, the same assertions, and the normal global setup/teardown. It added no CPU burners: it ran beside existing host work (load samples 17.69 before, 11.94 during). This independently repeats the cwd/removal behavior; the worker's separate claim of twenty passes beside 24 `yes` loops remains unverified. The external test completed at 12:17:47; this report was first written at 12:19:21, so all checks finished on the pristine candidate.

```text
$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run --config <external>/scratch.config.mts -t 'started from inside the root' --reporter=verbose
Test Files  1 passed (1)
     Tests  20 passed | 8 skipped (28)
Duration 109.76s
(exit 0)
```

Final background status is recorded below. All temporary probes were removed before the report commit; no product source, board, bundle or test was edited. Only this report is committed.

## Verdict

**FAIL b4931389: 2 proven blockers, 1 should-fix, 1 nit.** The WAL repair and the two test fixes hold. Normal cleanup notes have the requested facts, and normal captured sync answers retain their discharge membership. Two boundaries fail the wave's promises: a cleanup note can send the reader to another tier's test files, and abandoned sync answers can keep retention exemptions indefinitely. Blockers were sent to the parent for the human's decision, as instructed.

## Blockers

### B1. A deferred leftover is attributed to the last overlapping run, which need not have started it

**Proven by a real process probe.** `src/core/daemon/escaped.ts:102` puts one `runId` on the whole stop. `afterEachRun` at line 281 passes only the run just ending, although `alone` at line 280 deliberately reaches back to the first overlapping run for bare-marker carriers and unmarked group orphans.

001-212 is titled “a stopped-process note says enough to find the test that left it.” Its done-when requires that “the run ID leads to its test file.” A last-finishing tier's run ID alone does not establish that relationship for these supported cleanup classes.

Reproduction on the actual `afterEachRun` and `EscapedChildren`, with two fake runner lanes and one real detached child:

1. Start `long-run`, whose file list is only `test/long.test.ts`, and hold its runner promise.
2. Run `short-run`, whose file list is only `test/short.test.ts`. It spawns a child with `children.env`, the documented daemon-wide bare marker, and settles.
3. Its child is correctly left running while the other lane is in flight. No note is emitted.
4. Release `long-run`. The child is correctly stopped, but its note says `(run long-run)`. Looking up that run lists only the unrelated long test; the test that spawned the child is absent.

This is a provenance failure introduced by the new run label, not evidence that cleanup now kills a foreign process. The same ambiguity applies to unmarked group orphans collected over the overlapping interval. Existing overlap tests assert the right lane for lane-marked carriers, but do not cover traceability for deferred shared-scope leftovers.

One worker's fix: retain the run IDs spanning each shared cleanup interval and distinguish a lane-owned stop from a shared-scope stop. A known lane's entry can name its own run; an unattributable bare/group entry must name the candidate runs and label the attribution uncertain, rather than presenting only the final run as its creator. Ensure the run records/logs expose every candidate's test files. Add an overlap regression with a short run's bare-marker child and a disjoint long run's file list; also cover the unmarked orphan path. Preserve the lane isolation and every identity check. Ownership: `src/core/daemon/escaped.ts`, the formatter in `terminate.ts` if needed, and `test/daemon/`.

### B2. Forgotten or abandoned sync requests do not release their retention holds

**Proven at the real scheduler/handler seam; discharge count and age are simulated, not a naturally observed hour-long stall.** `src/core/scheduler/scheduler.ts:335` registers a hold, and line 340 releases it only after `refined()` resolves/rejects and the answer is read. `src/core/scheduler/discharges.ts:85` has no hold deadline or count bound. Neither caller completion nor request eviction reaches that release.

The unchanged boundaries now carrying these new resources matter: `syncDaemon.stop()` at `src/cli/status-sync.ts:72` only stops polling. `createHandlers` at `src/core/daemon/handlers.ts:179` remembers at most 32 sync IDs; `remember` deletes older records without cancelling their work. The front desk/main-thread messages carry no sync cancellation or expiry. Thus a caller that timed out, exited, or can no longer retrieve its answer continues to protect history while an unrelated runner refinement remains held.

001-214 explicitly asks that “memory stays bounded when no wait is outstanding,” and the review brief asks whether retention can grow without bound. A fixed revision window bounds which entries one hold covers; it does not bound the lifetime or number of holds, or the union of many windows.

The external Vitest probe uses the real fixture adapter, store and scheduler. After baseline, it suspends a real `invalidate` call for revision 1. It routes 40 `sync` requests through the real `createHandlers` into the actual `rekeyedOnceRefined(0, 1, 0)` path, as the daemon does. Instrumentation counts actual hold/release calls and obtains that scheduler's actual `Discharges` instance. The first request is already unanswerable (`unknown request id`), but all 40 holds remain active. Feeding 10,050 distinct revision-1 discharges followed by one at `t + 3,600,001` preserves 10,051 entries, including the now-hour-old entries, under the real default cap of 10,000. Releasing the unrelated refinement releases all 40 holds and prunes to one entry. The probe uses synthetic file refs/timestamps to exercise retention; it does not claim a 10,051-file project's suite or an actual hour was run.

Any number of requests can add more unreleased windows; the 32-ID map does not cap them. With more than 32 concurrent CLI waits, polling an evicted ID also restarts sync in `syncOnce`, so retry can compound this while the runner is held. There is no enforced maximum refinement duration: the run timeout bounds runs, not arbitrary runner-part calls. The resource leak and missing lifecycle link are proven; exhausting host memory in normal use was not measured.

One worker's fix: make the hold owned by an identifiable, bounded sync request. Propagate cancellation/expiry and eviction across the CLI, front desk and main thread into an idempotent release that can execute even while refinement is blocked. Limit accepted live requests instead of silently abandoning their IDs while retaining their holds. Preserve genuine live-answer membership at both pruning bounds; when a request budget expires, return an explicit failed/incomplete sync rather than quietly losing its own news. Regression tests must cover caller timeout/stop, evicted/rejected requests, a stalled refinement and normal success/failure/close, checking hold count and retained entries after each. This needs ownership beyond the original row: daemon sync protocol/handlers/desk and CLI sync lifecycle, scheduler/discharges, and their tests. No schema change is needed.

## Should-fix

### S1. The opening stress test should not spend eight busy CPUs in every default suite

**Proven spin and missing child cleanup from source; the supplied 8 to 50 s cost is coordinator evidence. Causation of unrelated gate timeouts is unverified.** `test/store/opening.test.ts:10` starts eight openers across 100 new stores and 100 reopen rounds. `test/store/child/opener.ts:26` continuously calls synchronous `readdirSync` until every party arrives, with no barrier deadline. The test holds all eight process handles but has no `finally`/test-finished kill; if a party dies or stalls, the others can spin until teardown removes their directories, or outlive the test while it is still timing out.

Answer to the coordinator: **make the default test lighter**. The deterministic 500 ms write-lock case already detects the precise bug without a statistical race. This review independently reproduced its red behavior in an external copy without the retry and its green behavior on the candidate. Keep it in the normal suite, together with a small concurrent create/reopen smoke test using a blocking rendezvous, bounded waiting and unconditional child cleanup. Preserve the 100-store stress experiment only as an explicitly selected stress check if its extra coverage is wanted. Merely moving the entire file to Squeal's slow tier delays it during editing; a full `--all` checkpoint and independent Vitest suite still pay its CPU cost. If using a slow lane, split the cheap correctness case from stress and reduce the stress cost too.

The worker reported that a sleeping barrier was red only two of five times versus five of five for spinning. Those raw logs no longer exist and are **unverified worker claims**, not this review's proof. Replacing spin with sleep alone and retaining probabilistic red/green would weaken the regression. The deterministic holder is the correct default discriminator. I do not attribute the coordinator's seven-then-two unrelated gate timeouts, or this review's three, to this test without timing evidence.

One test worker owns `test/store/opening.test.ts` and the opener/spawn helpers: cap rounds, use a blocking/IPC rendezvous, give barriers their own deadline, terminate/await all children on every exit, and preserve deterministic fix-removal failure. No runtime product dependency or product behavior change is required.

## Nits

### N1. D7/D12 and the amendment log do not describe the new contracts

**Proven documentation drift.** D12 still describes notes as naming only pids and command lines; it does not describe parent/age/signal/run provenance. D7 and the dated amendment log do not record the new held-answer lifetime or `Scheduler.rekeyedOnceRefined` contract. The reviewed status delta adds only the later 001-220 decision. The board accurately says these rows landed; it was not edited by this review.

The coordinator should fold the final, repaired cleanup attribution and request lifetime into D7/D12 and add dated amendment entries for 001-212/214. Do this after deciding B1/B2 so the spec describes the accepted contract. This is not a blocker or a request to the reviewer to edit the spec.

## What fits and answers to the brief

| Row/question | Evidence and answer |
| --- | --- |
| 001-207: cause named; new/existing simultaneous opens? | The added test documents SQLite's read-to-write WAL upgrade bypassing the busy handler. The external holder probe reproduces errcode 5 at 0 ms without retry despite a 5 s timeout; candidate succeeds at 608 ms. The eight-process create/reopen regression passed in the independent full suite. Its repeated stress red/green runs are worker claims; this review independently verifies the deterministic failure mode. |
| Does 001-207 preserve 001-141? | Yes on a current WAL store. The `auto_vacuum` guard remains, `migrate` still returns before `BEGIN IMMEDIATE` at the current schema, and the WAL pragma is read-only when already in WAL. With a held writer, the external probe integrity-checks/opens with timeout 0 in 1 ms and reads the kept value. The existing regression passes on Node 22 too. |
| Does 001-207 preserve 001-161? | Yes. Startup still passes 120,000 ms in `openDaemon`, readiness still calls `setBusyTimeout(..., 5_000)`, and the retry uses that connection's requested opening budget. The settings read back as 120,000 then 5,000 ms. No global default or ready-daemon setting was changed. |
| 001-208: wait for the daemon's move? | Yes. The cwd read and held-path check now occur in the same poll at `scratch.test.ts:105`; a disappearing proc entry is retried with `safe`. The changed file passed in the full suite. The external Node 22 copy passed all twenty repetitions beside existing host work, as recorded above. The worker's claim of twenty passes beside 24 `yes` burners is not adopted as reviewer evidence. |
| 001-209: scan guarded entry/build seams and catch a new edge? | Yes. `guardedImportsOfExempt` now includes all six `GUARDED_WITHIN` exceptions. The ten existing dispatcher edges each have their reason; overlay regressions inject one exempt helper per exception and require the extra edge. All pass in the full suite and the Node 22 key-format gate. Test-only edits do not require a source pin move. |
| 001-212: parent, age, escalation and reachable test files? | Parent, monotonic process age and SIGTERM/SIGKILL details work in the real fixture test and the identity tests. The fixture includes a TERM-ignoring process and resolves the note's run ID through `store.runs.get` to its test file. Traceability fails for deferred shared-scope processes across overlapping runs: B1. |
| Does moving signalling to `terminate.ts` signal/name a foreign PID? | No new such failure found. Every TERM/KILL is checked against pid/start immediately before signalling. Only TERM-targeted identities enter the returned list. A parent line is suppressed when the child is reparented during the read. Existing identity/reuse tests and the new parent/escalation tests pass, also on Node 22. The pre-existing final check-to-signal PID-reuse window remains, explicitly documented; no pidfd/native change was required. A labelled parent may be an adopting init/subreaper, not the original test process. |
| 001-214: protect both bounds and prune unused history? | The four public wait cases, including default-cap overflow and the simulated hour case, passed in the independent suite; the new unit controls pass on both Nodes. `hold` filters by time, lower revision and captured upper revision, and normal finally-release prunes. Abandoned/unretrievable requests fail bounded lifetime: B2. |
| Was the agreed `Daemon.#requestSync` change wired correctly? | Yes for the normal path. After reconciliation it captures a revision, immediately calls the scheduler's hold-before-refinement operation, awaits it and returns the same captured upper revision. There is no await between capture and hold. Null `after` retains its prior no-membership path; null `resolvedSince` requests no discharge history. The missing end/expiry plumbing is B2, not an argument-order or call-site omission. |
| Version 2 re-pinned in place? | Correct under the human's unreleased-version instruction. Version 1's shipped pin is unchanged, the constant is 2, the current guard passes and both bundle sets carry the new paths. The later unreleased re-pins do not rewrite version 1. Build reproducibility remains unverified because the build was forbidden. |

## Inputs for the next wave

The human decides the blockers. Dispatch B1 to one cleanup-provenance worker and B2 to one sync-lifecycle worker; their product ownership is disjoint. Neither repair should change keys, claim acceptance, edit attribution or the lane isolation rules. The coordinator can re-pin version 2 only while it remains unreleased, then rebuild both plugins at landing. S1 is a separate test-only cost repair, not a reason to weaken the WAL regression. N1 belongs to the coordinator after the contracts settle.

A re-review should verify that a shared-scope cleanup identifies every candidate tier instead of one unrelated tier, and that a stopped/expired/evicted wait releases history while refinement is still blocked. Keep the normal wait overflow/hour controls green. Require one bounded hold per accepted sync request and explicit failure when a live-answer budget cannot be honored; do not solve B2 by dropping protected membership silently.

## Background status before the report commit

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.94/dist/cli/squeal.mjs status
Revision: 2
Known failures: 0
Affected checks: 2767 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: none completed since revision 0
Worktree: candidate HEAD b493138, clean at revision 2
Daemon: running, last heartbeat 0 s ago
(exit 0)
```

Revision 2 follows the report's temporary creation/removal; no product bytes changed. No additional checkpoint was requested for documentation. The independent full-suite result and its targeted recovery above remain the review's verification.
