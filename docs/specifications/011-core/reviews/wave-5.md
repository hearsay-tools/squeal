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
