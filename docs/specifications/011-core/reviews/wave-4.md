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

## Wave 4, slice 2

**FAIL 1fb030983d7bdf265ebe218970c566ebd6cd6e6c**. Two proven blockers, one proven nonblocking should-fix item, zero nits. W4 of `tasks/wave-4.md`, reviewed 2026-10-20. Range: `4fe11939..1fb03098`. The slice 1 verdict and its closed B1 remain above; the finding IDs below are specific to slice 2.

### Verification output

HEAD matched the pinned candidate before checks and after the suite. The candidate tree was clean throughout these checks and before this append. Installation, lint, typecheck and build each exited 0. The build left all committed bundles unchanged.

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 10s

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

> squeal@0.1.225 lint
> biome check .

Checked 1476 files in 554ms. No fixes applied.
```

```text
$ npm run typecheck

> squeal@0.1.225 typecheck
> tsc --noEmit
```

```text
$ npm run build

> squeal@0.1.225 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.225 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

```text
$ git rev-parse HEAD
1fb030983d7bdf265ebe218970c566ebd6cd6e6c
$ git diff --exit-code
$ git status --porcelain
```

Both cleanliness checks exited 0 with no output. The full independent run took the host lock once, with four workers; the invocation below was wrapped in timestamps and load reads under that same lock. It exited 1. The one-minute load was 83.47 at start, sampled as high as 84.81, and 22.25 at finish (24 CPUs).

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Mon Oct 19 22:21:52 UTC 2026
 00:21:52 up 5 days, 13:10,  7 users,  load average: 83.47, 53.60, 32.92

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef

 ❯ test/daemon/vacant-wait.test.ts (6 tests | 1 failed) 24578ms
   ❯ a lock waiter decides again once it holds the lock (review 001-347, B2) (3)
     × a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10) 5201ms
 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 52241ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 30030ms
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef/test/fixtures/scheduler/.tmp/27c2efe8-e33b-4a77-8745-3c355b0ed4a8/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef/test/fixtures/scheduler/.tmp/f24540e7-8c2e-437d-bc82-42bb5ce308bf/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3020540
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10)
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/daemon/vacant-wait.test.ts:99:3
     97|   });
     98|
     99|   it("a vacant-lock waiter serves when a daemon of its own version cam…
       |   ^
    100|     const repo = createFixtureRepo();
    101|     repos.push(repo);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2007, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +47 (pid 2790278), dispose +117, input +1042, kill +2007 (pid 2790278); the held Stop's deadline: +2000
 ❯ reached test/harness/opencode/held-stop.ts:210:27
    208|     if (gone !== null) {
    209|       const message = `before ${what}, ${gone.why}\n${timeline(b)}`;
    210|       throw gone.missed ? new Missed(message) : new Error(message);
       |                           ^
    211|     }
    212|     if (Date.now() > limit) throw new Error(`${what}: not within ${BAR…
 ❯ test/harness/opencode-dispose.test.ts:172:9
 ❯ Object.afterReply test/harness/opencode-dispose.test.ts:112:7
 ❯ runOpenCode test/helpers/opencode.ts:204:11
 ❯ squealOpenCode test/harness/opencode/real.ts:75:17
 ❯ overtaken test/harness/opencode-dispose.test.ts:99:18
 ❯ test/harness/opencode-dispose.test.ts:170:21
 ❯ ordered test/harness/opencode-dispose.test.ts:66:14
 ❯ test/harness/opencode-dispose.test.ts:168:26

 ❯ test/harness/opencode-dispose.test.ts:69:17 notice
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2127, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +110 (pid 2775127), dispose +176, input +419, kill +2127 (pid 2775127); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2212, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +82 (pid 2782866), dispose +140, input +364, kill +2212 (pid 2782866); the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed | 742 passed | 1 skipped (745)
      Tests  2 failed | 6322 passed | 10 skipped (6334)
   Start at  00:21:54
   Duration  1139.61s (tests 97%, import 2%, transform 1%)

    Isolate  745 workers spawned · ~171ms startup each (spawn + environment, per file)
             at least ~31.71s faster with isolate: false — reuses workers across files instead of one per file

 00:40:54 up 5 days, 13:29,  6 users,  load average: 22.25, 28.50, 35.08
Mon Oct 19 22:40:54 UTC 2026
```

The only full-gate failures were `test/daemon/vacant-wait.test.ts:99` (5 s timeout) and `test/harness/opencode-dispose.test.ts:172` (the held Stop reached its 2 s idle deadline before the new turn request, after three missed-barrier attempts). Neither test file changed in this range. Both passed the focused two-file rerun below at the same clean candidate. This does not turn the full run green or establish the failures' root cause; these are verification observations, not blockers against this diff.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/daemon/vacant-wait.test.ts test/harness/opencode-dispose.test.ts --maxWorkers=4
Mon Oct 19 22:41:32 UTC 2026
 00:41:32 up 5 days, 13:30,  6 users,  load average: 19.15, 26.85, 34.24

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef


 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  00:41:32
   Duration  20.45s (tests 96%, transform 4%, import 1%)

 00:41:53 up 5 days, 13:30,  6 users,  load average: 21.13, 26.86, 34.09
Mon Oct 19 22:41:53 UTC 2026
```

The focused run exited 0. All slot-specific, stale-run, pool-cap, slow-lane and Vitest-cancel tests passed the independent full run.

**Adapted regression discrimination.** In a disposable detached worktree at this candidate, I changed only `supersededIn` to return `false`, then ran the two adapted cases under the host lock. Both failed on state/result assertions, rather than setup or timing prerequisites:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/edit-beside-backlog.test.ts -t '3\.|4\.' --maxWorkers=4
Case 3, line 288: storedBy(h, REKEYED, edit), expected true, received false.
Case 4, line 316: outcome(h, REKEYED), expected pass, received unknown.
 Test Files  1 failed (1)
      Tests  2 failed | 2 skipped (4)
   Duration  36.76s (tests 94%, transform 5%, import 1%)
Exit 1.
```

The same tests passed at the unmodified candidate in the full suite. The disposable worktree and the throwaway module probes were removed before the findings commit. Intentional red probe/mutation results are evidence for the findings and regression strength, not candidate gate failures.

Squeal's separate revision-0 baseline reported the two known recorder-fidelity observations (`run-reads-fidelity.test.ts:116`, `observe-fidelity.test.ts:119`, 001-390), plus `opencode-wake.test.ts:53`, `repository-inputs.test.ts:99`, `backlog-slots.test.ts:61` and `edit-beside-backlog.test.ts:309`. OpenCode wake and repository-inputs then recovered under the same inputs. The makespan assertion exceeded its 5% bound twice (16298.89 against 15637.59 ms; 15605.43 against 15161.28 ms); stale-crash case 4 missed its timing prerequisite twice (S2-S1). All six files passed the independent gate. No Squeal checkpoint substituted for this reviewer's run.

### Blockers

#### S2-B1. Proven: a failed slot record can terminate the daemon before its caller receives the rejection

Location: `src/core/scheduler/slot-records.ts:60`, `:70`, `:76`, `:90`; daemon caller `src/core/scheduler/scheduler.ts:663` and recovery `:675`.

C7: “A busy error of the pump or of a tier's record puts the tier's files back and resumes the pump after the same backoff, with no stall note.” W4 also requires that `SlotRecords` never lose a slot's results and that departure waits for slots in flight.

`record()` creates an inner `outcome` promise, then waits for the gather and the entire mutex drain before returning/adopting that promise. The drain rejects a failed slot's `outcome` immediately. If it then awaits another slot's unfinished reads, or its asynchronous record work, across an event-loop turn, that inner rejection has no handler yet. Handling the public `record()` promise does not handle the separate inner promise during this interval. Node's default unhandled-rejection behavior exits the process. The scheduler's `try/catch`, requeue and busy-resume paths have not received the error and cannot recover. The daemon installs no unhandled-rejection handler.

A disposable probe imported the candidate's unmodified `SlotRecords` and `Mutex`, opened two `node:sqlite` connections to a temporary database, and held `BEGIN IMMEDIATE` on one. The first slot's record attempted an insert on the other connection (`busy_timeout=1`); the next slot's ended/read promise resolved after 150 ms. Both public calls were immediately passed to `Promise.allSettled`. No candidate file changed. The process nevertheless exited 1 before the `allSettled` result:

```text
Error: database is locked
    at Object.record (/tmp/w4-slot-busy-probe.mts:16:75)
    at .../src/core/scheduler/slot-records.ts:74:61 {
  code: 'ERR_SQLITE_ERROR',
  errcode: 5,
  errstr: 'database is locked'
}
Node.js v24.21.0
```

The failure also has a minimal reproduction without SQLite (imports are the candidate's two modules):

```ts
const slots = new SlotRecords({
  lock: new Mutex(),
  record: async (value: string) => {
    if (value === "bad") throw new Error("record failed");
    return value;
  },
  commit() {},
});
await Promise.allSettled([
  slots.record(Promise.resolve("bad")),
  slots.record(new Promise<string>((r) => setTimeout(() => r("good"), 150))),
]);
```

This process exits 1 before `allSettled` returns. This is not a timing-dependent failure of the repository suite: the later pending read gives the failed promise a deterministic unhandled turn. In the daemon, a busy `#record` transaction and another ended slot still performing its completion-barrier reads provide these two inputs. A later record's own asynchronous preparation provides the same gap even when its initial reads already resolved.

**One-worker repair:** attach rejection handling to each outcome when it is created, or return that outcome immediately while a separately handled drain runs. Preserve one outcome per slot, FIFO recording and the single gathered commit; make every failure reach the existing scheduler recovery. Add a regression with the failed slot first and a later slot still pending across a turn, with both public promises handled. Exercise this in a child process with Node's default rejection behavior, and verify that the good sibling records once and the bad slot rejects without process exit. Retain the failed-commit and failed-read tests.

#### S2-B2. Proven: an edit stream can starve a slot lane's backlog past its required fairness turn

Location: `src/core/scheduler/tiers.ts:153`, `:180`; related slot admission `src/core/scheduler/slots.ts:47`.

C4 step 4: “After four tiers in a row of the first group only while the second waited, the next tier is the second group's, so edits that keep the first group full still move the backlog by one tier in five.” C15 preserves this rule for promotions too.

`RunQueue.ordered()` puts the backlog first on that fifth turn, but `selectTier` still sets `backlog` solely from whether any first-group work is queued. The new slot-specific skip then discards every non-first-group candidate while `backlog` is false, including the entry the fairness order deliberately put first. It picks another edit and calls `tierSelected(false)`. The backlog remains first in the queue order but is skipped again at every later boundary while edits or promoted waits keep coming. Existing slots can finish without replacement while the lane continues its edit tiers; a queued baseline, checkpoint or confirming rerun can wait indefinitely.

A cheap selector probe used the real candidate `RunQueue`, `newFileState`, `StatCache` and `selectTier`, with a minimal in-memory store/ledger boundary (no results, no foreign claims), `tierSize=1` and `backlogSlot=1`. It queued one backlog file and added one recent file before each of six selections. All entries were unforced. The candidate selected:

```text
Selected tiers: [["edit0"],["edit1"],["edit2"],["edit3"],["edit4"],["edit5"]]
Backlog still queued: true
AssertionError [ERR_ASSERTION]: The fifth tier must take the waiting backlog
'edit4' !== 'backlog'
Exit 1.
```

With only `backlogSlot` changed to `null` in the same probe (the existing tier path), the fifth selection is the backlog, it leaves the queue, and the assertion exits 0:

```text
Selected tiers: [["edit0"],["edit1"],["edit2"],["edit3"],["backlog"],["edit4"]]
Backlog still queued: false
```

The existing queue-only fairness test passes because it slices `queue.ordered()` directly, bypassing the selector's new skip. The new slots tests finish a backlog without a sustained first-group queue, so they do not discriminate this regression.

**One-worker repair:** make the owed backlog turn explicit in slot selection and admission, rather than treating all nonempty first-group queues as edit-only turns. Select an actual backlog slot for that turn, with `take(1)`, honoring the lane's W cap and host pool grant. Keep ordinary edit tiers limited to first-group files and permitless. Add scheduler/selector regressions with a backlog continuously waiting and edits or promotions replenished for more than five turns, including when other backlog slots and an edit tier overlap. Assert the fifth turn advances the backlog without exceeding W.

### Should-fix

#### S2-S1. Proven, nonblocking: stale-crash test 4 relies on a timing lead rather than enforcing its completion order

Location: `test/scheduler/edit-beside-backlog.test.ts:299`, `:309`.

The adapted case makes the new run sleep 3 s less, waits for its PASS, and then requires the old run still to be open. That sleep difference does not order process starts or recording under load. Squeal's clean revision-0 baseline failed this candidate twice at the `expect(backlog.end).toBeNull()` prerequisite, with observed end times `52744.473282` and `45503.383027`; the later stale-crash state assertion was never reached. The coordinator separately reported the same test failing under load 75. These are observations about the regression's timing, not proof that the product's stale-run guard failed.

**One-worker fix:** hold the old run's crash report behind an explicit test barrier, release it only after the newer PASS is recorded, and then assert that the PASS survives. Keep case 3's opposite completion order and verify both cases fail for their state assertions with `supersededIn` disabled. This keeps the test's intended property while removing the race in its prerequisite.

### Nits

None.

### What fits

- The new capability is runner-owned. The shipped factories answer one file for node:test, the configured/default batch size for pytest, and no slot for Vitest. Composite ownership, recovering runners before adapter creation, slow-instance and sweep wrappers forward it. Pytest packing stays within a part, packs light files, and leaves a heavy file alone.
- Ordinary backlog slots use `take(1)`, release their lease when execution ends and refill without waiting for their delayed record. Active backlog slots are capped by `runner.tierSize`; the host pool can reduce the width further. Slow lanes keep their slow-tier selection path. Vitest retains its wall-budgeted tiers and cancel.
- Each slot retains its snapshot, changed-path set, key, checkpoint and per-run process mark. The unchanged `supersededIn` check precedes per-file state mutation in `recordTier` and error cleanup, preserving the slice 1 repair for newer-key runs/results.
- Successful gathered records use the scheduler mutex, keep enqueue order and commit once after the records in the batch. Edit tiers bypass gathering and use their immediate record path. S2-B1 concerns failure delivery while that batch is still draining.
- The adapted `edit-beside-backlog` cases still follow the old run of the re-keyed file; case 3 observes the newer run pending, and case 4 observes its PASS before the old crash. `backlog-wall-latency` now checks one-file runs and the one-slot wait. `capacity-project` waits for demand 3 with grant 2 and still checks the repository root's cap.
- The notes record the required real pytest comparison and host load, and the 16-file makespan, departure, 300-file overhead and other-daemon capacity tests cover the five done-when scenarios. Those scenarios do not cover the two failure cases above.
- `KEY_FORMAT_VERSION` rises from released 15 to 16 with a new pin. Version 0.1.225 and all four committed plugin bundle trees rebuild without drift.

### Inputs for the fix wave and next wave

Repair S2-B1 and S2-B2 before landing this candidate; include S2-S1 in the focused test repair. A single scheduler worker can own `slot-records.ts`, `tiers.ts`, `slots.ts`, the queue's fairness seam if needed and focused regressions. Keep `RunnerAdapter.backlogSlot`, per-run snapshots/marks, per-slot leases and the slice 1 stale-run guard unchanged. Re-pin the guarded source hash after the repairs and rebuild the bundles in the coordinator's release commit.

Re-review the repair delta against both blocker scenarios, with the existing departure/stop, throughput, pool-cap, Vitest-cancel and stale-run cases kept green. No new runner capability or store schema is needed. The known forced-queue promotion gap and delayed failure-confirmation observation in slice 1's notes predate this range; they are not additional findings here. A continuing first-group stream starving confirmation because of S2-B2 is the new regression.

The subsequent 011-22 pull/re-key classification and 011-23 cross-worktree adoption work remain separate rows. Neither should be used to absorb these slot correctness repairs.


## Slice 2 re-review

**PASS c141fa8fc3b16492106f7f1ed9ece4a7ff321bbf**. Zero blockers, zero should-fix items, zero nits; one nonblocking follow-up note. W4r of `tasks/wave-4.md`, reviewed 2026-10-20. Bounded repair range: `1fb03098..c141fa8f`. S2-B1, S2-B2's starvation scenario and S2-S1 are closed. The settled slice 1 and slice 2 findings above were not re-prosecuted.

### Verification output

The reviewer checked out the exact candidate, with no tracked or untracked changes. The following checks ran there; each exited 0. Build regenerated all four plugin bundles without any tracked drift. The findings append is made separately on top of `origin/main`, as W4r requests.

```text
$ git rev-parse HEAD
c141fa8fc3b16492106f7f1ed9ece4a7ff321bbf
$ git status --porcelain
(no output)
```

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 7s

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

> squeal@0.1.225 lint
> biome check .

Checked 1474 files in 686ms. No fixes applied.
```

```text
$ npm run typecheck

> squeal@0.1.225 typecheck
> tsc --noEmit
```

```text
$ npm run build

> squeal@0.1.225 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.225 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

The coordinator reports the following independent locked full gate at this exact candidate, exit 0. This is coordinator evidence, not a second reviewer full run. The resume explicitly says to repeat it only if the delta gives reason to doubt it. The small repair delta and focused checks below give no such reason; no second full suite or Squeal checkpoint was run for W4r.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  745 passed | 1 skipped
      Tests  6327 passed | 9 skipped
   Duration  848.92s (tests 98%, import 2%)
Exit 0 (coordinator-reported).
```

The reviewer's own focused locked run at the clean candidate covered both new regressions, all four edit-beside-backlog cases and the key-format guard:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/slot-records.test.ts test/scheduler/slots-backlog-turn.test.ts test/scheduler/edit-beside-backlog.test.ts test/keys/key-format.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef


 Test Files  4 passed (4)
      Tests  39 passed (39)
   Start at  09:31:31
   Duration  50.17s (tests 94%, transform 5%, import 1%)
Exit 0.
```

After these checks, HEAD still matched the candidate, `git diff --exit-code` exited 0, and `git status --porcelain` printed nothing. Disposable probes and the mutation worktree were removed before writing this append.

Squeal was also queried after returning to the documentation base. It reported no verdict for the findings file because no test closure reads it, the two known daemon-only recorder-fidelity failures (001-390), and its baseline still running. Those observations are at the documentation base, not candidate verification; they do not replace either locked run above.

### Previously blocking findings

**S2-B1 — closed, proven.** `src/core/scheduler/slot-records.ts:67` attaches `outcome.catch` immediately, before either gathering or draining can reject it. The original rejected outcome still reaches the handled public promise; the catch only prevents the premature unhandled event. A plain Node child process imported the candidate's `SlotRecords` and `Mutex`, opened two real SQLite connections, held `BEGIN IMMEDIATE` on one and attempted an insert on the other with `busy_timeout=1`. A sibling's reads stayed pending for 150 ms. Both public calls were immediately passed to `Promise.allSettled`. The child asserted the first rejection's `errcode === 5`, the sibling's fulfillment, one sibling record and one commit:

```text
SQLITE_BUSY rejected to caller; good sibling recorded once; commits=1; exit 0
```

In the disposable worktree, removing only the new outcome handler made the new `slot-records.test.ts` case fail at line 91 with `[Error: record failed]` instead of an empty unhandled-rejection list. Existing failed-record, failed-read and failed-commit cases pass at the candidate.

**S2-B2 — starvation scenario closed, proven.** `RunQueue.backlogTurn()` exposes the same counter used by queue ordering; `selectTier` no longer skips the ordered backlog on that turn. The original selector scenario was repeated with the real `RunQueue`, `newFileState`, `StatCache` and `selectTier`, one backlog file waiting and one recent file added before every selection, all unforced:

```text
Selected tiers: [["edit0"],["edit1"],["edit2"],["edit3"],["backlog"],["edit4"]]
Fifth tier advances backlog; exit 0
```

Removing only `!ledger.queue.backlogTurn()` from the skip restored six edits, with `edit4` instead of backlog fifth, and the probe exited 1. The new real-scheduler `slots-backlog-turn.test.ts` passes at the candidate; without that condition it started only seven runs (one held slot plus six edits), then failed its eighth-start assertion at line 48. This directly discriminates the reported starvation. The capacity classification of the fairness turn is the separate note below.

### Previously nonblocking finding

**S2-S1 — closed, proven.** `test/scheduler/edit-beside-backlog.test.ts:119` now holds the old run's crash report behind a promise. Case 4 releases it only after the newer PASS is observed and the old run is confirmed open (`:317`–`:319`); `onTestFinished` also releases it on assertion failure. Its completion order no longer depends on the sleep lead.

In a disposable detached candidate worktree, the two fixes were removed independently at their respective source sites and `supersededIn` was disabled. The same focused mutation run confirmed all four regressions fail for the intended properties:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/slot-records.test.ts test/scheduler/slots-backlog-turn.test.ts test/scheduler/edit-beside-backlog.test.ts -t 'leaves no rejection|runs a backlog file|3\.|4\.' --maxWorkers=4
slot-records:91: unhandled list contains Error("record failed").
slots-backlog-turn:48: started.length is 7, expected at least 8.
edit-beside-backlog case 3:283: pending is queued, expected running.
edit-beside-backlog case 4:325: outcome is unknown, expected pass.
 Test Files  3 failed (3)
      Tests  4 failed | 6 skipped (10)
   Duration  36.75s (tests 86%, transform 12%, import 2%)
Exit 1 (intentional mutation).
```

Cases 3 and 4 both reach their state assertions; neither red result is a setup or ordering prerequisite failure. The four test cases pass in the unmodified candidate's focused run above.

### Follow-up note

**S2r-N1 — proven behavior, nonblocking under the explicit W4r scope: the fairness turn retains the existing edit-tier capacity classification.** Location: `src/core/scheduler/tiers.ts:153`, `:206`, `:222`; `test/scheduler/slots-backlog-turn.test.ts:26`. While edits remain queued, `backlog` remains false even when the fifth selection takes a backlog-only file. It therefore has no `slot` marker and does not call `capacity.take(1)`. A capacity spy added to the selector probe recorded zero permit requests through all six selections, including the fifth. The new scheduler regression deliberately runs that turn beside a held slot at `tierSize=1`.

C4's fifth-selection requirement is satisfied; this note does not reopen its starvation scenario. The repair preserves the earlier tier route for fairness, rather than making the fairness turn an ordinary permitted slot as the original suggested repair proposed. C10's slot-budget treatment of that turn deserves a separate row, especially before widening pull/re-key work. One worker can make queue priority and execution/capacity classification explicit, then add a capacity-spy regression with W slots held and edits queued, covering both single-file node:test and packed pytest turns. W4r expressly sends anything outside its three closure checks to a later row.

### What fits

- The two product fixes change only early outcome handling and whether the selector skips the owed turn. They add no runner interface, schema or transaction boundary.
- Queue ordering and admission use the same `backlogTurn` predicate. The new regression exercises the scheduler, rather than slicing queue order alone.
- The original stale-run guard remains unchanged; its two opposite completion orders are demonstrably covered after the barrier repair.
- `KEY_FORMAT_VERSION` remains 16, the pin passes `key-format.test.ts`, `slots-backlog-turn` is in `test/version-sensitive.txt`, and all four committed plugin bundles rebuild without drift.

### Inputs for the next wave

No further repair is required for W4r's three closure checks. Keep immediate rejection handling on both the input-read and outcome promises; keep the backlog-turn predicate shared with queue order; preserve the explicit crash barrier and both stale-run state assertions. Carry S2r-N1 as a separate capacity follow-up, without claiming the fifth-turn test proves slot-width or permit accounting. The previously settled runner, recording, departure, pool, pytest and Vitest boundaries above remain the inputs to 011-22 and 011-23.


## Slice 2, third check

**PASS 0e23edf793d7da405cba757970be7a9b3c862d7e**. Zero blockers; one nonblocking test-cleanup note. This last bounded check covers only `c141fa8f..0e23edf7`, as requested by the coordinator on 2026-10-20 after branch CI exposed timing assumptions. The earlier product verdict and its settled findings stand.

### Verification output

HEAD matched the requested candidate, and the tree was clean before and after the focused run. The delta contains only `test/scheduler/edit-beside-backlog.test.ts` and `test/scheduler/backlog-slots.test.ts`. A direct diff confirms no changes to product code, plugin bundles, package manifests or key sources. Node v24.21.0; host load sampled during the checks was 18.32–21.71 on 24 CPUs. This was a focused check of the two requested properties; general gates and a full suite were not repeated at this test-only candidate.

```text
$ git rev-parse HEAD
0e23edf793d7da405cba757970be7a9b3c862d7e
$ git status --porcelain
(no output)
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/edit-beside-backlog.test.ts test/scheduler/backlog-slots.test.ts -t 'keeps the edit|runs 16 files' --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef


 Test Files  2 passed (2)
      Tests  3 passed | 4 skipped (7)
   Start at  09:42:00
   Duration  31.90s (tests 93%, transform 6%, import 1%)
Exit 0.
```

### Requested closure checks

**Both stale-run tests still discriminate — proven.** Case 3 holds the edit's completed runner call before publishing its report, so the old backlog run can record while the newer run still holds the file. Its explicit release follows the running-state assertions; case 4's crash barrier remains intact. Both cases pass at the candidate.

In a disposable detached worktree at this candidate, `supersededIn` was changed to return `false`. The exact candidate tests then failed at their intended state assertions, after their ordering prerequisites had passed:

```text
edit-beside-backlog case 3, line 291:
  expected row.pending running; received queued.
edit-beside-backlog case 4, line 334:
  expected outcome pass; received unknown.
```

Case 3 additionally hit the cleanup timeout described below; this did not replace or obscure its state assertion failure.

**The 15% bound still separates slots from the tier barrier — proven for this fixture.** The unmodified slot-mode case passes the new assertion, the W=4 peak-width assertion and the per-file progress assertion. For the control, the same disposable worktree changed only the makespan case's harness option to `slots: false`, retaining its durations, W=4 pool and 20 s timeout/wall budget. The control fails at the makespan assertion itself, before its progress assertion:

```text
011-21 slots: 16 files in 17880 ms against list scheduling's 13985 ms (27.9 %), 1 progress steps
backlog-slots.test.ts:63:
  actual 17879.747802734375 ms
  expected <= 16082.19493408203 ms (list * 1.15)
```

Thus the widened CI tolerance still rejects the tier barrier in the requested comparison. This check does not establish a universal 15% threshold or verify the original 5% target under load; the quiet-host 2.2–3.6% measurements in the comment remain prior coordinator evidence.

The controls ran together under the host lock, with only those two independent mutations (the stale-run guard and the makespan harness's slot switch):

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/edit-beside-backlog.test.ts test/scheduler/backlog-slots.test.ts -t 'keeps the edit|runs 16 files' --maxWorkers=4
 Test Files  2 failed (2)
      Tests  3 failed | 4 skipped (7)
   Duration  137.84s (tests 97%, transform 3%)
Exit 1 (intentional controls).
```

The disposable worktree was removed before this findings append. No candidate implementation or test was changed by the reviewer.

### Nonblocking note

**S2t-N1 — proven: case 3's assertion-failure cleanup waits on its own barrier.** Location: `test/scheduler/edit-beside-backlog.test.ts:270`, `:291`, `:297`; teardown `test/scheduler/helpers.ts:59`. With the guard disabled, case 3 fails at the expected pending-state assertion before its normal `release()` call. Its `onTestFinished(release)` then runs after the shared `afterEach` teardown, whose `scheduler.close()` waits for that held edit. The control therefore also reports `Hook timed out in 120000ms` from `helpers.ts:59`. The green candidate does not take this path; both requested state assertions still discriminate, so this is a nonblocking diagnostic/cleanup note. One-worker fix: put case 3's held section in `try/finally` and release there, before teardown, retaining the explicit ordering and state assertions.

### What fits and inputs for the next wave

Both stale-state completion orders remain covered; the added barrier removes case 3's sleep-based ordering assumption without weakening its state assertions. Slot mode passes while the tier control misses the 15% bound by 12.9 percentage points. No further repair is needed for these two bounded checks. Carry S2t-N1 into a test-cleanup row and keep the earlier S2r-N1 capacity note separate. This append follows the prior `ed35b8ce` re-review commit on the branch rooted at `origin/main`; the coordinator must retain both findings commits when integrating them.


## Slice 2, CI overhead check

**PASS 39bee6e575a5ed527a30300ca459374771cd6e03**. Zero blockers, one proven nonblocking should-fix. Bounded test-only check of `0e23edf7..39bee6e5`, requested 2026-10-20 after branch CI 39388147377. The requested no-gather discrimination was **not** confirmed: setting the gather delay to zero still passes this test on this host. No product/spec break is proven by that observation, so it does not block the candidate under the reviewer rules.

### Verification output

HEAD matched the exact candidate; the tree was clean before and after its focused check. The delta changes only the CI timing tolerance and its comment in `test/scheduler/backlog-slots-overhead.test.ts`; product code, bundles and key sources are unchanged. Node v24.21.0, 24 CPUs; sampled host load during these checks ranged from 21.31 to 45.55. General gates and the full suite were not repeated for this bounded test-only check.

```text
$ git rev-parse HEAD
39bee6e575a5ed527a30300ca459374771cd6e03
$ git status --porcelain
(no output)
$ CI=true flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/backlog-slots-overhead.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  09:52:31
   Duration  171.95s (tests 97%, transform 3%)
Exit 0.
```

In a disposable detached candidate worktree, the sole behavioral mutation was replacing `const gather = Math.max(SLOT_GATHER_MS, SLOT_GATHER_COMMITS * this.#commitMs)` with `const gather = 0` in `SlotRecords.record`. The overhead test also wrote its already-computed timings and commit counts to a scratch JSON file; its workload, assertions and thresholds were unchanged. Running the same command with `CI=true` produced:

```text
RUN  v5.0.3 /tmp/w4-overhead-mutation


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  09:55:24
   Duration  134.57s (tests 96%, transform 4%)
Exit 0 (the intentional control unexpectedly passes).

Zero-gather measurements:
slots: 24687.211473 ms / 226 commits; 22713.333080 ms / 224 commits.
tiers: 26535.047247 ms / 1 commit; 19224.817227 ms / 1 commit.
best slots / best tiers: 1.181459.
```

The disposable worktree was removed before appending this review. A direct `SlotRecords` bypass was not run: the allowed zero-delay control already answers the requested question negatively. Setting zero delay retains opportunistic batching of records that happen to be ready together; that is precisely why the existing count assertion can pass.

### Should-fix

**S2o-S1 — proven: the current commit-count assertion does not reliably protect the relaxed CI bound against loss of the configured gather window.** Location: `test/scheduler/backlog-slots-overhead.test.ts:75`, `:79`, `:81`.

The comment says the count assertion still fails records that stop gathering. The zero-delay control instead made 226 and 224 commits for 300 files, both below 300, and its best timing ratio was 1.18146. It passes the new CI branch and would also satisfy the unchanged 1.2 threshold numerically on this host. The mutation therefore exposes an existing weakness of this discriminator; raising the CI bound did not create the entire weakness. Passing this control does not prove a performance regression: that run still batches incidentally and meets the host's timing target. It disproves the claim that this test reliably rejects loss of the intentional gather delay.

**Judgment:** the 1.6 CI tolerance needs a stronger batching discriminator as a should-fix; the present `commits < files` assertion is insufficient justification on its own. A CI noise allowance is supported by the actual failed run, whose logs I read with `gh run view 39388147377 --log-failed`: slots took 27937 ms / 82 commits and 21267 ms / 71 commits; tiers took 30035 ms and 14627 ms. Batching was active in that run despite the 1.45 timing ratio, and the reference varied by over 2×. A strict timing ratio on a loaded runner cannot by itself settle whether gathering works.

**One-worker fix:** retain the CI timing allowance if needed, then replace the merely-less-than-300 assertion with a calibrated batching budget that separates normal gathering from the no-delay control, or add a deterministic gated integration discriminator of the gather window. The normal evidence is 71–82 commits in this CI failure and 75–148 in the slice notes, against 224–226 here without the window; choose and verify the budget against both modes rather than deriving it from this single host run alone. Keep the non-CI 1.2 check and describe CI's assertion as a noise tolerance, not proof of the 1.2 goal. Update the comment so it claims only what the counterfactual demonstrates.

### What fits and next inputs

The changed test still checks 300 single-file runs, all stored passes, a single run for each tier control and fewer commits than files; it passes at the exact candidate with the CI branch enabled. Earlier product, stale-run and timing-control findings stay settled. No additional product repair is required by this bounded check. Carry S2o-S1 into test-quality work; do not cite this overhead test as proof that removing the configured gather delay must fail. This append follows `e678a174` and changes the findings file alone.


## Slice 2, commit-budget re-check

**PASS 7cbbd8370f69c439f466f0637e0a67b99337b402**. S2o-S1 closed; zero blockers and zero new findings. Bounded test-only check of `39bee6e5..7cbbd837`, requested 2026-10-20. The earlier product verdict and the other settled findings remain unchanged.

### Verification output

HEAD matched the requested candidate and the tree was clean before and after the focused test. The diff changes only `test/scheduler/backlog-slots-overhead.test.ts`: each slot pass must now use at most `FILES * 0.6`, or 180 commits, and its comments explain that budget. Product code, bundles and key sources are unchanged. Node v24.21.0, 24 CPUs; sampled host load was 15.01–22.18 during these checks. No general gates or full suite were repeated for this bounded check. Branch CI 39390627789 was still in progress when queried; the verdict below uses the reviewer's focused evidence.

```text
$ git rev-parse HEAD
7cbbd8370f69c439f466f0637e0a67b99337b402
$ git status --porcelain
(no output)
$ CI=1 flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/backlog-slots-overhead.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/efeadf4c-ff0f-41d8-9c00-80cdea0f47ef


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  10:04:06
   Duration  108.24s (tests 98%, transform 2%)
Exit 0.
```

A disposable detached worktree at this exact candidate changed only `SLOT_GATHER_MS` from 25 to 0 and `SLOT_GATHER_COMMITS` from 3 to 0. The test was unchanged. The same CI-enabled command then failed at the new commit budget:

```text
$ CI=1 flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/scheduler/backlog-slots-overhead.test.ts --maxWorkers=4
RUN  v5.0.3 /tmp/w4-budget-mutation

stdout | test/scheduler/backlog-slots-overhead.test.ts > scheduler: a node:test backlog in one-file slots, per-file overhead (task 011-21 slice 2) > 3. runs 300 files of about 50 ms within 1.2 times one tier's time, with fewer commits than files
011-21 slots: 300 files in 27120 ms in 300 runs and 241 commits, 23458 ms in 300 runs and 229 commits; one tier 25761 ms in 1 runs, 19968 ms in 1 runs (best 1.17 times)

 ❯ test/scheduler/backlog-slots-overhead.test.ts (1 test | 1 failed) 127529ms
   ❯ scheduler: a node:test backlog in one-file slots, per-file overhead (task 011-21 slice 2) (1)
     × 3. runs 300 files of about 50 ms within 1.2 times one tier's time, with fewer commits than files 127527ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/scheduler/backlog-slots-overhead.test.ts > scheduler: a node:test backlog in one-file slots, per-file overhead (task 011-21 slice 2) > 3. runs 300 files of about 50 ms within 1.2 times one tier's time, with fewer commits than files
AssertionError: expected 241 to be less than or equal to 180
 ❯ test/scheduler/backlog-slots-overhead.test.ts:77:28
     75|       // Records that gather commit 71 to 148 times a pass, here and o…
     76|       // commit 224 to 226 times (review wave-4, slice 2 overhead chec…
     77|       expect(pass.commits).toBeLessThanOrEqual(FILES * 0.6);
       |                            ^
     78|     }
     79|     // 1.2 on this host (1.09 measured). A 4-vCPU CI runner took 1.45 …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  10:05:55
   Duration  130.41s (tests 98%, transform 2%)
Exit 1 (intentional zero-gather control).
```

The zero-gather passes used **241 and 229 commits**, both above 180. The first failed at `backlog-slots-overhead.test.ts:77`, `expected 241 to be less than or equal to 180`. Its best timing ratio was still only 1.17, so the red result discriminates gathering independently of the relaxed timing ratio. No setup, state or teardown failure substituted for that assertion. The disposable worktree was removed before this append; the reviewer changed no candidate code or test.

### Closure and next inputs

**S2o-S1 — closed, proven for the requested control.** The normal candidate passes the same test that rejects the zero-gather mutation. The 180-commit budget allows headroom over the earlier normal 71–148 observations while rejecting both this control's 229–241 and the previous control's 224–226. The CI-only 1.6 timing tolerance is acceptable with this separate batching discriminator; the local 1.2 threshold remains unchanged. This does not convert CI's timing allowance into proof of the local 1.2 performance goal.

Preserve the commit budget, both timing branches and the single-file/run assertions. When changing the batching strategy or recalibrating this fixture, compare normal and zero-gather modes again rather than relaxing the budget from a timing failure alone. No further repair is needed for this bounded check; earlier unrelated notes remain as previously recorded. This findings-only append follows `e1cb0be7`.
