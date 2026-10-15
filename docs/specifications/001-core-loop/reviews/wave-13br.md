# Wave 13br: review of candidate 0.1.185

## Verdict and verification

**FAIL** `ed3ce731d01dce0b77e967b0e973cc4ca262b16c`: **2 proven blockers, 0 should-fix, 0 nits**.

Board row 001-394 reviews 001-378, range `74d6e4e0..ed3ce731`, against 001 D11 Capacity (Runner ceiling and Priority, amended in this candidate), 001 D3 and 004 D2. Inputs include `tasks/001-378/notes.md`, P1, its decisions and the accepted 001-393 polling gap. This is an original review, not a re-review of prior findings.

`git rev-parse HEAD` matched the full candidate SHA. Initial `git status --short` was empty. Node 24.21.0, Vitest 5.0.3, Linux. The build changed four bundles (B1); that diff was saved and only those generated changes were restored to the candidate before the independent suite started. All source probes used a temporary `XDG_CONFIG_HOME`, temporary fixtures and private logs. No probe read the user's Squeal configuration. The probes ran against this candidate's freshly compiled `dist` code; the key probe imported the guarded source directly.

Verification output excerpts:

```text
$ npm ci
added 196 packages, and audited 197 packages in 20s
found 0 vulnerabilities
# npm also reported six dependency install scripts not covered by allowScripts.

$ npm run lint
> squeal@0.1.185 lint
> biome check .
Checked 1223 files in 1522ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.185 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.185 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.185 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git diff --stat
 plugins/claude-code/dist/cli/squeal.mjs | 340 ++++++++++++++++----------------
 plugins/codex/dist/cli/squeal.mjs       | 340 ++++++++++++++++----------------
 plugins/opencode/dist/cli/squeal.mjs    | 340 ++++++++++++++++----------------
 plugins/pi/dist/cli/squeal.mjs          | 340 ++++++++++++++++----------------
 4 files changed, 680 insertions(+), 680 deletions(-)

$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/harness/plugin.test.ts:149
FAIL test/harness/codex/plugin.test.ts:239
FAIL test/harness/opencode/package.test.ts:53
FAIL test/harness/pi/package.test.ts:51
  cli/squeal.mjs differs from the build: expected false to be true
FAIL test/keys/key-index.test.ts:202
  expected 1564.1333920000034 to be less than 1000
Test Files  5 failed | 580 passed | 1 skipped (586)
Tests       5 failed | 4841 passed | 10 skipped (4856)
Start at    02:26:40
Duration    1499.89s (tests 97%, import 2%)
exit 1
```

The first locked command exited 143 before Vitest printed anything. The coordinator confirmed that it accidentally matched that command when terminating its own gate. It is **unverified**, not a candidate failure; the restarted command above is the independent full run. No Squeal checkpoint stands in for it.

The timing failure in `test/keys/key-index.test.ts` is outside the candidate range. A file-only invocation with a temporary `XDG_CONFIG_HOME` passed while the independent full run was still active; host one-minute load at launch was 128.50. This is the file that failed the suite and passed alone. Load is context, not a demonstrated cause.

```text
$ env -u CODEX_SESSION_ID XDG_CONFIG_HOME=<temporary-directory> GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/keys/key-index.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       12 passed (12)
Duration    15.19s
exit 0
```

The independent run completed on the pinned candidate with an empty tracked diff. Its four bundle comparison failures are B1. Its remaining failure is the timing test above, not another wave finding. All six new width tests and the new process-priority test passed in that run. The host has 24 CPUs; sampled one-minute load during the run ranged from 59.44 to 176.36 and was 67.71 at completion. Only one full suite completed; the single-file follow-up was not a second full suite. No other independently failing file passed alone in this review.

## Blockers

### B1. Proven: committed CLI bundles drift after a clean install and build

**Locations:** `plugins/claude-code/dist/cli/squeal.mjs:12520` and the corresponding CLI bundles under `plugins/codex/dist`, `plugins/pi/dist`, `plugins/opencode/dist`.

**Contract:** the repository requires the committed bundles to match `npm run build`; `.github/workflows/ci.yml:42` runs the byte-for-byte drift gate. The reviewer verification also requires the build to leave the tree clean. This candidate newly violates both; the base's dependency paths are `node_modules/...`.

**Probe:** from clean `ed3ce731`, run `npm ci`, `npm run build`, then `git diff --exit-code -- plugins/claude-code/dist plugins/pi/dist plugins/opencode/dist`. The build exits 0 but changes all four CLI bundles. Each of the committed files equals its rebuilt counterpart exactly after replacing the literal `../sq-int-182/node_modules/` with `node_modules/` in the committed bytes. This was checked for all four files, not inferred from one hunk. The coordinator independently confirmed it built with `node_modules` symlinked into another tree.

**Failure:** a normal checkout with its own installed dependencies fails CI's drift gate and the committed-bundle comparison tests. This is packaging drift, not evidence that the runner implementation differs from the built source.

**Worker-sized fix:** rebuild the candidate using a real lockfile install in that checkout and commit the four regenerated CLI bundles. Keep the assigned version consistent with the coordinator's rebase/version rules. Verify `npm run build` followed by an empty tracked diff and the bundle comparisons. Do not rewrite the output paths by hand.

### B2. Proven: applying the slow project's ceiling leaves slow files queued inside Vitest across close or edit

**Changed boundary:** `src/runners/vitest/adapter.ts:417`, `src/runners/vitest/width.ts:16`. **Caller seam:** `src/core/scheduler/slow-tier.ts:368` to `:386`; `src/core/daemon/daemon.ts:407` to `:415`.

**Spec quote, 004 D2:** “A slow tier of several files starts them all at once ... so no file of it starts after an edit or a close”. New 001 D11 correctly requires the slow instance to respect the project's own ceiling. That requires the selection boundary to respect it as well.

**Scenario:** an idle scheduler with `slow.maxParallel: 4`, `slow.maxWorkers: 2`, sufficient permits and a Vitest project whose `maxWorkers` is 2 selects four files and receives a grant of 8. Previously the creation override widened that project to 4. Now `Widths.apply` correctly keeps 2, but the selector still submits all four files to a single run. The second pair waits inside Vitest, outside the scheduler's between-tier eligibility checks. An edit or close after the first pair starts does not prevent the second pair from starting later; the running tier is allowed to finish. A slow file can be arbitrarily long, so this extends shutdown and the work that starts after a fast edit by another pair's runtime.

**Discriminating probe:** create four fork-pool files in a temporary fixture with project `maxWorkers: 2`. Each test appends `{ file, startedAfterBoundary }` to a log, then waits for an external release file. Open `createVitestAdapter({ root, maxWorkers: 4 })` and run all four with `workers: 8`. Wait until two starts are logged. Write the boundary marker, request `adapter.close()` without awaiting it, and create the release file. Await the run and close. Actual output:

```json
{"projectMaxWorkers":2,"slowInstanceMaxWorkers":4,"grant":8,"tierFiles":4,"startedBeforeClose":2,"startedAfterClose":2,"rows":[{"file":0,"startedAfterBoundary":false},{"file":1,"startedAfterBoundary":false},{"file":2,"startedAfterBoundary":true},{"file":3,"startedAfterBoundary":true}]}
```

All four tests passed; the probe proves late execution, not a test-result error. This run used the real adapter, not a fake pool. The production selector demonstrably has no project-width bound: it cuts by slow slot permits and `floor(grant / slow.maxWorkers)` only. `Scheduler.close()` sets closed and then awaits the pump (`src/core/scheduler/scheduler.ts:370`); it does not cancel the files already queued inside this slow run. The new clamping boundary causes this failure scenario; the unmodified selector is the seam to repair.

**Worker-sized fix accepted by this review:** report the effective slow file-dispatch width from the runner to slow selection, including the per-project ceiling, and limit the tier before `startTier` marks claims and activity. Keep deferred files in the scheduler queue, and shrink both pool and slow-slot permits to the files actually started. Preserve the correct project ceiling. Add a real-scheduler regression: with project width 2 and four slow files, hold the first pair, request an edit or close, then release it; the remaining pair starts only in a later eligible tier, and never on close. Cover an explicit project width of 1 as well. Any new runner interface needs its typed contract documented. An amendment would instead have to explicitly accept late slow starts and the extra preemption/shutdown delay; the candidate's width wording alone does not do that.

## Should-fix

None.

## Nits

None.

## What fits

- **Floor and ceilings, proven by the new tests and independent probes:** `tierWidth` floors a grant at 2, preserves an explicit ceiling of 1, and clamps each explicit project ceiling. A project with no own width continues reading the root's width. The setter saves the initial resolved values, changes the same instance, and restores those values when no grant is present.
- **Warm instance and edit restoration, independently proven:** one real fork-pool, `isolate: false` instance with root width 3, project `a` without `extends` or its own width, and project `b` at 2 (`groupOrder: 1`) ran 12 files per run. Grants `1`, `8`, then no grant produced project widths `[2,2]`, `[3,2]`, `[3,2]`. All 36 file results passed, all environment records stayed identical, and a global setup marker was written exactly once. A separate `Widths` probe with an actually undefined project value checked root fallback across narrow/widen/no-grant calls without writing a width into that project.
- **Key semantics, independently proven:** `canonicalConfig` drops `maxWorkers`, and environment records stay unchanged across grant changes. Raw config-file bytes remain inputs as D3 specifies. The guard computed `b82febb06afe661e1dbe029ec169cd9378b2677a5fc4b30724c2b79c2b61ac9b`, exactly the version-10 pin. The latest released tag, `squeal--v0.1.168`, uses format 9; format 10 is already present in the base and unreleased, so re-pinning it in place is consistent with this candidate's release state.
- **Priority reaches both process families, independently proven:** from a parent at nice 0, real `startGroup` Node and Python programs each reported `own: 10, child: 10`. Both the node:test and pytest execution paths call this shared helper; its lowering happens immediately after spawn, before their normal runner startup. Lane polling now covers fast lanes too, and idle I/O stays specific to slow lanes.
- **Known priority gap:** the first Vitest fork scan is at 250 ms and later scans are 1 s apart; thread workers retain the daemon's priority. This is explicitly documented in the amended D11 and notes, and the short-fork gap is 001-393. It is not a new finding or blocker here.
- **Honesty:** the candidate does not change header/status/delivery state projection. Dropping a width from canonical config is deliberate policy, and changing a grant did not change the environment records in the probe. No additional stale-result or cross-lane priority bug was found in this range.

## Inputs for the repair wave

1. Repair B1 from the final candidate with real local dependencies. The four CLI bundles must match a second build exactly. Retain the required version bump and re-pin if the code repair changes guarded sources.
2. Repair B2 at slow selection and runner width reporting. Effective width is the whole run's grant, floored to 2 unless the project resolved to 1, capped by that project's ceiling; without a grant the slow instance wants `max(slow.maxWorkers, slow.maxParallel)` under the same limits. Determine how many files can start before committing claims/activity, retain the rest queued, and release excess capacity. Never solve it by restoring the creation option that overwrote a project's limit.
3. Preserve fast edits' no-grant behavior. Backlog/checkpoint `RunOptions.workers` is still the whole-tier grant. Reuse the warm instance and restore saved per-project values for the next ungranted edit.
4. Re-review the repaired bundles and the slow admission/interface delta. The floor, restoration, key-format state and shared priority helper above are settled unless that delta reopens them. 001-393 remains a separate row.


## Round 2 addendum: repaired candidate 26a41ae6

**PASS** `26a41ae67936c9c7e4ba72c270447af848edc62c`: **0 remaining blockers, 0 should-fix, 0 nits**. B1 and B2 are closed by proven evidence below. The original FAIL above remains the record for `ed3ce731`; this verdict applies only to the repaired candidate.

### Scope and verification

Bounded re-review requested by the coordinator, range `a436948b..26a41ae6`, after rebasing onto main 0.1.184. `git rev-parse HEAD` matched the full repaired SHA; the tracked tree was clean before and after verification. This addendum checks B1, B2, their repair delta, the new regressions, the 004 D2 amendment and the guarded-source re-pin. It does not reopen settled findings. The comparison below reports all six original commits as `=` (unchanged):

```text
$ git range-diff 74d6e4e0..ed3ce731~1 a436948b..525454ad
1:  8cbeb945 = 1:  2034a8ae docs(001-378): probe P1, a warm Vitest instance resizes between runs
2:  8fcf3a1c = 2:  eb06a331 feat(001-378): Vitest runs each tier at its grant under the project's own maxWorkers; maxWorkers leaves the environment hash
3:  8018e50c = 3:  7464ad2e feat(001-378): every test process runs at nice 10
4:  f1cedbb2 = 4:  9fe1b777 fix(keys): re-pin key format 10 for 001-378 (10 is unreleased; maxWorkers left the environment hash)
5:  3c20c4f2 = 5:  88bc0c44 docs(001-378): notes: what changed, tests, decisions, the short-fork gap and the proposed D11 wording
6:  715ccead = 6:  525454ad docs(001): D11 Runner ceiling and Priority amended (001-378)
```

Verification on the pinned clean candidate, Node 24.21.0 and Vitest 5.0.3:

```text
$ npm ci
added 196 packages, and audited 197 packages in 17s
found 0 vulnerabilities
exit 0
# npm also reported the same six unapproved dependency install scripts.

$ npm run lint
Checked 1232 files in 2s. No fixes applied.
exit 0

$ npm run typecheck
> tsc --noEmit
exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --porcelain
# empty
```

Every file-scoped invocation and throwaway probe used a temporary `XDG_CONFIG_HOME`, `env -u CODEX_SESSION_ID`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`. No probe reached the real HOME configuration. The scoped command was:

```text
$ npx vitest run --maxWorkers=2 test/daemon/slow-width.test.ts test/runners/vitest/width.test.ts test/scheduler/slow-width.test.ts test/keys/key-format.test.ts test/harness/codex/plugin.test.ts test/harness/opencode/package.test.ts test/harness/pi/package.test.ts test/harness/plugin.test.ts
Test Files  8 passed (8)
Tests       80 passed (80)
Duration    32.96s
exit 0
```

There is **no new independent full-suite result at this SHA**. The coordinator explicitly requested scoped runs while its own locked full gate runs; this reviewer did not start a second full run. The original full-suite result above belongs to `ed3ce731` and does not verify `26a41ae6`. No file failed the round-2 scoped runs. The original loaded-suite/file-only discrepancy remains `test/keys/key-index.test.ts`, recorded above.

### B1 closed: reproducible bundles (proven)

**Location:** the four `plugins/*/dist/cli/squeal.mjs` files and the rest of the committed plugin build output.

**Probe:** install the lockfile into this checkout's real `node_modules`, build, then compare each tracked `plugins/*/dist/*` file's bytes with `git show HEAD:<path>`. Every file was byte-identical. `git status --porcelain` stayed empty. All four committed-bundle comparison test files also passed in the scoped run. The former `../sq-int-182/node_modules/` build-path drift no longer occurs.

### B2 closed: scheduler admits only the slow run's dispatch width (proven)

**Locations:** `src/core/scheduler/slow-tier.ts:384`, `src/core/types/runner.ts:447`, `src/runners/vitest/width.ts:70`, and the forwarding in `src/core/daemon/{runner,slow-instance,composite-runner,escaped}.ts`.

`RunnerAdapter.slowWidth(files)` is optional, synchronous and documented as an ordered prefix count. The selector truncates before the pool take and before `startTier` claims or publishes activity. Deferred files have not been removed from the queue. The existing start path shrinks the slow slot and the pool lease to the actual tier. The recovering runner, slow-instance wrapper and post-run wrapper forward the method. The composite limits the query to one owning adapter, whose parts run sequentially. Vitest reports the saved project ceiling and stops at task-group boundaries; an explicit ceiling of 1 stays 1. Its fast instance can answer before the slow instance exists, without creating an instance while the scheduler holds its lock.

**Independent execution probe:** an external temporary Vitest test imported the repository's scheduler harness and exercised its real scheduler, store and Vitest adapter. Four real slow test files each wrote a start marker and waited on a filesystem release barrier. The project ceiling was 2, `slow.maxParallel` was 4, `slow.maxWorkers` was 2, and the private capacity pool held 8 workers. The run wrapper only recorded the real submitted files/options; it did not simulate file starts or delay the adapter. With the first files held, the probe read the store's actual `queued`/`running` phases and acquired the unused slow-slot permits as another owner. It then marked the close boundary, called `scheduler.close()`, released the files, and awaited close. A second case used explicit ceiling 1. Actual outputs:

```json
{"ceiling":2,"selected":2,"queued":2,"running":2,"freePermits":2,"grant":4,"startedBeforeClose":2,"startedAfterClose":0}
{"ceiling":1,"selected":1,"queued":3,"running":1,"freePermits":3,"grant":2,"startedBeforeClose":1,"startedAfterClose":0}
```

```text
$ npx vitest run --config <temporary-probe>/vitest.config.ts --maxWorkers=1
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    8.75s
exit 0
```

Both cases confirm excess files remain queued in Squeal rather than inside Vitest; none starts when the scheduler closes. The throwaway probe and fixtures were removed before committing this report.

**Regression adequacy:** `test/scheduler/slow-width.test.ts` exercises real admission, slot shrinkage, the grant, and edit-before-next-tier/close ordering, with simulated file-dispatch markers around the actual adapter run. That simulation alone would not establish real simultaneous execution; the real-adapter worker-ID tests and the independent held-file probe above close that evidence gap. `test/runners/vitest/width.test.ts` also covers ceilings 1/2/unset/6 and task-group boundaries. `test/daemon/slow-width.test.ts` covers lazy slow-instance and composite forwarding. Together these discriminate the original four-file admission defect while preserving the existing project ceiling and fast edit behavior.

### What fits and inputs for the next wave

- The 004 D2 amendment (`docs/specifications/004-slow-suites/spec.md:44`) correctly preserves “no file ... starts after an edit or a close” and states how it is achieved: report the runner's width, keep one Vitest task group, and leave excess files queued for a later tier. Its dated status entry records the same accepted code repair; it does not accept late starts.
- The new guarded `RunnerAdapter` contract changes the source fingerprint. The key-format guard passes with format 10 pinned to `c0bc14e941b57eac0478ba199949ee8a58144a0fb73fffcc461ccc95e1a22472`. Retaining the unreleased format number follows the release-state determination in the original review. The unchanged original commits retain `maxWorkers` exclusion and the proven grant/restoration behavior.
- No further fix wave is required for B1 or B2. Preserve the prefix-width query before claims/activity/capacity accounting, and preserve `RunOptions.workers` as the whole-run grant. The coordinator still owns its repaired-candidate full gate and landing decision. The accepted short-fork priority gap remains row 001-393.

**Remaining blockers:** none. **Should-fix S<n>:** none. **Nits N<n>:** none.
