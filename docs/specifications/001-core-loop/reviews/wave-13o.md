# Wave 13o: review of shared runs (001-205)

## Verification output

Candidate: `b5116aaf` (0.1.93), range `607d9d8684637c8bd2fc4a818e22e027725376aa..b5116aaf`. The twelve worker commits end at `1f91fd86`; `122bac3d` rebuilds and re-pins unreleased key format 1; `b5116aaf` names the heartbeat seam. Initial HEAD was `185c01af`, a descendant changing only `docs/board.md`. The parent authorized that descendant, but the reviewer detached at the exact candidate before installation and verification. Candidate checks and private-store probes ran before this findings file was written; the tracked candidate stayed clean. The task branch is restored before committing the report alone.

Linux, Node 24.21.0. The discriminating probes also ran on Node 22.23.3. Build reproducibility is **unverified**: `npm run build` was explicitly forbidden and was not run. The shipped CLI bundles contain the claim queries, transaction recheck and startup reset; no bundle was edited.

```text
$ git rev-parse HEAD
b5116aaf813ce1aacf15fb3c2b3d2bf1183188fc
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 30s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.93 lint
> biome check .
Checked 739 files in 558ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.93 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run --maxWorkers=4  # independent reviewer gate, Node 24.21.0
Test Files  3 failed | 331 passed | 1 skipped (335)
     Tests  3 failed | 2401 passed | 10 skipped (2414)
Duration 888.05s
FAIL test/harness/codex/plugin.test.ts:87: test timed out in 5000ms
FAIL test/keys/observed.test.ts:20: test timed out in 5000ms
FAIL test/runners/node-test/graph-cost.test.ts:97:
  expected 278.2085810000003 to be less than 267.49474899999996
(failed suite; shell printed the log tail after Vitest)

$ npx vitest run test/harness/codex/plugin.test.ts test/keys/observed.test.ts test/runners/node-test/graph-cost.test.ts test/daemon/handover.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  26 passed (26)
Duration 18.94s
(exit 0)

$ node --disable-warning=ExperimentalWarning --import tsx <temporary-probe.mts>
# Two connections to a private real SQLite store; no repository daemon/store touched.
# selectTier/executeTier and SlowTier.next are the candidate implementations.
result commits after selection before BEGIN IMMEDIATE:
  aCompletedRuns=1, bNewRuns=1, bTierFiles=1
result already present before selection (control):
  bNewRuns=0, resultKey=key-0
one of two slow picks claimed before transaction:
  tierFiles=1, heldPermits=2, claimantPermits=1, bystanderBlocked=true
all slow picks claimed before transaction (control):
  next=null, activity=null, permitCloses=2, activityPublications=0
(exit 0, assertions checked; same observations on Node 22.23.3)

$ node --import tsx <key-pin probe>
version=1
hash=941898948331353ad05fb1e4bea652b19a3873f4b416511995ee688fc8ec59d3
heartbeatGraceOnlyGlobalHashChanged=false
(exit 0)

$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint 7874380c-eac3-4f3e-82fc-9b3c2fa4cca6 started at revision 2: 0 test files
Checkpoint 7874380c-eac3-4f3e-82fc-9b3c2fa4cca6 completed
Revision: 2
Known failures: 1
  FAIL test/daemon/handover.test.ts > a step-down with released bundles of other versions (B1)
       > with a released 0.1.31 session registered, a current hook asks nothing: 0.1.32 keeps serving
       expected [ 'unavailable' ] to deeply equal [ 'alive' ]
Affected checks: 2738 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 2
Worktree: HEAD b5116aa, clean at revision 2
(exit 0, which is not a passing verdict; Known failures was read)
```

The independent run passed all claim-specific regressions. Its three failures are in pre-existing tests outside the changed sources; all three files pass in the serial rerun, as does the handover file Squeal reported. The full run is still recorded as failed. Host load reached roughly 132 and was about 22 when the rerun began. These observations do not establish a new gate failure caused by this range.

Squeal is separate evidence, from the auto-started installed 0.1.86 daemon. Its baseline reported ten failures at load roughly 120 to 140; nine recovered, and handover cases exchanged PASS/FAIL under the same inputs. It does not replace the independent reviewer run. The temporary probe used fixed keys, empty stability-input lists and a fake runner/sink to isolate transaction and slot behavior; it does not claim to retest hashing or the completion barrier. Its SQLite connections and slot locks were closed, and its scratch data and script were removed.

## Verdict

**FAIL `b5116aaf`: 2 proven blockers, 1 nonblocking should-fix, 1 nit.** Claims preserve the inheritance and confirmation gates, and release is bounded. The atomic start is incomplete when the competing tier has already finished, and partial slow selection holds an unused slot permit. Per the brief, the blockers go to the human through the parent. No product code or board change is made by this review.

## Blockers

### B1. Proven: a result committed between selection and start still runs again

Location: `src/core/scheduler/tiers.ts:198`, callers `selectTier` at line 151 and slow `#pick` in `slow-tier.ts:346`.

`startTier` rechecks only `Claims.holds`. A tier recording a result releases its claim in the same transaction. Therefore a completed competing tier is indistinguishable here from a key nobody ran.

Concrete interleaving, with neither a forced run, an edit, a held failure, a stale heartbeat nor a takeover:

1. B's lookup misses K and its first claim check sees K free; B selects the file.
2. A starts and completes K before B takes its start transaction. A atomically stores a passing result and releases K's claim.
3. B takes `BEGIN IMMEDIATE`. `claimed(K)` is false, so B starts and runs K again, despite the accepted result already in the store.

The private-store probe places step 2 just before B enters the real transaction, using A's separate connection. It writes A's completed run, result and released row together, then executes B's returned tier. Output: A completed once, B ran once, the same key was run twice. Moving the very same result ahead of B's initial selection returns no tier and runs nothing. This is the same race surface the worker's test 9 controls, with the other tier finishing rather than staying running.

Requirement broken: 001-205's research test 1 and four-worktree done-when, each key run once; D5 step 3, "A hit is promoted to current ... No run is needed." The documented intentional duplicates (force, recent work, noninheritance, held failure, expiry, growth) do not cover this interleaving. The slow path shares this start function and has the same gap.

One-worker repair: inside the same `BEGIN IMMEDIATE` that chooses and claims the final files, re-probe eligible nonforced files before checking claims. Apply acceptable results and finish their checkpoint attribution there; with withheld hits, run locally rather than waiting. Commit ledger changes even when no tier remains. Retain forced runs and the recent/004 D6/001-170 exceptions. Add the deterministic finished-tier race beside test 9, including a case in which every selected file settles and no run row opens.

### B2. Proven: a partially claimed slow tier holds permits for files it does not run

Location: `src/core/scheduler/slow-tier.ts:296` and line 312, with `tiers.ts:198`.

`#select` calls `slot.shrinkTo(picked.length)` before `startTier` removes picks that another worktree claimed in the meantime. A nonnull tier never shrinks the slot again.

Concrete interleaving: B takes two permits for two slow picks; A takes a third permit and claims B's second pick before B's start transaction. B correctly starts only the first pick, and its running activity correctly names only that file. B still holds both permits until that file ends. With `slow.maxParallel=3`, A runs one file and B runs one, but a third daemon cannot obtain the otherwise unused permit. The probe uses real SQLite slot locks in one private slot directory, not a mocked slot. Output: `tierFiles=1, heldPermits=2, claimantPermits=1, bystanderBlocked=true` on both Nodes.

Requirement broken: 004 D2, "one permit per file" and "an idle tier ... takes ... as many ... permits ... as it has files." This delays another worktree's slow work for the survivor's whole run, even though capacity should be free. This is a new partial-selection case introduced by `startTier` filtering; the all-claimed control releases the slot correctly.

One-worker repair: after `startTier` returns a nonnull tier, shrink to `tier.files.length`; derive per-file notes and artifact selection from the actual tier too. Keep the null path's single release and no running publication. Add a shared-slot partial-race test with a third owner that obtains the spare permit before B's survivor finishes. This can be a small repair separate from B1; B1's additional filtering makes this adjustment necessary for settled picks too.

## Should-fix

### S1. Proven coverage gap; cancellation behavior is unverified by a slow-specific test

Location: `test/scheduler/claims-slow.test.ts:59`. Slow claimant death, crash and successful result landing are tested. No explicit cancellation case implements brief question (a)'s "with a test for each". The source release path clears running rows for an incomplete cancelled file in `recordTier`, and the same claim wake should retry it, but a crash is not the cancellation branch. This is not a proven behavior break and does not block.

Retain a slow waiter test whose claimant cancels without an acceptable result, then show that the waiter starts through the pump's event/timed claim wake, without a watch batch, full-suite request or tight slot loop. Keep the null-start race control as a lasting regression when B2 is fixed.

## Nits

### N1. Proven: the amendments have no status-log entry

Location: `docs/specifications/001-core-loop/status.md:153`; also the 004 amendment log. This range changes 001 D5/D8/D10 and 004 D6, but adds no dated 001-205 amendment entry. The briefs' shared rule asks for one status line per row. Coordinator follow-up: record those decisions and the queued/running sharer divisor choice in the relevant amendment logs. The reviewer leaves both logs and the board alone.

## What fits

### The requested questions

| Question | Evidence and conclusion at this candidate |
| --- | --- |
| Can a claim leave a file unrun? | No demonstrated lost-file path. Skipped files stay queued. `Claims.holds` expires at two heartbeat intervals or the waiter's timeout plus 6 s (600 s for null). The pump retries on store movement and at least each second. Failed/discarded/withheld recording clears running without installing a hit, so the waiter can run it. |
| Can it run a file twice? | Yes, B1. Intended duplicates also remain for force, recent work, denied inheritance, held failure and bounded takeover. The running-claim recheck itself is atomic under `BEGIN IMMEDIATE`. |
| Can it delay an edit's own file? | The claim gate skips `recent` in fast selection, slow candidates, slow picking and the transaction's `waits` flag. Normal lane/slow-policy limits remain. B2 adds an unintended delay to another daemon's slow work through a wasted permit. |
| Can forbidden results stand under 004 D6 or 001-170? | No new acceptance bypass found. `Ledger.probe` preserves local reuse, `inheritsAcrossWorktrees`, and whole-file withholding for an unconfirmed foreign failure. Withheld hits cannot wait on claims. Claims produce no result and do not weaken the completion barrier, stability or grown-key handling. |
| Crash or kill? | The physical row may stay running; the claim ceases when its heartbeat exceeds the two-interval grace. Expiry tests exercise this without any claimant write. This is logical release, not deleting the row. |
| Step-down or orderly exit? | Shutdown stops heartbeats, awaits the in-flight tier's recording, then clears the daemon record. `recordTier` clears each `runningKey` with the result transaction; crash/error requeue also clears it. A long graceful finish may exceed heartbeat grace and allow the documented takeover before it ends. No new claim survives an actually stopped daemon. |
| Restart? | `#register` resets predecessor running rows to queued in the first-heartbeat transaction, before asynchronous baseline work. The new heartbeat cannot revive them. The restart regression checks that precise pre-baseline interval. |
| Re-key during a run? | `Ledger.#syncPhase` marks running only for `file.key === file.runningKey`. A new key is queued, or already settled, never a claim for an unstarted run. |

### Explicit slow-tier questions (a), (b), (c)

(a) **No hot spin for a claims-only queue.** `#candidates` returns no refs for waiting claims before taking the slot, and `next()` returns null. The scheduler then awaits `#claimWake`, racing a local event against 250 ms store polling with a one-second deadline. A result landing settles the file through `claimOf`; death is noticed by the timed wake; a crash releases the row and the waiter runs. The candidate tests cover death/crash and the result/drain path. The explicit cancellation case is S1, not silently treated as tested.

(b) **The all-rejected null-start path is safe.** A probe introduces both claims after slot acquisition and before the transaction. `startTier` returns null, the running-publication branch is not reached, `#select` returns `"claimed"`, and `next()` returns null. Its `finally` releases both permits once; the scheduler starts no flight and therefore takes no second flight-release path. The activity stays null and there are zero activity writes. B2 is the separate nonnull, partly rejected case.

(c) **An inherited result ends the pending drain.** The slow candidates call `claimOf` before acquiring capacity. An accepted hit applies results, removes the file from the queue and completes checkpoint attribution; candidates reconsider the empty queue. `Scheduler.slowPending()` becomes false. `claims-slow.test.ts` asserts that the claimed file is not run locally, has a current pass, acquires no slot, and stops being slow-pending after the claimant's result lands. The daemon's existing 004-29 drain callback reads that same predicate. A held foreign failure remains pending and must be confirmed locally.

### Key guard and rebuild

The `claims.ts -> status/snapshot.ts` exemption added by `b5116aaf` is **safe for its current use**. The sole imported value is `HEARTBEAT_GRACE_INTERVALS`. It chooses when to stop waiting; it does not choose key inputs, transform outcomes, store a result, or accept a withheld result. The imported module has no top-level store writes. The guarded `Claims`, start/record path, `Ledger.probe`, inheritance rule and completion/stability checks still determine validity. Changing only grace 2 to 3 leaves the format guard unchanged, as this named exemption intends; it changes timing rather than whether an old result is sound. This judgment does not authorize future result-processing imports from that exempt directory.

The hash at format 1 equals the candidate's re-pin. Re-pinning in place relies on the task's explicit statement that format 1 is unreleased; a released format must be bumped. The version manifests are 0.1.93 and both CLI bundles contain the source change. No claim of build reproducibility is made without the forbidden build.

## Inputs for the next wave

- Human decision on B1 and B2; no automatic acceptance or landing by this reviewer.
- B1 owns the scheduler's final lookup/claim transaction plus real-store race regressions. Probe acceptable hits before claims, preserve the foreign-fail and slow-artifact gates, and commit settlements even when no run starts.
- B2 owns slow selection and shared-slot regressions. Final permit count, published paths, per-file notes and artifact records must follow `tier.files`, after all transactional filtering. Null-start must remain no run row, no running activity and one release.
- Keep 250 ms store polling, at most one second between dead-claim rechecks, two heartbeat intervals of grace, and the current finite waiter bound. Do not change the starvation rule, lane cap or force/recent exceptions while repairing these races.
- Add the slow cancellation case (S1), record the amendments (N1), and independently verify the repaired candidate. Build/drift proof remains the coordinator's landing check because this task prohibited the build.
