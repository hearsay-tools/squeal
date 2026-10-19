# 011 wave 4: cand/0.1.224 review

**FAIL dae700644275fa262d1bfeca8c58bb0c8d11f2b1**. One proven blocker, zero should-fix items, zero nits. W2 of `tasks/wave-4.md`, reviewed 2026-10-19.

## Verification output

HEAD matched the pinned candidate. Range: `origin/main..dae700644275fa262d1bfeca8c58bb0c8d11f2b1`, with local `origin/main` at 3c993aea2ec099824a452c98e37f50e2d08d1f27. The tree was clean before installation, after build, and after the independent suite. Checks ran before this findings file was written. The independent run below is the reviewer gate; Squeal's checkpoint was not substituted.

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 6s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

```text
$ npm run lint
> squeal@0.1.224 lint
> biome check .

Checked 1464 files in 506ms. No fixes applied.
```

```text
$ npm run typecheck
> squeal@0.1.224 typecheck
> tsc --noEmit
```

```text
$ npm run build
> squeal@0.1.224 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.224 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

All four commands exited 0. `git diff --exit-code` and `git status --porcelain` after build printed nothing; all four committed plugin bundle trees stayed unchanged.

The independent full run took the host lock once, with four outer workers. One-minute load was 5.10 at start, observed as high as 78.75 during the run, and 15.78 at finish (24 CPUs). The command exited 0. Timestamp/load reads wrapped the locked Vitest invocation.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Mon Oct 19 19:33:28 UTC 2026
 21:33:28 up 5 days, 10:22,  6 users,  load average: 5.10, 8.98, 9.34

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/04b1fc64-9755-4c02-a5c8-0c044c1f8998

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/04b1fc64-9755-4c02-a5c8-0c044c1f8998/test/fixtures/scheduler/.tmp/85f49ac9-47e9-4578-b967-76930d7eacde/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/04b1fc64-9755-4c02-a5c8-0c044c1f8998/test/fixtures/scheduler/.tmp/45c991c9-5d52-45ae-8f3e-e5462e23cdb1/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2402345
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  739 passed | 1 skipped (740)
      Tests  6312 passed | 10 skipped (6322)
   Start at  21:33:29
   Duration  944.88s (tests 98%, import 2%)

    Isolate  740 workers spawned · ~136ms startup each (spawn + environment, per file)
             at least ~24.99s faster with isolate: false — reuses workers across files instead of one per file

 21:49:14 up 5 days, 10:37,  6 users,  load average: 15.78, 20.75, 21.82
Mon Oct 19 19:49:14 UTC 2026
```

Squeal's separate revision-0 baseline reported `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, the two known daemon-only recorder observations named in the brief (001-390). It also reported `test/daemon/busy-edit.test.ts:144`: its expected note contained `revision 1`, while the observed note was `the store was busy for 5.4 s (another connection held its write lock); ran once it was free: 5 files of a tier queued again, the heartbeat`. Squeal then reran the latter under the same inputs and delivered `FAIL -> PASS` with the flaky label. These are verification observations separate from B1. All three files passed the independent gate. No file failed that gate, so no isolated gate-failure rerun was needed.

## Blockers

### B1. Proven: an old backlog run can erase the newer run's pending or current state

Locations: the newly overlapping flight path in `src/core/scheduler/scheduler.ts:691` and `src/core/scheduler/tiers.ts:92`, with the still single-run bookkeeping in `src/core/scheduler/tiers.ts:508`, `src/core/scheduler/ledger.ts:383`, `src/core/scheduler/ledger.ts:398`, and `src/core/scheduler/scheduler.ts:854`.

Goal 3: “Everything the agent is told is true at the moment it is told: a delivered state is the current known state.” C4: “Validity is per check, not per run”; “Pending means a run that will produce a result for the current key is queued or running.” The amendment allows a backlog file re-keyed by an edit to run under its new key beside its old run. These runs must retain independent state ownership, including when either run fails.

`#inFlight` is now keyed by run id, but each shared `FileState` still has only one `runningKey`. Starting the edit's run replaces the old running key. `recordTier` unconditionally calls `ledger.setRunning(file, null)` when either run ends. On the incomplete/crashed branch it also passes the old file/key to `markUnknown`; that method calls the state sink with the file alone, so the old crash overwrites whatever state the newer run produced. The sink's unknown write has no old-key guard. This was not reachable for two runs of the same lane before this change.

Two deterministic probes outside the worktree used `createNodeTestRunners` behind the existing scheduler harness and composite, one node:test file importing `a.mjs`, and two deferred run reports. They exercised the candidate without modifying its tree or taking user capacity. Start baseline A at key K0, edit `a.mjs`, and wait for edit B at K1 to start beside A. Then:

1. Keep B unresolved. Release A with `{ end: "crashed", durationMs: 1, completedFiles: [], results: [], fileErrors: [], failure: "old backlog crashed" }`. Wait for A's run record to finish. B is still running, but its row and delivered header change as follows:

   ```text
   before: test_file_keys.pending = "running"
           testFilesWithoutChecks = { pending: 1, unknown: 0 }
   after:  test_file_keys.pending = null
           testFilesWithoutChecks = { pending: 0, unknown: 1 }
   AssertionError: expected null to be 'running'
   ```

2. First execute B through the actual node:test runner and release its real passing report. Wait for its record and confirm both its file and test states are `pass/current`. Then release A with the same crash report. Both K1 states become `unknown/unknown`, with summary `node-test: old backlog crashed`. The header changes from current results to two unknown checks, including one file-level check. No new edit or run is queued to repair them:

   ```text
   before: outcome = "pass", validity = "current", observedAt = 1
   after:  outcome = "unknown", validity = "unknown", observedAt = 1
           summary = "node-test: old backlog crashed"
   AssertionError: expected false to be true
   ```

The real node:test runner also emits `crashed` when no file completes and a process dies without a whole event stream (`src/runners/node-test/run/run.ts:254`); `executeTier` produces the same shape when a run rejects. This is an ordering/state failure, independent of host timing. Both focused probes exited 1 on assertions of the required behavior; they are evidence of the blocker, not failed repository verification. Temporary probe sources were removed before the findings commit.

**One-worker repair:** make running ownership specific to the run or the active key, and clear only the completing run's ownership in both `recordTier` and the scheduler's error/requeue path. A stale run's unknown, timeout, discard and checkpoint handling must not replace a newer key's known state or discharge its active claim. Guard stale unknown writes before they reach the sink; fixing only `setRunning` does not fix probe 2. Add scheduler regressions for both completion orders, including an actual K1 passing report followed by K0 crash/timeout. Keep valid same-key failures visible, and retain the existing stale-result discard and re-queue behavior. Guarded source changes require the key-format guard to be satisfied again before the repair release.

## Should-fix

None beyond the repair and regression coverage in B1.

## Nits

None.

## What fits

- `busyLanes` uses runner capability, not lane-name tests. A lone backlog tier with first-group work queued can admit one additional edit-classified tier. Two flights or a lone edit tier keep the lane busy. `selectTier` uses `runner.tierSize` and no capacity lease for the edit class. Vitest retains the absent/false capability and the cancel path.
- Every use of the former lane-keyed `#inFlight` map was checked. Selection and the pre-selection wake check use the new busy-lane calculation; slow-pending, fast-idle and slow-start checks read lanes from flight values. Departure still waits for all flight promises, and stop still reaches every run.
- Completed stale backlog results retain per-tier changes and snapshots; the new changed-input test covers the normal completed case, including retaining seven unaffected files and looking up the new result rather than running the changed file a third time. B1 concerns the missing failure/completion-order case.
- The new capability passes through composite ownership, recovering runners (available before construction), slow instances and the sweep wrapper. Both shipped node:test and pytest factories enable it; Vitest does not. Both runner adapters merge the run's `childEnv` over the daemon's environment, with unique run log directories.
- The sweep and priority scan receive `<lane>#<runId>` for overlapping-capable runners, while runner `RunOptions.lane` remains the original lane. The `slow:` prefix remains visible to lowering. Vitest keeps its instance-time lane mark. Bare-mark/group-orphan handling and overlapping-run attribution retain the existing last-overlap rule. The real-process overlap regression exercises the first run ending while the second is live.
- The release raises `KEY_FORMAT_VERSION` from released 14 to 15 and adds a distinct guarded hash. Version 0.1.224 and the committed plugin bundles rebuild without drift.

## Inputs for the fix wave and slice 2

Repair B1 before landing this slice. One scheduler worker can own `files.ts`, `ledger.ts`, `tiers.ts`, the scheduler's requeue path, the regression tests and the required key re-pin. Keep the existing `busyLanes(context, ledger, inFlight)` seam and capability forwarding; no new runner method is needed for this repair. A narrow re-review should cover both probe orders and the repair delta.

For slice 2, each selected run must retain its own input snapshot, changed-path set, key/claim ownership and process mark from selection through recording and error cleanup. Do not extend the current single `runningKey` assumption to slots. W remains the grant, at most `runner.tierSize`, with one permit per backlog slot, batched record commits, and no permit for an edit's extra run. Vitest continues to cancel. Slot throughput, departure, claims and pytest batch packing remain the later slice's work.

The worker notes' forced-queue promotion and delayed confirming-rerun observations predate this candidate. They are not findings against this range. The brief names node:test `run-reads-fidelity` and Vitest `observe-fidelity` under the Squeal daemon on main (001-390); name any gate sightings separately from B1 rather than treating that known context as a new blocker.

## Re-review

**PASS bc8ed7742f55bc5dbfb5db235d03e31fb4242a6a**. B1 closed. Zero blockers, zero should-fix items, zero nits. W2r of `tasks/wave-4.md`, reviewed 2026-10-19. This re-review covers only B1 and the repair delta `dae700644275fa262d1bfeca8c58bb0c8d11f2b1..bc8ed7742f55bc5dbfb5db235d03e31fb4242a6a`; the first review's settled list stands.

### Verification output

HEAD matched the pinned candidate before any checks and still matched after the full run. `git status --porcelain` and `git diff --exit-code` produced no output before installation, after build and after the suite. All checks below ran at the clean candidate, before this append. The independent run took the host lock once; Squeal's checkpoint was not substituted.

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 12s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

```text
$ npm run lint

> squeal@0.1.224 lint
> biome check .

Checked 1465 files in 647ms. No fixes applied.
```

```text
$ npm run typecheck

> squeal@0.1.224 typecheck
> tsc --noEmit
```

```text
$ npm run build

> squeal@0.1.224 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.224 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

All four commands exited 0. The build left every committed plugin bundle unchanged.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Mon Oct 19 20:05:53 UTC 2026
 22:05:53 up 5 days, 10:54,  6 users,  load average: 34.11, 18.38, 17.53

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/a8053e61-5d3a-499b-a307-9d57d036d6c4

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/a8053e61-5d3a-499b-a307-9d57d036d6c4/test/fixtures/scheduler/.tmp/4a66cce4-35d4-416e-9c52-babd5b361679/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/a8053e61-5d3a-499b-a307-9d57d036d6c4/test/fixtures/scheduler/.tmp/19fe2fd2-f47d-476a-a0c1-866532acd7df/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3427950
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  739 passed | 1 skipped (740)
      Tests  6314 passed | 10 skipped (6324)
   Start at  22:05:54
   Duration  928.14s (tests 98%, import 2%)

    Isolate  740 workers spawned · ~136ms startup each (spawn + environment, per file)
             at least ~25.10s faster with isolate: false — reuses workers across files instead of one per file

 22:21:22 up 5 days, 11:09,  6 users,  load average: 14.90, 20.10, 23.21
Mon Oct 19 20:21:22 UTC 2026
```

The full run exited 0. Host load was 34.11 at start, sampled as high as 58.30 during the run, and 14.90 at finish on 24 CPUs. No file failed this gate, so no isolated rerun was needed. The coordinator's reported 6314-test gate at code-equivalent `079bac6c` is supporting context; it is not this review's verification.

Squeal's separate baseline reported the two recorder-fidelity observations named in the brief (`test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, 001-390). It also reported `test/daemon/busy-edit.test.ts:127`, with 3469 ms after lock release against a 1000 ms bound; Squeal then delivered `FAIL -> PASS` for that test under the same inputs. All three files passed the independent gate. These daemon observations are separate from B1.

### B1: closed, proven

`src/core/scheduler/tiers.ts:265` now recognizes a file held by another run at a different key, or a file whose different current key already has its applied result. `recordTier` calls that guard at the head of its per-file loop (`tiers.ts:523`), before clearing running ownership and before the withheld, cancel/requeue, crash/unknown, timeout-split, stability-discard, result-application and checkpoint paths. A superseded file is not added to the later unknown, growth, startup or failure-rerun worklists. The tier itself still finishes and releases its lease and input snapshot.

The scheduler's error cleanup uses the same guard before clearing and enqueuing a file (`src/core/scheduler/scheduler.ts:856`). Both completion orders in B1 are covered: a live different-key run retains its running claim; after it stores, its current result remains authoritative when the old run finishes or crashes. At an unchanged current key, with no different-key owner, both guard conditions are false and the run reaches the existing recording, crash and timeout handling. The repair changes no failure classification or same-key result handling.

The two new scheduler regressions discriminate the repair. In a disposable detached worktree at the original `dae70064`, I overlaid only the candidate's `test/scheduler/edit-beside-backlog.test.ts` and ran:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/edit-beside-backlog.test.ts -t '3\.|4\.' --maxWorkers=4
Test 3, line 277: expected pending "running", received "queued".
Test 4, line 311: expected outcome "pass", received "unknown".
Test Files  1 failed (1)
     Tests  2 failed | 2 skipped (4)
  Duration  30.73s
Exit 1.
```

Both regressions passed in the clean candidate's independent full suite above, along with the unchanged crash, timeout, discard and checkpoint suites. Test 3 also asserts that only two runs hold the re-keyed file and that the edit's result is eventually stored; test 4 first observes the edit's PASS before releasing the backlog crash, then asserts that the edit's current PASS survives.

The disposable worktree was removed. These intentional red results are evidence for B1, separate from candidate verification; the candidate source and tests stayed untouched.

### Should-fix and nits

None. No new findings outside B1.

### What fits and next-wave inputs

The repair closes B1 without changing the settled lane-selection, capability-forwarding, per-run sweep or Vitest cancel behavior. `KEY_FORMAT_VERSION` remains 15 for this unreleased candidate, with the repaired source hash pinned to `ef314c953f520d87f2b3ec8d61963d3d8b5430cc05d22b601a0e5f1b5be6cbba`; the independent suite includes the passing key-format guard. The build regenerated all four plugin bundles with no tracked drift.

No further fix wave is required by this review. Slice 2 must retain the first review's inputs: each selected run carries its own snapshot, changed paths, key/claim ownership and process mark; W is the grant, at most `runner.tierSize`, one permit per backlog slot, with batched record commits and no permit for an edit's extra run. Vitest continues to cancel. This review does not authorize that later slice.
