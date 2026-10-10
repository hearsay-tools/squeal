# Wave 13p: second-round review of shared runs (001-211)

## Verification output

Candidate: `6c6c596beeafeabb74e52652e505a645deb9605d` (0.1.94), the authorized HEAD. The executable candidate is `89429af0`; `git diff 89429af0..HEAD --stat` names only `docs/board.md` (4 changed lines). Reviewed range: `d6840389..89429af0`; repair commits `bca54d20..bc399dea`. This review is bounded by `reviews/wave-13o.md` B1, B2, S1 and N1 and the brief's additional question about slow re-selection. No prior settled behavior is re-prosecuted. The tracked candidate stayed clean throughout installation, verification and probes.

Linux, Node 24.21.0. The claim-specific regressions and both direct probes also ran on Node 22.23.3. Build reproducibility is **unverified**: the brief explicitly forbids `npm run build`, and it was not run. Both shipped CLI bundles contain the re-probe, final permit shrink and settled-pick retry. Format 1's in-place re-pin relies on the brief's statement that it is unreleased.

```text
$ git rev-parse HEAD
6c6c596beeafeabb74e52652e505a645deb9605d
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 4s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.94 lint
> biome check .
Checked 744 files in 356ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.94 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run --maxWorkers=4  # independent reviewer gate, Node 24.21.0
RUN v5.0.3
# Surviving output before the network disconnect ended the worker/run:
node-test graph cost, 1,000 modules, 200 test files, 5 rounds:
  cold: 694.52 ms, reresolve: 835.37 ms, coldMedian: 743.41 ms, edit: 0.99 ms
FAIL test/runners/node-test/graph-cost.test.ts (1 test | 1 failed)
(no final Test Files/Tests summary or exit status; interrupted, not a pass)

$ npx vitest run test/scheduler/claims.test.ts test/scheduler/claims-expiry.test.ts \
  test/scheduler/claims-finished.test.ts test/scheduler/claims-slow-slot.test.ts \
  test/scheduler/claims-slow.test.ts test/scheduler/claims-split.test.ts \
  test/daemon/claims-restart.test.ts test/runners/node-test/graph-cost.test.ts --maxWorkers=1
Test Files  8 passed (8)
     Tests  28 passed (28)
Duration 39.57s
(exit 0, Node 24.21.0)

$ npx vitest run test/keys/key-format.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  21 passed (21)
Duration 860ms
(exit 0, Node 24.21.0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run \
  test/scheduler/claims.test.ts test/scheduler/claims-expiry.test.ts \
  test/scheduler/claims-finished.test.ts test/scheduler/claims-slow-slot.test.ts \
  test/scheduler/claims-slow.test.ts test/scheduler/claims-split.test.ts \
  test/daemon/claims-restart.test.ts --maxWorkers=1
Test Files  7 passed (7)
     Tests  27 passed (27)
Duration 39.61s
(exit 0)

$ node --disable-warning=ExperimentalWarning --import tsx <temporary-gates.mjs>
# Real Ledger/startTier/state sink; private real SQLite, observer connection.
# Same assertions/output on Node 22.23.3 and Node 24.21.0.
accepted: settled, runRows=0
forced: running, runRows=1
recentClaim: running, runRows=1
recentHit: settled, runRows=0
heldFail: running, runRows=1
slowDenied: running, runRows=1
slowAllowed: settled, runRows=0
slowOwn: settled, runRows=0
slowHeldFail: running, runRows=1
claimed: queued, runRows=0
(exit 0; settled rows/current states/checkpoint completion read from observer;
 attributions cleared only for settlements)

$ node --disable-warning=ExperimentalWarning --import tsx <temporary-slow-null.mjs>
# Real SlowTier/startTier/Ledger, private two-connection SQLite, real slot locks.
# Inject result/claim commits after picking, before the outer start transaction.
# Same assertions/output on both Nodes.
settled: first=again, second=null, queued=0, waiting=false,
  runRows=0, runningPublications=0, freePermits=2
claimed: first=null, second=null, queued=2, waiting=true,
  runRows=0, runningPublications=0, freePermits=2
mixed: first=again, second=null, queued=1, waiting=true,
  runRows=0, runningPublications=0, freePermits=2
(exit 0)

$ node node_modules/vitest/vitest.mjs run --root <temporary-copy> \
  test/scheduler/claims-finished.test.ts --maxWorkers=1
# B1 re-probe removed, other repairs intact:
Test Files  1 failed (1)
     Tests  3 failed (3)
# Re-runs settled keys, including the slow picks. (expected failure, exit 1)

$ node node_modules/vitest/vitest.mjs run --root <temporary-copy> \
  test/scheduler/claims-slow-slot.test.ts --maxWorkers=1
# Only shrinkTo(tier.files.length) changed back to shrinkTo(picked.length):
Test Files  1 failed (1)
     Tests  2 failed (2)
# Both claim/result cases fail at take("c"): expected null not to be null.
(expected failure, exit 1)

$ node node_modules/vitest/vitest.mjs run --root <temporary-copy> \
  test/scheduler/claims-finished.test.ts --maxWorkers=1
# Only the settled-pick null return changed back to "claimed":
Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
# Slow next-file regression: expected 3 current passes, received 2.
(expected failure, exit 1)

$ node node_modules/vitest/vitest.mjs run --root <restored-temporary-copy> \
  test/scheduler/claims-finished.test.ts test/scheduler/claims-slow-slot.test.ts --maxWorkers=1
Test Files  2 passed (2)
     Tests  5 passed (5)
Duration 4.20s
(exit 0)

$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint f64c6af1-a2c4-4aad-8430-2cf5176a44ec started at revision 0: 1 test files
Checkpoint f64c6af1-a2c4-4aad-8430-2cf5176a44ec completed
Revision: 0
Known failures: 0
Affected checks: 2747 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 0
(exit 0; Known failures read)
```

The independent full-suite verdict is **unverified**: the network disconnect ended the run before a final summary; its original tool session and process were gone on resume. Its surviving graph-cost timing failure recovered in the serial run. The resumed parent explicitly allowed recording the available evidence instead of restarting the full suite. No claim of an independently passing full suite is made. All 27 claim-specific tests pass on each Node, and the key-format guard matches the new pin.

The Squeal checkpoint is separate evidence from the installed 0.1.86 daemon; it does not replace the independent reviewer run. Its baseline first reported a 10 s teardown timeout in the pre-existing `test/scheduler/timed-out-tier.test.ts` case. The checkpoint re-ran that file and it recovered under the same inputs, with a flaky note. The header then counted 2,757 current checks and no pending, stale or unknown checks. This is not a new proven break in the repair.

The private probes use fixed keys and empty stability-input lists to isolate start/settlement and slot behavior. They do not retest hashing or the completion barrier. The mutation runs use a temporary source/test copy outside the candidate; only that copy was changed. Scripts, temporary copies, stores and slot locks were removed or closed before committing this report. The coordinator's reported 2,407-pass gate and isolated timeout recoveries are supplied context, not this reviewer's independent evidence.

## Verdict

**PASS `6c6c596b` (executable `89429af0`): 0 blockers, 0 should-fix findings, 0 nits.** B1, B2, S1 and N1 are closed. The in-transaction re-probe preserves the acceptance and claim gates, commits settlements without a run row, and the slow settled-pick retry is safe in the tested interleavings.

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits

### B1 closed: the start re-probes and commits every settlement

`src/core/scheduler/tiers.ts:205` calls `startable` inside `BEGIN IMMEDIATE`, before opening a run. `startable` at line 256 skips lookup only for a forced file, uses the existing `Ledger.probe`, applies hits with the picked checkpoint ID, and removes those files from the tier. A withheld hit makes `mayWait` false, so even an existing claim cannot delay local confirmation. With no survivor, line 210 commits the ledger and returns null before `beginRun`, run-row creation or running phases. With survivors, the same commit writes settlements and claims together. A competing writer cannot record between that re-probe and the claim because the write lock is already held; nested ledger transactions are savepoints.

The finished-tier regressions cover all picks settling, partial settlement, and slow picks settling before a later slow file. They assert no duplicate local execution, zero local run rows for the all-settled fast case, current results and completed checkpoints. Removing only the re-probe makes all three red. The direct two-connection probe also reads the committed settled rows and checkpoint from the observer.

| Gate | Evidence at this candidate |
| --- | --- |
| Forced | `p.forced` returns the original pick without lookup or claim consultation. A newly landed pass still opens one local run; a forced checkpoint is not completed by that pass. Research test 5 passes. |
| Recent | Fast selection and slow picking set `waits` false for recent files; the start can only retain, never enable, that flag. A fresh claim does not delay the recent file. An acceptable landed result may still settle it, just as the pre-existing selection lookup does. Research test 4 and both direct recent cases pass. |
| 004 D6 | Unchanged `Ledger.probe` denies foreign results for a slow file with no declared artifact and disables waiting, but accepts the worktree's own result. Artifact-backed foreign passes stand. The direct denied/allowed/own cases and the slow noninheritance regression pass. |
| 001-170 | A foreign unconfirmed fail withholds the whole file's results and disables waiting. Both fast and artifact-backed slow gate probes start locally even with a live claim; no inherited fail becomes current. The existing with/without-claim regressions pass. |

### B2 closed: actual files determine permits and bookkeeping

`src/core/scheduler/slow-tier.ts:321` shrinks after transactional filtering to `tier.files.length`. Running activity, paths and longest duration are already based on those files inside the start transaction; load notes and the artifact map now follow them too (lines 322 and 332). Both three-owner tests let C acquire the spare permit while B's survivor still runs, whether A claims or records the omitted pick. Removing only the final shrink makes both fail exactly at C's acquisition.

The null path publishes no running activity, returns no `SlowRun`, and releases its slot in `next()`'s single `finally`. The scheduler starts no flight for null or `"again"`, so there is no second flight-release path. The private all-claimed, all-settled and mixed probes confirm zero run rows and running publications and that both permits are immediately available.

### The slow settled-pick retry is safe

At `slow-tier.ts:318`, a null start returns null from `#select` only when a picked file left the queue; `next()` translates that to `"again"`, after releasing the slot. The pump consumes `"again"` with `continue` (`scheduler.ts:442`) and plans fast work before slow work again. Each such retry requires a settlement removing a pick, so the same settled files cannot spin. On the next pass, an all-settled queue clears the request/activity and finishes; a mixed queue keeps only the claimed remainder and takes the claim wake, without reacquiring capacity; an all-claimed start goes straight to that wait. The existing 250 ms store poll, one-second retry bound and claim expiry are unchanged.

This retry is necessary: removing it alone leaves the third slow file pending with only two current passes in the lasting regression. Restoring it lets that file run once. The analogous fast retry re-selects only after a pick left the queue, respects the same busy-lane set, and counts no empty tier against the starvation rule.

### S1 closed: a cancellation-shaped slow report wakes the waiter

`test/scheduler/claims-slow.test.ts:95` now explicitly gives the held claimant a completed report with no completed files or results, the cancellation shape. Its running row clears without an acceptable hit. B receives no watch batch or suite request, takes no slot while waiting, and starts once through the claim wake, before the slow timer's 15 s bound; acquisition count is one. The test then checks B's current pass. It passes on both Nodes. Slow tiers have no backlog cancel controller; this test exercises the slow incomplete-report release path, not the fast backlog's abort/requeue branch.

### N1 closed: both amendment logs record the decisions

`docs/specifications/001-core-loop/status.md:154` records dated 001-205 amendments to D5, D8 and D10, including the queued-or-running sharer divisor and its rationale, heartbeat and waiter bounds, and 001-210's transaction re-probe. `docs/specifications/004-slow-suites/status.md:98` records D6's inheritance/claim gate, drain settlement and D2's final permit count and bookkeeping. These satisfy the requested log repair. Neither log nor the board is edited by this review.

## Inputs for the next wave

- No repair row is required by this review. Keep the new race, spare-permit, slow retry and cancellation regressions.
- Fold the 001-210 start re-probe amendment into D8 when consolidating the status log, as the amendment itself assigns to the coordinator.
- Build/drift verification remains the coordinator's landing check because this task forbids the build. The reviewer has not accepted or merged its own review.
