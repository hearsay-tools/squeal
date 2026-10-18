# Wave 2b: candidate 0.1.217

FAIL af9d0b58fe2397e12b9ff0c6ffa4eb73c7be720f

Two proven blockers (011-18 baseline identity and 011-19 first-error retention), one proven nonblocking retention issue, no nits. 004-70 closes the queue-fidelity finding in 004 `reviews/wave-8.1.md`, Fifth round, "Restore edge cases".

Reviewed 2026-10-18 at the exact candidate SHA. `HEAD` matched and the tree was clean before verification. The range is the candidate side of `origin/main..af9d0b58`; its merge base with the brief's `d02481c3` is `d61eff06893f19c2c3e7e02dcf78922c4d86eeeb`. Local `origin/main` was `5f7f068752e843990cbde485368570ecfe3d3c1b`; the intervening main commits are documentation only. No product code or existing test was edited. The accepted deviations in 011 `status.md` were read: a worktree registration-key meta row and counted current FAIL during a same-key slow rerun are allowed. The blocker concerns which registration's inputs that row actually records.

## Verification

```text
npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0)

npm run lint
Checked 1459 files in 755ms. No fixes applied.
(exit 0)

npm run typecheck
tsc --noEmit
(exit 0)

npm run check:version -- origin/main
version bump: 0.1.216 -> 0.1.217, ok
(exit 0)
```

Installation also printed the existing `node-domexception` deprecation and npm install-script approval notices. `npm run build` was not run, as directed. This review does not independently certify bundle regeneration.

Touched tests, selected from the candidate diff:

```sh
git diff --name-only d02481c3...af9d0b58 -- test | tr '\n' '\0' | \
  xargs -0 npx vitest run --maxWorkers=2
```

```text
Test Files  14 passed (14)
     Tests  105 passed (105)
Start at  18:58:43
Duration  16.51s
(exit 0)
```

Independent full suite, under the host's full-run lock rather than a Squeal checkpoint:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

```text
Test Files  734 passed | 1 skipped (735)
     Tests  6184 passed | 9 skipped (6193)
Start at  18:58:17
Duration  852.17s
(exit 0)
```

The run also printed two fixture gitdir-repair diagnostics, cleanup of one process left by an earlier run, and Vitest experimental type-testing notices.

Background Squeal 0.1.199 separately reported the recorder negative controls at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119` (expected pass without the recorder, got fail). These same background diagnostics are recorded in 004 `reviews/wave-8.1.md`, Fifth round, Verification. They were read, not retried or used in place of the independent run. Sampled load during this review ranged from about 13 to 45 on 24 CPUs.

Reviewer probes lived outside the checkout in `/tmp/0217-review-probes`, using an external Vitest configuration and candidate imports. The characterization and parser run (before adding the expected-failing assertion below):

```text
npx vitest run --config /tmp/0217-review-probes/vitest.config.mjs --maxWorkers=1
Test Files  1 passed (1)
     Tests  4 passed (4)
Duration  1.09s
(exit 0)
```

Three cases characterize registration snapshots and the two findings below. The fourth checks 36 `formatDelta` -> `squealEvidence` round trips: absent/failing/passing baseline, own/inherited origin, fast/slow file, and current/pending/stale validity. Every check retains its outcome, previous outcome, observed revision and validity. One initial probe run failed only its case-count assertion (54 instead of 36); all format/parser assertions had passed. Correcting that reviewer arithmetic produced the output above. A separate contract assertion for B1 then fails as expected on the candidate:

```text
npx vitest run --config /tmp/0217-review-probes/vitest.config.mjs --maxWorkers=1 \
  /tmp/0217-review-probes/required-baseline.test.ts -t 'requires the later consumer'
AssertionError: expected { outcome: 'pass' } to match object { outcome: 'fail', worktreeId: 'wt-b' }
Test Files  1 failed (1)
     Tests  1 failed | 3 skipped (4)
Duration  2.15s
(exit 1, expected: B1)
```

## Blockers

### B1. A second registration at the same revision inherits the first registration's obsolete key [proven]

**Where:** `src/core/state/before-edits.ts:64-72`, called from `src/core/delivery/registered.ts:130`; consumed at `before-edits.ts:115-117` and `src/core/delivery/provenance.ts:20`.

**Contract:** C5's gh-32 amendment defines the baseline as a result "at the key it had at the revision current when the session's consumer registered". A failed baseline must say it also failed before the edits. The accepted shared meta row does not authorize reporting a pass under inputs that were already obsolete at this consumer's registration. Vision principle 2 requires results to stay tied to their code state.

`recordRegisteredKeys` records only the first keys seen at a revision. A later consumer at that revision always reuses them. Keys can change without a new revision: baseline key computation and observed-input/runner-only refinement do this. `recordTier` grows keys at `src/core/scheduler/tiers.ts:459-463`; the existing public-scheduler regression in `test/scheduler/observed-growth.test.ts:55-65` explicitly verifies rekeying without advancing the revision. Thus revision alone is not an identity for a registration's input snapshot.

**Reproduction:** use a real temporary store and the public delivery API, as the candidate's own before-edits tests do. Keep the known-state/view empty so this is the first observed failure, not an already-seeded transition.

1. At revision 1, set the file's current key to `old`, store a shared PASS for check `a` there, and register session `s1`. The recorded snapshot is `{1: {file: old}}`.
2. Without adding a revision, move the file's current key to `grown` and store a shared FAIL for `a` there. Register session `later`. This models the same-revision key refinement above; no edits by this later session have happened.
3. The current key at `later`'s registration is `grown`, but its snapshot remains `old`. `beforeEditsFor(store, worktree, 1)(a)` returns `{outcome: "pass"}`.
4. Append revision 2, move the key to `edited`, store/apply the local FAIL there and call `delivery.onToolBoundary(later)`.

**Observed:** `formatDelta` says `PASS -> FAIL, seen by Squeal's run at revision 2`. The baseline at this consumer's actual registration key failed. The required text is `first observed: FAIL; it also failed before your edits (...)`. The probe asserts the actual `grown` key, the incorrect pass-baseline payload, and the resulting false regression text. No runner or queue is involved in the baseline lookup.

**One-worker repair:** associate each live/parked registration with its actual immutable key snapshot, deduplicating only identical snapshots. A revision may have multiple snapshots. Do not overwrite the earlier consumer's keys to repair the later one. Retain the original snapshot on resume, prune snapshots by live/unexpired parked references, and fall back to unknown baseline when no original snapshot can be recovered. Add the two-consumer same-revision rekey regression, including different baseline outcomes; preserve existing resume and cross-worktree tests. Keep this as lookup-only behavior, with no baseline run or new command.

### B2. A slow rerun that fails differently loses the first error from `why` [proven]

**Where:** `src/core/state/flaky.ts:48-59` and `src/core/status/format-why.ts:128-133`, reached by the new slow-rerun path in `src/core/scheduler/rerun.ts:90-93`.

**Contract:** C5's gh-20 amendment and the 011-19 brief both require that "`why` keeps the first error". Neither limits that requirement to a rerun that passes. The second failure is still relevant evidence, but must not erase the first one.

The new `FlakyNote.failure` field is written only when the outcome flips between pass and fail. A fail replaced by a fail is skipped at `flaky.ts:48`, even when its diagnostic changes. The shared result row is overwritten, and `why` renders history as transition names without their diagnostic fingerprints. It links the second run's log only. The original error is absent from the report.

**Reproduction through the public scheduler and real Vitest:** reuse the committed `rerun-slow-teardown.test.ts` fixture, with its external unkeyed marker. Its slow file has one always-passing test. In `afterAll`, read the marker, write `again` to it, and throw `FIRST_ERROR_01119` when its previous content was empty, otherwise `SECOND_ERROR_01119`. No keyed source changes between the runs. Start the scheduler and await idle, then call `formatWhy(readWhy(h.root, SLOW_FILE, {}))`.

**Observed:** exactly two runs. The check is current FAIL; history has `first seen FAIL` then `FAIL -> FAIL, failure changed`. The summary, result, error stack and run-log pointer all refer to `SECOND_ERROR_01119`. `FIRST_ERROR_01119` is absent. The candidate's persistent-error test uses the same error twice, so it does not distinguish preservation from replacement.

```text
npx vitest run --config /tmp/0217-review-probes/vitest.config.mjs --maxWorkers=1 \
  /tmp/0217-review-probes/persistent-first.test.ts
AssertionError: expected 'Check: test/teardown.test.ts (file-le…' to contain 'FIRST_ERROR_01119'
Test Files  1 failed (1)
     Tests  1 failed (1)
Duration  5.29s
(exit 1, expected: B2)
```

**One-worker repair:** retain the qualifying rerun's initial failure independently of an outcome flip, and expose it in `why` after either a pass or a second failure. Keep the record bounded and tied to the original key/run so a later failure is not confused with it. Do not label FAIL -> FAIL as flaky just to reuse the flaky-note display. Add the differing-errors public-scheduler regression above alongside the existing transient-pass and identical-persistent-error cases; preserve the one-rerun limit and restart behavior.

## Should-fix

### S1. Expired parked registrations keep full key snapshots through fresh registrations [proven, nonblocking]

**Where:** `src/core/delivery/registered.ts:135-141`, with `unpark` at `:188-191` and `recordRegisteredKeys` at `src/core/state/before-edits.ts:66`.

`registeredSinces` counts every parked slot without checking `leftTime`. When the incoming session has no parked slot, `unpark` returns before `writeParked` prunes expired slots. Registering a fresh session after the 12-hour park expiry therefore retains the expired session's entire file-key map. The probe registers/unregisters `s1` at revision 1, advances the clock by `CONSUMER_EXPIRY_MS + 1`, then registers a different session at revision 2. `registered-keys:<wt>` still has both revisions, despite the original session being unable to resume its expired registration.

This does not change delivered results. A later park/unpark write can clean the expired slots, and a following registration then drops their snapshots. It is a retention defect in the new row, not an unbounded leak under every workload. Each retained revision stores all non-null file keys, so expired references should not enlarge it unnecessarily. Filter parked references by their expiry during snapshot pruning, or expire the parked row before collecting references. Cover both fresh-session registration and resume. Worktree removal itself is correct: the row is in `WORKTREE_META_ROWS` and is deleted by exact key; the probe verifies that.

## Nits

None.

## What fits

- **011-18 lookup and wording [proven except B1]:** absent/failing/passing baselines are read from the shared results at the captured key; the three committed baseline cases pass. The baseline reader has no runner or scheduler dependency and does not queue work. Broad-scan diagnostics naming other files retain the factual closure line. Resumed registration and harness-session `why` coverage pass. Same-revision registrations share one map, parked registrations retain it, unreferenced snapshots are removed after reference cleanup, and worktree removal deletes the row. Sharing by revision has the correctness limitation in B1; parked expiry has S1.
- **Evals parser [proven]:** the committed round trips and the 36-case reviewer matrix preserve every changed delivery form, including slow provenance and pending/stale results. Semicolons in the new baseline sentence do not hide the observation revision or change.
- **011-19 selection and limits [proven; error retention incomplete in B2]:** the exception requires at least one reported test, all reported test records passing, and a file-level failure. It uses no error path or temp-root classification. Forced runs, already-spent keys and the mass-failure cap still suppress reruns; other slow failures retain their old limit. Real Vitest coverage demonstrates transient recovery in two runs, persistent failure after exactly two runs, and a real failing test in one run. The replaced failure summary survives in the flaky note for `why`. The summary says `error after its tests ran`; the unchanged `did not load` count wording is the explicitly accepted later-row residual. A same-key rerun remains counted current FAIL as accepted, while its key row is queued.
- **004-70 [proven, previous finding closed]:** `Ledger.hold` now delegates to `RunQueue.hold`, which copies priority, sequence, forced and recent flags and snapshots promotions. Restore writes all covered entries directly, including deleting entries originally absent, before restoring/publishing promotions. It does not invoke `add`, `remove` or `settle` on a partial queue. The ledger tests retain `[upper, strings]`, both live promotions, tie order and original absence. The public scheduler regression injects the real SQLite stale-write abort while a slow checkpoint is open, observes both promotions still published after rollback, and then runs upper before strings when the precondition is met. The prior setup-buffer and bootstrap residuals are outside this row and were not reopened.

## Inputs for the coordinator

Repair B1 and B2 before landing 0.1.217. The repair can keep the accepted worktree meta row, but a consumer must identify a snapshot of its own registration's keys rather than only a revision. Preserve old registrations' snapshots while new registrations at that revision can name a newer one. S1 can be repaired at the same seam or tracked separately. Keep B2's first-error record separate from whether the outcome flips; its failing rerun must retain both errors without claiming flakiness. Re-review snapshot identity, retention/resume behavior, delivery outcome and first-error visibility for both rerun outcomes, plus any changed contracts or bundles. The 004-70 queue-fidelity closure need not be reopened unless a repair changes it.
