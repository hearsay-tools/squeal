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
