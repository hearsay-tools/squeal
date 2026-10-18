# Wave 8.1: 004-65 step 2, slow-tier preconditions

FAIL d58e3d050d8f5c87ea9b48de3d7d2d9d9503d21e

Four proven blockers, one proven should-fix, no nits. Reviewed on 2026-10-17, detached at the pinned candidate, against `origin/main` at `719c83c2d89b0892958f1da99fddddc2700021e7` (13 commits). The verdict covers 004-65 step 2, issues #3 and #16, D2, D5, D7, D8 and D9, including the accepted amendment and D8's further amendment in `85f5cce9`. Row 004-68's setup command listing is excluded as directed.

## Verification

The candidate tree was clean throughout product verification. Review probes and their HOME/XDG directories lived outside the worktree. No probe read or wrote the real HOME. No product file was edited. `npm run build` was not run, as directed.

```text
npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities

npm run lint
Checked 1411 files in 460ms. No fixes applied.

npm run typecheck
tsc --noEmit
(exit 0)

npm run check:version -- origin/main
version bump: 0.1.211 -> 0.1.212, ok
```

The install also printed deprecation and install-script approval notices; installation exited 0.

```sh
npx vitest run --maxWorkers=4 \
  test/cli/run-all-skipped.test.ts test/cli/run-slow-skipped.test.ts \
  test/delivery/slow-told.test.ts test/harness/stop-slow-skipped.test.ts \
  test/policy/slow.test.ts test/slow/precondition-tier.test.ts \
  test/slow/precondition.test.ts test/status/slow-tier.test.ts
```

```text
Test Files  8 passed (8)
     Tests  94 passed (94)
  Duration  6.59s
```

The full run also printed two fixture gitdir-repair diagnostics, cleanup of one process left by an earlier run, and Vitest's experimental type-testing notices. It exited 0. Its counts differ from the coordinator's supplied pre-rebase result (5996 passed, 8 skipped); the counts below are this reviewer's own result.

Independent full run, using the reviewer's required gate rather than the background Squeal checkpoint:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

```text
Test Files  703 passed | 1 skipped (704)
     Tests  5995 passed | 9 skipped (6004)
  Start at  18:23:55
  Duration  820.93s
(exit 0)
```

CI run [39049127005](https://github.com/hearsay-tools/squeal/actions/runs/39049127005) identifies the exact pinned SHA. Its Node 24 job passed lint, typecheck, version-sensitive tests, build and bundle drift checks. The entire CI run subsequently completed successfully (all three Node 22 shards green; the nightly-only Node 24 full suite and the PR-only version job skipped).

**Red check on main:** archived `origin/main` into an isolated scratch repository, linked dependencies, and copied only the candidate's three relevant test files. Ran with a scratch HOME/XDG environment:

```sh
npx vitest run --maxWorkers=1 \
  test/slow/precondition-tier.test.ts test/cli/run-slow-skipped.test.ts \
  test/policy/slow.test.ts \
  -t 'skips the tier for a missing file|ends with the reason and no verdict|accepts exists globs'
```

```text
Test Files  3 failed (3)
     Tests  3 failed | 41 skipped (44)
  Duration  3.53s
(exit 1)
```

These are behavioral failures, not missing-module failures: main runs both slow files despite the missing prerequisite; `slowWaitCode` returns 0 instead of 3; the policy loader reports `unknown key "slow.precondition"`. All three pass in the candidate's touched-test run above.

The background Squeal baseline separately reported the known timing-sensitive `test/harness/opencode-dispose.test.ts` case "serve: an abort of the new turn, then the old Stop's answer, stores nothing": held Stop killed at +2129 ms, after its +2000 ms idle deadline. `squeal why` showed its historical same-input flaky record and the exact trace (`idle +0, stop +55, dispose +200, input +1251, kill +2129`). Host load was 26.60 on 24 CPUs when inspected. The baseline also reported the unchanged negative-control assertions in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119` (expected plain `pass`, received `fail`). Their `squeal why` histories show earlier failures too. These background results are separate from the independent gate above; attribution to this candidate was not proven, so they add no blocker.

## Blockers

### B1. A forced skip can still publish the old results as current [proven]

**Where:** `src/core/scheduler/slow-skip.ts:78`, with `src/core/state/slow-text.ts:143` and the existing current-file classifier in `src/core/state/slow.ts:103`.

D8 says an unmet precondition makes its files “not run at this revision” and “a skip never reads as a pass, a failure or a current file.” `#skip` only dequeues the files and abandons their checkpoint. It does not represent the skip in their validity. When a prior result already matches their unchanged keys, removing the forced pending phase makes that result current again. `skippedReason` then suppresses the skip because `notRun` is zero.

**Reproduction:** use the basic scheduler fixture with strings and upper marked slow, `maxParallel: 1`, and `precondition: { exists: ["ready"] }`. Create `ready`, run the baseline to idle (two slow files current). Delete `ready`, write and apply a revision for an unrelated file so the met-cache revision changes without moving the slow keys, then request `requestFullSuite({ force: true })` and wait for idle.

**Observed:** the checkpoint ends abandoned and raw activity is `kind: "skipped", reason: "ready matches no file (slow.precondition.exists)"`, but the header says `current: 2, pending: 0, notRun: 0`. Rendered output:

```text
Slow tier: 2 test files; 2 current at revision 0, against no declared artifact. Squeal runs them when the agent pauses.
skippedReason(header.slowTier) = null
slowWaitCode({ outcome: "quiet", result: { slowTier: header.slowTier } }) = 0
skippedLaneVerdict(store, abandonedCheckpoint) = null
```

The last three are direct calls to the production consumers with the actual scheduler header; no real CLI invocation is claimed. The header alone violates D8. The same guard also prevents delivery of the reason, and Stop sees no slow files needing validation.

**Repair:** retain the old result as historical evidence but represent skipped files explicitly so current-file counts, status, delivery, waits and Stop all agree. Clearing only the `skippedReason` guard leaves the false current counts. Test a forced skip after prior pass and prior failure, including the next met-precondition checkpoint.

### B2. A revision during a failing command check is lost [proven]

**Where:** `src/core/scheduler/slow-skip.ts:58` through `:66`; `src/core/scheduler/slow-tier.ts:200` returns after a skip before its later preemption check.

D8 requires checking a command again at every revision and running a precondition that becomes met at that checkpoint. A command check runs outside the scheduler lock. Its failed result is applied without checking that the revision and resolved rule are still the ones it checked. `revised` ran before the skip existed, so it cannot requeue it.

**Reproduction:** in the basic scheduler fixture, the precondition command captures `fs.existsSync("ready")`, writes `started`, then polls for `release` before exiting according to that captured boolean. Wait for `started` at revision 0. Create `ready`, edit `src/math.ts`, await `h.batch("src/math.ts")` (revision becomes 1), then create `release` and await scheduler idle.

**Observed:** `revision during check 0 -> 1`; after the old command exits, `slowRuns: 0`, `current: 0, pending: 0, notRun: 2`, and the old command's `exited 1` skip remains. Running that command now would exit 0, but no further check is scheduled.

**Repair:** capture and validate the revision/rule under the lock before applying an async check outcome. A superseded failed check must leave work eligible for the pump to check again, without abandoning the newer checkpoint. Add a deterministic latch-based regression, including a policy edit while a command is running.

### B3. A skipped full checkpoint omits already-current fast failures [proven]

**Where:** `src/cli/run-skipped.ts:20`.

D8 says the skipped checkpoint's verdict names the fast lane's result, “exiting 1 on known failures and otherwise 3.” `checkpoint.testFiles` contains only requested work, not files already current (`src/core/scheduler/checkpoint-requests.ts:66` and `:87`). Filtering that list loses previously current fast failures.

**Reproduction:** real basic scheduler fixture, strings and upper slow, missing `exists` precondition; make `src/math.ts` implement subtraction rather than addition. Run baseline to idle: the math check is a **current failure**, while the slow files are skipped. Request a normal, non-forced full suite and wait for idle. The actual checkpoint requests only strings and upper. Call the production `skippedLaneVerdict` on that stored checkpoint.

**Observed:**

```text
requested: [ 'test/strings.test.ts', 'test/upper.test.ts' ]
fast failure validity: 'current'
verdict: 'has no verdict: its slow lane was skipped, missing matches no file (slow.precondition.exists), so it is not a full suite; its fast lane at revision 0: no known failures'
exit code: 3
```

A second store-seeded probe independently produced the same wrong verdict. The candidate's existing test puts the fast file inside the checkpoint, which misses the normal reuse case.

**Repair:** compute the fast-lane verdict over the lane's listed files, including already-current files, while preserving the checkpoint/lane scope. Add an integration regression with a current fast failure excluded from the request, and a clean-current control.

### B4. One unchanged sibling rule hides another project's policy change [proven]

**Where:** `src/core/scheduler/slow-skip.ts:116` through `:119`.

D8's amendment in `85f5cce9` requires requeueing skipped files when their policy no longer declares the same precondition. The skip groups refs by source. `revised` uses `.some(...)` across that whole group: if any sibling still declares the global rule, it treats the entire skip as unchanged.

**Reproduction:** use the basic Vitest fixture plus a real slow node:test project `e2e`, containing `node/a.test.mjs` with one passing test. Both initially use `slow.precondition: { exists: ["missing"] }`. Run to idle, so the global skip covers the Vitest and node:test files. Reload only the policy, giving `e2e` its own `precondition: { exists: ["src/strings.ts"] }` (already met); leave the global rule unchanged for the Vitest files. Apply the policy-file revision and wait for idle.

**Observed:** node:test file remains listed, `pending: null`, with zero node:test runs. The old global skip persists. An explicit `requestSlowSuite()` afterward runs the node:test file exactly once, confirming that the replacement rule and adapter are valid; the automatic policy-change recheck is what was missed.

**Repair:** evaluate declaration changes per skipped ref and partition the group. Requeue files whose resolved precondition changed even if siblings retain the original rule; keep the original skip only for unchanged refs. Add a mixed Vitest/node:test regression plus the reverse override-to-global transition.

## Should-fix

### S1. A timed-out precondition leaves its spawned process alive [proven]

**Where:** `src/core/slow/precondition.ts:142` through `:150`.

The argv command is spawned without its own process group; timeout and close signal only its direct PID. A node wrapper that spawns another node process running an interval, writes that child's PID, and then hangs returns the timeout reason after 1000 ms, but its spawned child remains alive afterward. The child was still in `/proc` state `S` (sleeping, not a zombie) 100 ms after the returned timeout; the probe recorded `alive: true`.

The probe killed the survivor explicitly in teardown. The direct command is killed; the concern is its descendant. D7 expressly bounds the command, while D10's process-group wording expressly names slow runs rather than precondition commands. This review therefore records the demonstrated cleanup gap as should-fix, rather than expanding the blocking contract by interpretation.

**Repair:** use the existing process-isolation/termination conventions for the precondition command and clean up its descendants at timeout and daemon close. Test a wrapper that spawns a long-lived child, checking execution/liveness rather than only the returned timeout string.

## Nits

None.

## What fits

- Missing literal paths and missing globs skip cold slow files before the load guard, run no slow tests and store no current result. A failing argv command gives one reason naming its source and exit status.
- The command is invoked without a shell in the worktree root. Existing tests verify shell metacharacters remain literal arguments; an independent command read its own process priority as 10. The direct process timeout is bounded and a missing program is reported as unmet.
- An independent two-file, one-at-a-time scheduler probe verified a met command runs once per revision/rule, not once per tier: marker `x`, two slow runs.
- The ordinary missing-file-to-present revision, command-to-met revision, whole-rule policy replacement and explicit retry cases pass the candidate tests. B2 and B4 identify the additional cases that they do not cover.
- Cold skipped-tier `run --slow --wait` returns 3 and prints the reason. A skipped full checkpoint whose requested fast files include a failure returns 1; a clean fast lane returns 3.
- Delivery includes the skip in its state fingerprint and suppresses unchanged repeated reasons. Stop's waiting entries for Claude Code and Codex block with the reason without waiting out 20000 ms; `stop_hook_active` releases the next Stop; Claude Code SubagentStop blocks. The quick Stop entry also uses the shared reason.
- No declared precondition takes the unchanged gate path. Loader tests cover invalid values, bad argv/globs, unknown keys and project-specific replacement. D5's no-artifact note is suppressed before an unmet check, so the skip gives its reason instead.
- The additive policy/activity types, README and version changes fit the approved scope. The deferred setup listing is explicitly tracked as 004-68. KEY_FORMAT_VERSION 11's in-place re-pin and bundled version are included in the candidate; the verification above covers the key guard.

## Inputs for the repair wave

Keep the accepted D7/D8 contract and the setup-listing exclusion. Repair the four blockers without changing fast-tier scheduling or result-key semantics. The critical order is: check an eligible slow tier, validate the async outcome against the live revision/rule under the lock, then publish a per-file honest skip or run. Recheck changed declarations per ref. The CLI's skipped-lane verdict must include the current fast lane even when no fast file needs queueing. Add the prior-result and concurrent-revision cases to the scheduler tests and verify all shared surfaces consume the resulting skip consistently. Process-tree cleanup is a separate, bounded follow-up unless the coordinator folds S1 into that repair.


## Re-review

FAIL 1fb4855d5d46b6d6912503465979dd5484f04ce5

One unresolved proven blocker, B1. B2, B3, B4 and S1 are closed. No new should-fix items or nits. Reviewed detached at the pinned `cand/0.1.214` on 2026-10-17, against `origin/main` at `d39572deb7a16723d8da46004174870850eb79cf` (0.1.213). This round covers the prior findings and repair 1's fix scopes, including the explicitly requested residual-header judgment and restart behavior. It does not reopen the setup-listing exclusion or the rest of the original review.

### Verification

Product verification ran on the clean pinned tree. No product file changed. Probe sources, evidence and HOME/XDG directories were under `/tmp/c93-review-probes*`; probe git identity was supplied explicitly. Scheduler fixture copies used the existing git-ignored fixture scratch directory. No probe touched the real HOME. `npm run build` was not run, as directed. The independent full run below is the required reviewer gate, not a Squeal checkpoint.

```text
npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
(exit 0)

npm run lint
Checked 1424 files in 489ms. No fixes applied.
(exit 0)

npm run typecheck
tsc --noEmit
(exit 0)

npm run check:version -- origin/main
version bump: 0.1.213 -> 0.1.214, ok
(exit 0)
```

The install also printed deprecation and install-script approval notices.

Touched tests and the complete `test/slow` directory:

```sh
npx vitest run --maxWorkers=2 test/slow test/status/slow-tier.test.ts \
  test/cli/run-all-skipped.test.ts test/cli/run-slow-skipped.test.ts \
  test/delivery/slow-told.test.ts test/harness/stop-slow-skipped.test.ts \
  test/policy/slow.test.ts
```

```text
Test Files  17 passed (17)
     Tests  145 passed (145)
Start at  22:15:02
Duration  14.21s
(exit 0)
```

Independent full run:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

```text
Test Files  714 passed | 1 skipped (715)
     Tests  6054 passed | 10 skipped (6064)
Start at  22:12:05
Duration  917.30s
(exit 0)
```

The run printed two fixture gitdir-repair diagnostics, cleanup of one process left by an earlier run, and Vitest's experimental type-testing notices. The OpenCode deadline case passed in this independent run. Observed host load ranged from about 15 to 46 on 24 CPUs during verification.

CI run [39065621229](https://github.com/hearsay-tools/squeal/actions/runs/39065621229) completed successfully on the exact pinned SHA: all three Node 22 shards and the Node 24 lint/typecheck/version-sensitive job passed. The Node 24 job also passed build and bundle-drift verification. The nightly full-suite and PR-only version jobs were skipped.

Independent probes, using the real scheduler/adapters and production consumers, with scratch HOME/XDG and one worker:

```sh
npx vitest run --config /tmp/c93-review-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/c93-review-probes/review.test.ts
```

```text
Test Files  1 passed (1)
     Tests  11 passed (11)
Start at  22:18:36
Duration  22.29s
(exit 0)
```

Those probes verify the repaired behavior and explicitly record the residual current states; they do not assert that D8 is fully met. Two further probes assert D8 itself, using the same scheduler fixture and default baseline on restart:

```sh
npx vitest run --config /tmp/c93-review-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/c93-review-probes/residual.test.ts
```

```text
D8 residual: skipped files must not remain current in main header
AssertionError: expected 5 to be 3

D8 residual: restart must not publish a completed full suite over persisted skips
AssertionError: expected true to be false

Test Files  1 failed (1)
     Tests  2 failed (2)
Duration  4.39s
(exit 1)
```

These are behavioral failures on the pinned candidate, not import/setup failures. The fixtures, runners and stores closed during teardown; no probe remains in the committed tree.

The background Squeal baseline separately reported the known `test/harness/opencode-dispose.test.ts` deadline case: kill at +2030 ms against its +2000 ms idle deadline (row 008-38). Its same-input rerun also missed the deadline (+2168 ms). Background Squeal additionally reported the unchanged negative controls at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, both already named in the first review. These are separate from the independent gate and add no proven finding against the repair.

### B1 remains blocking: the same skipped files still read current, and restart can certify a full suite [proven]

**Where:** `src/core/scheduler/slow-skip.ts:99` through `:105`, `src/core/state/slow.ts:109` through `:113`, `src/core/state/header.ts:75` through `:82`, and `src/core/scheduler/bootstrap.ts:139` through `:177`. The key-only check classifier remains at `src/core/state/derive.ts:54` through `:55`; `shown-result.ts` preserves the corresponding result lookup.

The repair correctly makes the slow-tier line and its skip-specific readers say not run. It does not make the stored known states historical. `#skip` dequeues and publishes a separate meta row; the special classifier in `slow.ts` consults it, while the main header still counts the unchanged `current` known states. This is the residual named by the worker, now reproduced independently.

**Reproduction:** in the basic real-scheduler fixture, mark strings and upper slow with an `exists: ["ready"]` precondition. Create `ready` and let the baseline run. Remove `ready`, apply a revision for an unrelated file, then request a forced full checkpoint and wait for idle. Repeat with upper failing before the skip. Neither slow key changes, and both forced checkpoints end abandoned without rerunning the two slow files.

**Observed in both cases:** four slow check states, two file checks and two tests, still have `validity: "current"`. In the failing case one of those tests still has `outcome: "fail", validity: "current"`. The production header prints:

```text
Revision 1: 11 current (6 tests, 5 test files loaded), 0 pending, 0 stale, 0 unknown.
Slow tier: 2 test files; 2 not run at revision 1, skipped: ready matches no file (slow.precondition.exists).
```

Commit decoration and the trailing command guidance are omitted above. A direct contract assertion expecting only the three fast file checks to count current fails: `expected 5 to be 3`. This is not merely a disagreement between test-level and file-level units: the main header explicitly counts the skipped files' own file checks as current.

**Restart consequence:** after that forced skip, close the scheduler, runner and SQLite store; reopen the store and create/start a new scheduler with the same policy and missing `ready`. The meta row survives, is adopted, and the slow-tier line still says both files are skipped. But bootstrap's lookup finds their old matching results, creates an empty baseline checkpoint, and completes it. The production header now says:

```text
Revision 2: 11 current (6 tests, 5 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 2.
Slow tier: 2 test files; 2 not run at revision 2, skipped: ready matches no file (slow.precondition.exists).
```

The assertion `fullSuite.atCurrentRevision === false` fails with `expected true to be false`. This reproduces with default baseline policy as well as `lookup-only`. It is the same unresolved B1 boundary, now exposed by the persisted-skip restart path explicitly assigned to this round.

**Judgment:** blocking under unchanged D8: “a skip never reads as a pass, a failure or a current file,” and a checkpoint with a skipped slow lane “is not a full suite.” The last status amendment expressly keeps D8 as written. The repair brief's ownership exclusion for `derive.ts` and `shown-result.ts` constrained the worker; it did not waive that contract. A correct slow-tier line does not make the contradictory main header or completed checkpoint honest.

**Remaining repair scope:** make the per-file skip constrain the shared effective state and header/status/failure readers, while keeping the result as history and preserving result-key semantics. Carry the same constraint through bootstrap/checkpoint completion so lookup hits cannot certify skipped files. Keep the repaired slow-tier/Stop behavior and forced requeue on retry. Add assertions over main-header file counts, prior failing state validity and full-suite status across close/reopen, followed by a met checkpoint that restores current state and completes normally.

### Findings closed and behavior retained

- **B1's slow-specific portion [proven fixed]:** forced skip after prior pass and prior fail gives `current: 0, pending: 0, notRun: 2`, the reason, exit 3 for the slow wait, and an abandoned checkpoint. Creating `ready` with no revision and requesting a normal full checkpoint runs both files and clears the skip; the checkpoint completes. The candidate also covers the revision-triggered and explicit `run --slow` lifts. Stop's skipped-tier cases and both harnesses pass, including a stored prior pass.
- **B2 [proven fixed]:** a command latches its initial missing-ready result. A revision or replacement policy applied before releasing it causes that old outcome to be dropped. The two slow files run under the live rule; neither retains the old skip. The newer requested checkpoint completes.
- **B3 [proven fixed]:** a real scheduler has an already-current fast failure outside a non-forced checkpoint's requested files. Only strings and upper are requested. `skippedLaneVerdict` includes the fast failure and returns 1; the identical clean control returns 3 and says no known failures. Fast/slow-only lane boundaries remain covered by the touched tests.
- **B4 [proven fixed]:** with real Vitest and node:test adapters, changing only node:test from the global unmet rule to its own met rule runs it exactly once while the two Vitest files remain skipped. Removing an unmet node:test override under a met global rule runs it once and leaves all three files current.
- **S1 [proven fixed]:** a node wrapper spawns an interval-running child and records its PID. Timeout and abort-on-close both stop the child from executing, checked through `/proc` with the production liveness helper. The candidate test also covers cleanup when the command itself exits successfully.
- **Skip persistence [proven, with the B1 checkpoint limitation above]:** `slow-skips:<worktree>` contains both refs and the original rule/reason, survives closing/reopening the SQLite store, is adopted by a fresh scheduler, stays through an unrelated revision, and is deleted after a relevant revision makes the condition met and both files run. It does not depend on the old activity row. The prefix is registered in `WORKTREE_META_ROWS`.

### Inputs for the coordinator

B1 remains the only blocker. The async-check, fast-lane verdict, per-ref policy requeue and process-group repairs need no redesign from this review. Keep the existing D7/D8 behavior and row 004-68's exclusion. This is the second review verdict; the process's disposition of a second FAIL belongs to the coordinator and the human.

## Third round

FAIL fc0b4ef8c0a06f3263a1abef70767d609980d1ea

One proven B1 blocker remains at the publication boundary. No additional should-fix items or nits. The settled-state and restart defects from the re-review are fixed. This human-authorized third round covers B1 alone, the repair-2 delta and its callers. B2-B4, S1, row 004-68 and the other original findings stay closed or excluded. Reviewed across 2026-10-17/18 at the exact pinned candidate, against the supplied main commit `82f57951` (0.1.213).

### Verification

Product verification ran on the clean `fc0b4ef8` tree. No product file was edited. `npm run build` was not run, as directed. Probe sources, fixture repositories, HOME and XDG config/cache/data directories lived under `/tmp/004-65-third-probes`; git author and committer identity was explicit. Probes used a separate SQLite connection and, for the blocking observation, the candidate's committed Claude Code CLI in a separate process. No probe used the real HOME.

```text
npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
(exit 0)

npm run lint
Checked 1443 files in 449ms. No fixes applied.
(exit 0)

npm run typecheck
tsc --noEmit
(exit 0)

npm run check:version -- origin/main
version bump: 0.1.213 -> 0.1.214, ok
(exit 0)

npm run check:version -- 82f57951
version bump: 0.1.213 -> 0.1.214, ok
(exit 0)
```

Installation also printed the existing deprecation and install-script approval notices. The local `origin/main` ref had advanced to `9e31be27` when inspected during the gate; the second version check explicitly covers the supplied comparison commit. This does not change the pinned candidate or the review scope.

Touched tests and their slow-tier integration callers:

```sh
npx vitest run --maxWorkers=2 test/slow test/state/sink-slow-skip.test.ts \
  test/status/slow-tier.test.ts test/cli/run-all-skipped.test.ts \
  test/cli/run-slow-skipped.test.ts test/delivery/slow-told.test.ts \
  test/harness/stop-slow-skipped.test.ts test/policy/slow.test.ts
```

```text
Test Files  18 passed (18)
     Tests  149 passed (149)
Start at  23:52:03
Duration  14.46s
(exit 0)
```

Independent full run, under the shared-host full-run lock:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

```text
Test Files  721 passed | 1 skipped (722)
     Tests  6115 passed | 10 skipped (6125)
Start at  23:52:03
Duration  877.21s
(exit 0)
```

The run printed two fixture gitdir-repair diagnostics, cleanup of one process left by an earlier run, and Vitest experimental type-testing notices. Host load observed during verification ranged from about 10 to 53 on 24 CPUs.

Background Squeal separately reported the unchanged negative controls in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, both already recorded in the first and second reviews. Those background results do not establish a repair regression and add no B1 finding. They are separate from the independent gate above.

The isolated settled-state matrix used the real scheduler, Vitest adapter and production status, why, failure-history and delivery readers. Four cases cover prior pass/fail results crossed with default/lookup-only bootstrap. Each actually closes the first scheduler, adapter and SQLite connection before reopening, retries normal and forced full checkpoints while unmet, and then requests a met full checkpoint without another revision.

```sh
npx vitest run --config /tmp/004-65-third-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/004-65-third-probes/review.test.ts
```

```text
Test Files  1 passed (1)
     Tests  4 passed (4)
Start at  23:55:35
Duration  8.52s
(exit 0)
```

The boundary probe is separate from that passing matrix. It asserts that a reader cannot count the skipped checks current after the actual skip-meta write, before the subsequent ledger commit:

```sh
npx vitest run --config /tmp/004-65-third-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/004-65-third-probes/atomic.test.ts
```

```text
prior fail=false: AssertionError: expected 5 to be 3
prior fail=true:  AssertionError: expected 5 to be 3
Test Files  1 failed (1)
     Tests  2 failed (2)
Start at  23:58:26
Duration  7.85s
(exit 1)
```

Both failures are behavioral assertions against the pinned candidate. The shipped CLI returned valid status JSON and exited 0. The fixture's eventual forced checkpoints correctly ended abandoned; teardown closed the schedulers, adapters and stores.

### B1 remains blocking: publishing the skip exposes current checks before their refresh [proven]

**Where:** `src/core/scheduler/slow-skip.ts:91`, especially `:103` through `:106`; `src/core/state/slow-skipped.ts:33`; `src/core/store/store.ts:93`; `src/core/scheduler/ledger.ts:481` through `:526`.

The new ordering makes the sink consult the right skip after `ledger.commit()`, but the skip publication and that commit are separate SQLite transactions. `#skip` dequeues the files in memory, calls `checkpoints.failed`, writes `slow-skips:<worktree>` through `#publish()`, and only then calls `ledger.commit()`. The meta write is already committed when the sink has not yet reclassified the stored known states or persisted the dequeued key rows. The scheduler mutex does not exclude independent status or hook readers.

**Reproduction:** run the basic scheduler fixture with strings and upper slow and `exists: ["ready"]`. Create `ready` and let the baseline finish. Remove it, apply an unrelated revision so the previously met precondition is not cached, and request a forced full checkpoint. Wrap the store's public `meta.set` only to pause immediately after the real write of `slowSkipsMetaKey(worktreeId)`. While the writer is paused, spawn the candidate's committed `plugins/claude-code/dist/cli/squeal.mjs status --json` with cwd the fixture and scratch HOME/XDG. The wrapper neither changes the written data nor advances another scheduler step. It deterministically takes the reader turn that another process can take between those two commits:

```ts
const set = h.store.meta.set.bind(h.store.meta);
h.store.meta.set = (key, value) => {
  set(key, value); // actual committed write, unchanged
  if (key !== slowSkipsMetaKey(h.worktreeId)) return;
  const child = spawnSync(process.execPath, [candidateCli, "status", "--json"], {
    cwd: h.root, env: process.env, encoding: "utf8",
  });
  expect(child.status).toBe(0);
  observed = JSON.parse(child.stdout);
};
await h.scheduler.requestFullSuite({ force: true });
await h.scheduler.idle();
// A transaction may still expose the old unskipped snapshot here.
if (observed.slowTier.current === 0) {
  expect(observed.fileLevelCounts.current).toBe(3); // receives 5
}
```

**Observed, prior pass and prior fail:** the committed skip lists strings and upper with `ready matches no file (slow.precondition.exists)`, but the CLI reports:

```json
{
  "counts": { "current": 11, "pending": 0, "stale": 0, "unknown": 0 },
  "fileLevelCounts": { "current": 5, "pending": 0, "stale": 0, "unknown": 0 },
  "slowTier": { "testFiles": 2, "current": 0, "pending": 2, "notRun": 0 }
}
```

The prior-failure variant also reports upper's known failure with `validity: "current"`. The slow tier reads pending because its key rows still carry the forced queue; under the repair's own classifier these checks should therefore read pending, never current. After the next commit they do correctly become stale and only the three fast file checks count current. This is an externally readable committed database state, demonstrated by a separate shipped CLI process, not an inferred race or a missing-module probe failure. The same known-state rows feed the main header, failure readers and deliveries.

**Judgment:** B1's D8 requirement remains broken: “a skip never reads as a pass, a failure or a current file.” The repaired steady state does not make the intermediate committed snapshot honest. This is the same skip-to-shared-state boundary assigned to this round, not a reopening of the other findings.

**Repair sized for one worker:** publish the skip and persist its dequeued key rows plus sink reclassification in one enclosing store transaction. Keep publication before refresh inside that transaction, with the result rows untouched. Include any checkpoint writes that expose the same state in the atomic change. Add a regression using an independent SQLite/CLI reader at the publication boundary: before commit it sees the previous unskipped state, after commit it sees the skip with only three fast file checks current and the prior slow failure non-current. A reader must never see the skip paired with the old current states. No precondition, Stop, fingerprint or result-key redesign is needed.

### What is fixed, and the two worker open points

- **Settled effective states [proven fixed]:** main header and status count three current file checks after a skip, not five. All four stored slow checks are stale, including a prior failure. `why` labels them stale and retains their historical results; the failure-history command retains original revision/run provenance without claiming current validity. New registrations and an actual failure delta carry stale validity too. The normal and forced retries remain abandoned while unmet.
- **Restart certification [proven fixed]:** after actual adapter/store close and reopen, both default and lookup-only baseline policies leave `fullSuite.atCurrentRevision` false, two slow files not run, no current slow checks and no new slow execution. A met explicit checkpoint then runs both files, clears the persisted skip, restores all five current file checks and completes as a full suite, under both policies and with either prior outcome.
- **Persisted skip not queued at start [not required by D8, no additional blocker]:** restart is not one of D8's declared recheck triggers. The skip remains visible and the new baseline cannot certify it. A relevant revision or explicit slow/full request still checks it again. Queuing it at every start would add a trigger; it is not needed to close the assigned false-current/full-suite defect.
- **Scheduler `files.ts` classifier still says current [no separate proven break]:** it remains a predicate over in-memory key/results, not the effective stored validity the public readers expose. Normal full requests call `SlowTier.recheck()` before filtering by that classifier; recheck forces skipped key hits into the queue. Slow requests likewise recheck first, and bootstrap now explicitly includes skipped hits and fails their baseline membership. The tested normal/forced/restart paths do not complete over a persisted skip through this classifier. Keep those safeguards; changing this predicate alone would require updating the forcing logic that currently uses it. This does not excuse the independently proven publication window above.

### Inputs for the coordinator

One B1 blocker remains, confined to atomic publication of the skip and the derived state it governs. Retain repair 2's classifier, bootstrap handling and the closed findings. The third-round disposition belongs to the coordinator and human; this reviewer changed no product code.


## Fourth round

FAIL cc4d94017ced4841c9b108349b36f5ae3c3ccb33

Two proven regressions in transaction-error handling block this candidate. No additional should-fix items or nits. Successful skip, lift and requeue publication is atomic and closes the third-round visibility window. The added transaction boundaries, however, lose retry state on a busy requeue and roll back a checkpoint end after its in-memory tracker has discarded it. This human-authorized fourth round covers only repair 3 and what its transaction now encloses. B2-B4, S1, 004-68 and the other original findings remain closed or excluded. Settled-state behavior is revisited below only where the added transaction causes a regression.

Reviewed on 2026-10-18 at the exact pinned candidate, against local `origin/main` at `b1a97cbd06455b9ed95b01b3fbc0584b4624cbb1` (0.1.213). The supplied 1a28cb64-equivalent repair is `5eeb453446b5bcb8f19932823b99f8e3b143af2a` here. The other source delta from the third-round pin is the key-source hash re-pin.

### Verification

The pinned product tree remained clean throughout verification. No product file was edited, and `npm run build` was not run, as directed. Probe code, fixture repositories, copied control sources and HOME/XDG directories lived under `/tmp/004-65-fourth-probes`; probe git author/committer identity was explicit. Fixture dependency resolution used a symlink to the candidate's installed `node_modules`. No probe read or wrote the real HOME.

```text
npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
(exit 0)

npm run lint
Checked 1443 files in 555ms. No fixes applied.
(exit 0)

npm run typecheck
tsc --noEmit
(exit 0)

npm run check:version -- origin/main
version bump: 0.1.213 -> 0.1.214, ok
(exit 0)
```

Installation also printed the existing deprecation and install-script approval notices.

Touched tests and their slow-tier callers:

```sh
npx vitest run --maxWorkers=2 test/slow test/state/sink-slow-skip.test.ts \
  test/status/slow-tier.test.ts test/cli/run-all-skipped.test.ts \
  test/cli/run-slow-skipped.test.ts test/delivery/slow-told.test.ts \
  test/harness/stop-slow-skipped.test.ts test/policy/slow.test.ts
```

```text
Test Files  18 passed (18)
     Tests  150 passed (150)
Start at  09:19:26
Duration  14.82s
(exit 0)
```

Independent full run under the shared-host lock, not a Squeal checkpoint:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

```text
Test Files  721 passed | 1 skipped (722)
     Tests  6117 passed | 9 skipped (6126)
Start at  09:19:26
Duration  848.68s
(exit 0)
```

The full run printed two fixture gitdir-repair diagnostics, cleanup of one process left by an earlier run, and Vitest experimental type-testing notices. Observed host load ranged from about 8 to 34 on 24 CPUs.

Independent probes use the real scheduler, adapter, ledger, state sink and store. The successful-publication matrix also drives `SlowSkips` directly over the real ledger captured from an idle scheduler, with both prior pass and prior fail results. A second SQLite connection reads each snapshot in one `readTransaction`; the committed Claude Code CLI runs `status --json` in a separate process at skip-meta writes/deletes and after each operation. Observations before/after nested transaction returns include checkpoint ending, key rows, known states and headers.

```sh
# HOME and XDG config/cache/data point below /tmp/004-65-fourth-probes;
# GIT_AUTHOR_* and GIT_COMMITTER_* are supplied explicitly.
npx vitest run --config /tmp/004-65-fourth-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/004-65-fourth-probes/boundaries.test.ts \
  -t 'commit boundaries|public scheduler'
```

```text
public scheduler: a rolled-back skip must still end its requested checkpoint
AssertionError: expected null to be 'abandoned'

public scheduler: a busy requeue cannot certify a skipped full suite on retry
AssertionError: expected 'completed' to be 'abandoned'

Test Files  1 failed (1)
     Tests  2 failed | 2 passed | 2 skipped (6)
Start at  09:24:14
Duration  7.02s
(exit 1)
```

Background Squeal separately reported the unchanged negative controls at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, already recorded in the earlier rounds. Those background results do not establish a repair-3 regression and are separate from the independent gate.

Both failures are behavioral assertions on the pinned product, with successful fixture setup and teardown. An earlier direct-ledger probe independently reproduced the forgotten checkpoint after a sink throws following its actual refresh; that extra test is deselected in the run above.

**Pre-repair controls:** copy the candidate's `src` under `/tmp`, restore only `src/core/scheduler/slow-skip.ts` from `fc0b4ef8`, and point identical public-scheduler probes at that copy. All other sources, dependencies, fixture setup and fault conditions stay the same. This isolates the added transaction boundary, rather than attributing an existing error-handling problem to the repair.

```sh
npx vitest run --config /tmp/004-65-fourth-probes/vitest.config.mts \
  --maxWorkers=1 /tmp/004-65-fourth-probes/control-boundaries.test.ts \
  -t 'public scheduler'
```

```text
Test Files  1 passed (1)
     Tests  2 passed | 4 skipped (6)
Start at  09:23:36
Duration  3.68s
(exit 0)
```

### R1. A busy requeue loses the skip in memory and the next full request certifies skipped files [proven, blocking]

**Where:** `src/core/scheduler/slow-skip.ts:175` through `:179`, with the newly added outer transaction at `:191`; consumed by `src/core/scheduler/scheduler.ts:338` and `src/core/scheduler/checkpoint-requests.ts:67`.

`recheck()` clears the adopted skip map before `#requeue()` enters its new `BEGIN IMMEDIATE`. If a second writer holds the database, that BEGIN can throw before `settle` or `enqueue` runs. The persisted skip survives, but the in-memory skip map is empty and no slow file was queued. On the next normal full request, `recheck()` finds no skip, and the scheduler's key/result classifier still calls those idle files current. The request therefore completes with no files, certifying a full suite over the persisted skip. This is a new path around the safeguard the third round found sufficient; the classifier itself has not changed.

**Reproduction through public scheduler methods:**

1. Run the basic fixture with strings and upper slow and `exists: ["ready"]`; both get stored results. Remove `ready`, apply an unrelated revision, then request a forced full suite and await idle. It ends abandoned with two slow files skipped.
2. Open a second connection to the same database and hold `BEGIN IMMEDIATE`. Set the scheduler connection's `PRAGMA busy_timeout=25` to shorten the probe; a writer held past the normal timeout has the same outcome. `await scheduler.requestFullSuite()` rejects with the real SQLite `database is locked` error. Release the other writer with `ROLLBACK`.
3. Retry `await scheduler.requestFullSuite()` without forcing and await idle. Read status through the independent connection.

**Observed:**

```json
{
  "checkpoint": "completed",
  "requested": [],
  "persistedSkips": 1,
  "fullSuite": { "atCurrentRevision": true, "lastCompletedRevision": 1 },
  "slowTier": {
    "testFiles": 2, "current": 0, "pending": 0, "notRun": 2,
    "skipped": "ready matches no file (slow.precondition.exists)"
  }
}
```

No fault was injected into the scheduler or ledger here: the second connection holds a real write lock. With only the pre-repair `slow-skip.ts` restored, retry requests strings and upper, ends abandoned and leaves `fullSuite.atCurrentRevision: false`. Before repair 3, files were enqueued before the ledger tried to acquire its transaction, so this failure did not lose the queue as well as the skip map.

**Contract:** D8 says a skipped slow lane is not a full suite. This candidate reintroduces false certification specifically through the added transaction's failed BEGIN; it is within the requested nesting/rollback review.

**Repair sized for one worker:** make removal from the adopted skip map and the requeue transition recover together on failure, including failure to begin the transaction. Preserve the persisted skip and the ability to retry if the transaction does not commit. Merely moving `skips.clear()` inside the callback handles a failed BEGIN but still needs restoration for a later rollback. Add the real-second-writer regression above; include the shared `revised` path when preserving its partitioned map.

### R2. Rolling back the enclosed checkpoint end forgets the still-open checkpoint [proven, blocking]

**Where:** `src/core/scheduler/slow-skip.ts:96` through `:109`, especially `ledger.checkpoints.failed(ref)` at `:102`, together with `src/core/scheduler/checkpoints.ts:251` through `:259` and `src/core/scheduler/ledger.ts:445` through `:518`.

The outer transaction now includes `checkpoints.failed()` and its final `finish("abandoned")`. The tracker clears `#active` before writing the end; the ledger also drains its dirty buffers before its nested transaction. If the nested sink fails, SQLite rolls back the checkpoint end and its progress writes along with the skip and key refresh. Those in-memory mutations do not roll back. The tracker no longer owns the still-open stored checkpoint, so retrying the operation and closing the scheduler both leave its `end` null.

**Reproduction through the public scheduler:** prepare the prior-results fixture as in R1, without any skip yet. Install a temporary trigger on the writer connection, then request a forced full checkpoint:

```sql
CREATE TEMP TRIGGER review_sink_error
BEFORE INSERT ON known_states
WHEN NEW.validity = 'stale'
BEGIN
  SELECT RAISE(ABORT, 'review injected SQLite sink error');
END;
```

This induces a real SQLite error only when the sink writes the skip's stale state, after the checkpoint-ending code has run. The pump reports that error and becomes idle. Drop the trigger, request another full checkpoint, await idle, then close the scheduler.

**Observed:** immediately after rollback, the original checkpoint has `end: null`, no skip is committed, and the database's two slow key rows remain queued. The next request ends abandoned and commits the skip, but the original checkpoint still has `end: null`. It remains null after scheduler close. The extra direct-ledger probe confirms `ledger.checkpoints.active === null` despite that open database record. The same fault with only the pre-repair `slow-skip.ts` restored leaves the original checkpoint abandoned before retry and after shutdown, so this is a regression in the newly enclosed checkpoint ending.

**Contract:** D8 says a skipped checkpoint is abandoned rather than completed; the checkpoint contract also ends failed tiers abandoned. SQLite rollback alone is insufficient when the tracker has forgotten the operation's still-open record. A caller awaiting that original request never receives its checkpoint end.

**Repair sized for one worker:** retain or restore the ledger/checkpoint/skip state needed to retry a rolled-back operation, or invalidate and reconstruct it from the committed store before permitting further work. Keep the skip, checkpoint end, keys and sink writes in the same database transaction. Add the temporary-SQLite-error regression and verify both retry and shutdown settle the original checkpoint; do not fix this by committing the checkpoint early again.

### What fits

- **Successful skip publication is atomic [proven]:** at the skip-meta write and every nested transaction return, the independent reader sees the old unskipped snapshot. After the outer commit it sees the skip, the abandoned checkpoint, dequeued key rows and stale slow checks together. Only three fast file checks remain current. Both prior-pass and prior-fail cases pass; the shipped CLI agrees.
- **Successful lift is atomic [proven]:** lifting a met skip with idle files exercises `touch`, `settle` and sink refresh. Independent reads during deletion and nested commits retain the old skip and stale states. After outer commit the skip is absent and all five file checks are current; the lifted slow checks are current. No wrongly stale lifted snapshot was observed.
- **Successful requeue is atomic [proven]:** independent reads through the ledger savepoint and skip deletion retain the old skipped snapshot. After outer commit the skip is absent, the slow key rows are queued and all four stored slow check states are pending. No skipped current check was observed.
- The committed "commit together" regression passes in the touched-test run. Savepoint release itself does not expose uncommitted writer state. The proven regressions are error recovery around that nesting, not SQLite's savepoint visibility.

### Inputs for the coordinator

Keep the single database transaction and its internal publication/refresh order. The repair needs transaction-aware in-memory state or explicit recovery, with both failure-before-BEGIN and failure-after-checkpoint-ending covered. No precondition, status wording, result-key or classifier redesign is required. This review changes no product code and does not reopen the other findings.
