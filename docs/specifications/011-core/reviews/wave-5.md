# Wave 5 review: 011-22 catch-up and 011-23 adoption

Verdict: **FAIL 276ed939fb2c3c0adae9ab5b327a2991ade36b25**. **3 proven blockers, 0 should-fix, 0 nits.**

## Verification output

Requested candidate initially `8e67bb2d514c46dcf2a1ab764738d092d1730130`, range `878b35bb..8e67bb2d`. Initial `git rev-parse HEAD` matched and `git status --short` was empty. During the review the coordinator changed the target to `276ed939fb2c3c0adae9ab5b327a2991ade36b25`, adding only W2's notes and margin probe. Fast-forwarded this review branch to that SHA; `git diff --quiet 8e67bb2d 276ed939 -- src test plugins package.json package-lock.json` exited 0. The findings below apply to `878b35bb..276ed939`.

`npm ci` ran from the lockfile on the initial clean candidate, then again at the final candidate SHA before the remaining verification:

```text
added 196 packages, and audited 197 packages in 17s
found 0 vulnerabilities
```

Exit 0. npm also listed six packages with install scripts not covered by allowScripts. No dependencies or lockfile were changed. The final install and checks used the final SHA with a clean tracked tree.

Lint, typecheck and build ran cleanly on the initial candidate and were repeated on the final candidate, before creating this findings file:

```text
$ npm run lint
> squeal@0.1.226 lint
> biome check .
Checked 1483 files in 1078ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.226 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.226 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.226 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts

$ git status --short
<empty>
```

Independent suite, required by the reviewer role rather than a Squeal checkpoint:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  752 passed | 1 skipped (753)
Tests       6353 passed | 10 skipped (6363)
Start at    10:40:53
Duration    902.22s (tests 98%, import 2%, transform 1%)
exit 0
```

The run started and finished at the final candidate SHA with a clean tracked tree. It took the shared lock once; an earlier lock wait was cancelled before Vitest started, to refresh the install at the revised target. Both known daemon-only fidelity files (`run-reads-fidelity`, `observe-fidelity`, 001-390) passed in this independent run. Squeal separately reported their known recorder-related failures and a transient `version-sensitive.test.ts` fixture traversal failure; the latter recovered on its automatic retry. These daemon results are not used as the review gate.

The coordinator separately supplied a loaded-gate failure of `backlog-slots-overhead.test.ts` (1.30 versus 1.2 at load 37–55) and `runner-part-bound.test.ts:77` (11 unknown checks after revision 2). Its isolated timing-test comparison was 1 failure in 9 runs on the candidate (at line 64) versus 0 in 8 on main, at load 28–55. These are coordinator-supplied observations, not this reviewer's isolated experiments. Both files passed in the reviewer's full run. The timing-test cause is unresolved: the new adoption reader excludes `unknownKey` and pending refinement, so source inspection does not prove it changed a blocked file. No fourth blocker or proven candidate regression is inferred from those counts. Carry that comparison forward if a repair reopens the same path.

Targeted reviewer probes used the candidate's real scheduler, git worktrees, store, pool and existing `catch-up-fixture.ts`, with fake runner durations. Their test files and minimal Vitest config were outside the worktree, so the candidate remained clean. No source, test or bundle was edited. Their failures are assertions for the required behavior, not environment failures:

```text
classification.test.ts:
ADDED [ { files: 4, workers: null }, { files: 4, workers: null }, { files: 4, workers: null } ]
RECOVERED [ { files: 4, workers: null } x 6 ]
Test Files 1 failed (1)
Tests 2 failed (2)
Duration 5.01s

startup.test.ts:
RESTART { revisions: [ 6, 6 ], runs: [ { files: 24, workers: 4 } ] }
Test Files 1 failed (1)
Tests 1 failed (1)
Duration 3.93s

controls.test.ts:
Test Files 1 passed (1)
Tests 3 passed (3)
Duration 5.72s
```

In this output `workers: null` means `RunOptions.workers` was undefined: the edit route, without the backlog's grant. Controls cover exactly 10 known keyed paths, 9 keyed paths plus 3 unrelated changed paths, and a direct importer discovered only in the runner part. The three probes that expose breaks ran in about 1.1 s of test time in total. Scratch probe files were deleted before this review commit.

## Blockers

### B1. Newly added test files do not count toward catch-up

**Proven.** `src/core/scheduler/revision.ts:57` and `:92`; the runner part carries the resulting false classification in `src/core/scheduler/refinement.ts:165`.

C4 step 4: “A revision that changes 10 or more keyed paths (test files, closure paths or declared inputs) causes no edit's work, whatever its trigger”. W3 explicitly requires “a revision of 10 or more keyed paths, and only such a revision” to queue catch-up.

`isCatchUp` builds its test-path set from the previous ledger before the runner lists additions. Twelve new test files with no previous closure or declared-input match therefore count as zero. The later listing adds and keys them, but inherits `catchUp: false`. A pull or codemod adding many new test files takes edit tiers without the pool grant, instead of catch-up. This is recorded as a worker decision in W1's notes, not an accepted C4 amendment.

Reproduction using `catch-up-fixture.ts`: start and finish the baseline with one existing test file. Write `test/added0.test.ts` through `test/added11.test.ts`, append their descriptors (`ms: 100`, `imports: []`) to the array supplied to the fake runner, and send one `watch` batch with their `statCandidates`. All 12 additions run in three tiers of four, all without `RunOptions.workers`. The assertion that the first run has a grant fails.

**One-worker fix:** account for newly listed test files when finalizing this revision's keyed-path classification, and apply that classification to its queued files and direct importers. Preserve first-group work from an earlier small edit and named promotions. Do not count arbitrary added files as test files merely to reach the threshold. Add regressions for 10 or more new tests, a mixed revision whose additions cross 10, and fewer than 10 keyed paths with unrelated additions. The former must use the backlog grant/route; the latter must retain edit tiers.

### B2. Recovery from a runner failure loses the revision's catch-up classification

**Proven.** `src/core/scheduler/refinement.ts:241`, calling `settleFailures` in `src/core/scheduler/failures.ts:17`.

C4 step 4 requires the files reached by a qualifying revision, including its runner part, to be catch-up. W3 explicitly asks that the count reach the runner part rather than create edit work there.

`applyRunnerPart` passes `part.catchUp` to its first `ledger.settle`, while the files of a previously failed runner are still blocked. `settleFailures` then unblocks them and settles again with only `changed`. That second settle queues every reached file as `recent`. A large pull that repairs a runner failure takes edit tiers and can occupy the lane ahead of subsequent agent edits, instead of taking catch-up grants and cancellation.

Reproduction: 24 test files importing 12 distinct sources, baseline complete. Make `runner.environment()` reject, edit `config.json`, and wait until the scheduler is idle after the failed refinement. Restore the environment method and edit all 12 sources in one `watch` batch. All 24 files run in six tiers of four with no grant. The assertion that the first recovery run has `workers` fails. The same fixture's ordinary 12-source change uses catch-up.

**One-worker fix:** pass the revision's settle classification through the failure-recovery path, including catch-up and the direct-importer information needed for its normal priority. Add the above red regression and a below-threshold recovery control. Recovery from a runner failure must not silently change this revision's group.

### B3. Startup combines separate small revisions into a catch-up revision

**Proven.** `src/core/scheduler/bootstrap.ts:185`, consuming `scan`'s union at `:76`.

W3: “a revision of 10 or more keyed paths, and only such a revision” and “the count happens once per revision”. C4's threshold is per revision, not per accumulated startup batch.

`scan` unions every path changed since the last refined revision; the baseline calls `isCatchUp` on that union. Two separately recorded six-path edits are therefore treated as one 12-path catch-up. No qualifying revision exists. The small edits lose their first-group priority and run through the pool. W1's notes acknowledge the aggregation as a decision, but the spec/status amendment does not accept it.

Reproduction: run a 24-test/12-source baseline, then stop its scheduler. Load `StatCache` from that worktree's persisted hashes and record two revisions using the public `reconcile` function: edit sources 0–5, reconcile; edit sources 6–11, reconcile. This seeds the state of a predecessor that recorded both content parts before refining them. Leave `refinedMetaKey` at the baseline and start a fresh scheduler. Both stored revisions have six changed paths; startup runs all 24 files as one tier with `workers: 4`. The assertion that these small revisions retain ungranted edit tiers fails.

**One-worker fix:** retain each unrefined revision's identity and reach when carrying work into the baseline or through an install wait, and classify against each revision separately. Keep edits from a small revision in the first group, even when a different large revision reaches the same file. Add two-small-revisions and mixed-small/large startup tests, plus the same boundary during an install wait. Do not repair this by changing the threshold or treating all startup work as catch-up.

## Should-fix

None.

## Nits

None.

## What fits

- The queue has the intended first-group, catch-up, ordinary-backlog ordering. Catch-up collapses edited/direct/transitive classes into failing versus non-failing and then duration. The controls establish the exact threshold and exclude unrelated paths from the count; the runner-only direct-importer control passes.
- The main catch-up route reuses backlog wall estimates, pool grants, claims and slot selection. `TierFile.catchUp` preserves the group on an ordinary cancellation's unfinished remainder. The fairness turn takes a lease/slot and falls back to edit selection when the pool would make it wait. Existing tests cover cancellation, node:test overlap, promotion, fairness, ordering and shared-key runs. Their independent-run status is in the verification section.
- Adoption's query explicitly ranges `results_by_time`; `StoredKeys` overlaps by 120 s and deduplicates each key's newest timestamp. It calls the existing lookup/settle path with `queueMisses: false`, retaining inherited provenance and held-failure semantics. A failed adoption restores file state, queue state and checkpoint bookkeeping through `Ledger.hold`, and leaves its watermark unchanged. No read occurs while runner refinement is pending. The added tests exercise lookup-only adoption through the daemon timer, held failures under both policies, idle no-write behavior, late commits and busy-store rollback.
- `Ledger.settle` preserves forced entries, so the added adoption call does not satisfy a forced request by inheritance. Adopted queued hits leave the queue before tier selection; catch-up's shared-key test exercises that composition.
- The released key format is 16; this candidate advances it once to 17, retaining old pins and adding the combined-source pin `035304b6e796761520e5efcd3272af3864ae7695003b2a8e9f6b2e4152b3a6ea`. The version is consistently 0.1.226 and rebuilding bundles leaves the tree clean.

## Inputs for the fix wave and next wave

Dispatch three bounded repairs for B1–B3 before another product landing; B1 and B3 share revision classification: dispatch them in sequence or to one owner, with an agreed carrier from reconciliation to refinement/baseline. B2 must pass that same classification into unblocking rather than infer it again. Keep the threshold at 10 keyed paths per revision, the backlog budget at 120 s (or half the runner timeout), the 120 s adoption overlap, and named demand's stronger first-group rank. The existing turn's grant and slot behavior should not be redesigned by these fixes.

After repairs, re-pin key format 17 for the combined guarded sources and rebuild version 0.1.226's bundles; 17 has not been released by this candidate, so do not allocate another format merely for its repair. Re-review the blockers and the repair delta.

W1's cezar selection replay records 862 s versus 2,574 s on the old edit route, mean time to a result 54 s versus 1,588 s; these are worker-supplied model results, not a live reviewer measurement. W2's margin notes now exist and bound/measure the 120 s overlap against observed commits up to 67 s. Live cezar catch-up/adoption measurements below load 8 remain the coordinator's work; no live experiment was attempted in this review. Load was about 62–77 during the early probes and later fell below 8 during the independent suite; that window was reported to the coordinator.

Known boundary for later work: `stored-keys.ts:83` explicitly excludes a file `unknown` at its current key, as the existing settle path does. W2 records this exception; the stale-file acceptance cases do not establish adoption after a local crash/timeout. Carry that limit into 011-27 rather than claiming all no-result files now adopt. No new finding is made against the pre-existing crash/retry behavior.


## Re-review (W3r)

Verdict: **PASS c2c94c7f922546baf99de79312beb69994961417**. **0 blockers, 0 should-fix, 0 nits. B1–B3 closed.**

Bounded to the repair delta `276ed939..c2c94c7f` and B1–B3 above, including the explicitly requested checks of first-group preservation, promotions and the demotion guard. The initial re-review target `d84444b9` was superseded during review: the coordinator supplied `f4116d7e` (revision-specific recent reasons) and `c2c94c7f` (format-17 re-pin and bundles) to close the overlap failures described below. Adoption and settled wave-5 behavior were not re-prosecuted.

### Verification output

`git rev-parse HEAD` matched `c2c94c7f922546baf99de79312beb69994961417`; the candidate tree was clean. The original findings-only commit `ee8ab04e`, already cherry-picked to main as `2eaa9fc7`, was excluded from the candidate checkout. Its text was saved outside the project and restored only after verification, with this section appended.

```text
$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
exit 0

$ npm run lint
> biome check .
Checked 1487 files in 637ms. No fixes applied.
exit 0

$ npm run typecheck
> tsc --noEmit
exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --short
<empty>

$ npx vitest run test/scheduler/catch-up-classification.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    4.36s
exit 0

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
FAIL test/scheduler/backlog-slots-overhead.test.ts:82
expected 21798.859410999998 to be <= 21681.347626799998
011-21 slots: best 1.21 times one tier (limit 1.20)
Test Files  1 failed | 752 passed | 1 skipped (754)
Tests       1 failed | 6361 passed | 10 skipped (6372)
Start at    11:29:19
Duration    965.64s
exit 1

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/backlog-slots-overhead.test.ts --maxWorkers=4
FAIL test/scheduler/backlog-slots-overhead.test.ts:82
expected 34661.497974 to be <= 25629.79428959999
011-21 slots: best 1.62 times one tier (limit 1.20)
Test Files  1 failed (1)
Tests       1 failed (1)
Start at    11:45:32
Duration    208.16s
exit 1
```

The first install at this final SHA hit `ENOTEMPTY` removing `node_modules/.vite`, following the superseded Vitest run and the daemon's dependency transition. Retrying `npm ci` succeeded without changing project files; the checks above followed that successful install. The superseded independent run at `d84444b9` was stopped with SIGINT (exit 130) when the coordinator changed the target; its incomplete results are not evidence for this candidate. The final candidate's full run above is this reviewer's own independent locked run, not the coordinator's gate or a Squeal checkpoint.

The full run therefore does **not** establish an all-green suite. Its only failure was the existing 011-21 overhead comparison, also reported on the original candidate before this repair (the coordinator's supplied 1.30 result in the initial review). The isolated run failed too: it was not a quiet-load comparison. Load samples were 12.43 at 09:42 UTC after the full-run failure, 32.64 at the isolated run's start, 47.63 during it, and 69.22 afterward. These timings neither prove load caused the failure nor prove the repair introduced it. This remains unresolved verification context outside B1–B3; no new blocking regression is inferred. The isolated run's best slots time was 34,661 ms versus 21,358 ms for one tier, and both runs remained within the commit-count budget. Carry the unresolved 011-21 check into the coordinator's landing note. The independent full run passed both recorder-fidelity files, `runner-part-bound.test.ts`, and the repair regressions.

A final Squeal status query returned on quiet at revision 14, with zero running or queued checks and three known failures: the two daemon-only recorder checks (001-390), plus OpenCode's held-Stop timing case. Squeal's temporary-fixture traversal failure recovered on its automatic retry. These daemon observations are separate from the independent results above and do not supply a passing gate.

The nine new regression tests pass independently. They cover the original isolated B1–B3 failures, mixed edited/added test files, below-threshold controls, small-plus-large startup priority, install-wait revision boundaries and the earlier runner-part ordering. The coordinator's red-on-unrepaired-source comparisons are supplied evidence, not experiments repeated by this reviewer.

Five external scratch probes used the real scheduler, store and per-fixture pool with `catch-up-fixture.ts`, fixed reported durations and controlled `invalidate` promises. They changed no project file:

```text
ordering.test.ts at d84444b9: 2 failed | 3 passed (5), Duration 7.28s
ordering.test.ts at c2c94c7f: 5 passed (5), Duration 2.05s
```

At the final SHA, these controls all pass: an earlier content part's queued edit stays in the first group; a later small edit stays there; and a named promotion survives recount. The two overlap regressions below also pass. The probes use `tierSize: 1`: a larger edit tier can fill spare places with catch-up files and conceal a wrong group behind an ungranted run. Scratch probe files and config were deleted before committing this review.

### B1 closed: count additions and preserve each revision's first-group work

The runner part recounts after listing, closure application and tracking. Added tests now count; twelve new tests and six edited plus six added take the backlog grant. Nine keyed sources plus three unrelated additions retain edit tiers. `Ledger.settle` carries `keyedAt` into `RunQueue.add`; `Entry.recentBy` retains the revisions that justify its first-group flag. The final recount removes only its own provisional reason through `toCatchUp(ref, keyedAt)`. Promotions remain separate.

Two failures of the superseded snapshot/`changedMeanwhile` repair were reproduced and checked against the final revision-specific implementation:

- **Later revision is also large.** Baseline has `target`, nine other existing tests and a dummy. Hold B's invalidate while B edits `target` and adds ten tests. While held, C edits `target` and the nine other existing tests (ten known keyed paths). On `d84444b9`, the path-union guard kept `target` recent although both revisions were catch-up; it ran alone without a grant. At the final SHA all twenty reached files, `target` included, take a backlog grant. The later large revision creates no recent reason, and B removes its own provisional reason.
- **Earlier runner part discovers first-group work after the later content part.** Baseline has `target` without `src/earlier.ts` in its closure and `dummy` importing that source. Hold small A's invalidate while it edits the source. For A, have `affected` name `target` directly and its refreshed closure include that source. Before releasing A, B edits `target` and adds ten tests. A's runner part then makes `target` recent before B's recount. On `d84444b9`, B cleared that valid reason and `target` took a backlog grant. At the final SHA both A-reached files run in ungranted edit tiers of one, and the ten additions use the backlog grant. The coordinator's named known limit therefore matters, and is closed by the final repair.

These checks verify the original B1 guidance to preserve earlier first-group work and promotions, including the requested later-revision guard behavior. There is no remaining `changedMeanwhile` demotion guard: provenance in the queue replaces the lossy path union and boolean snapshot.

### B2 closed: failure recovery uses the revision's classification

`settleFailures` receives the same `SettleOptions` as the initial runner-part settle: direct importers, keying revision and catch-up classification. The twelve-source recovery takes catch-up grants; the six-source recovery preserves its reached files' first-group priority. Callers with no specific content revision retain default options. The recovery path no longer changes this revision's group while unblocking its files.

### B3 closed: startup and install waits classify revisions separately

`scan` and `reconcileWaiting` retain one path set per revision through `UnseenChanges`; both scheduler baseline callers pass it unchanged. Baseline classifies each set separately. A small revision's reach wins for a file also reached by a large one. Two six-source revisions remain edit work at startup and across an install wait; the small-plus-large startup test runs the small revision's files first as edit work and the others as catch-up. The threshold remains ten keyed paths, with no blanket startup catch-up classification.

### What fits and inputs for the next wave

B1–B3 need no further repair. Keep per-revision recent reasons when changing queue grouping; a content-only boolean snapshot or union of later paths loses valid priority or invents it. The supplied regressions plus the five ordering probes cover the repair's seam. Adoption, the 120 s wall/overlap, fairness, grants, slots and named-demand ranking remain as settled in the original review.

The candidate keeps unreleased key format 17, re-pinned to `e89738c4684948d7dd43972cf679d3c429e6edb0d3a85156e1062fee67da9353`; old pins remain unchanged. Rebuilding all four bundles produces no drift. The coordinator still owns live cezar measurements and the landing decision. No additional note or product limitation was introduced by this bounded re-review.
