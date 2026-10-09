# 004 wave 2.5 review

## Verification

Candidate: `068f6de4bca33f71761167569d75fd3958034010`, version 0.1.52. Supplied HEAD was `2e6bf6d`, a brief-only correction after the candidate. Executable checks and final probes ran detached at the named candidate, with no tracked changes. The worker branch was restored before writing this report.

Range: `d882196..068f6de`. In scope: 004-23 and the rebuilt bundles; 003-26's observed timer, scheduler entry point and runner-only refinement as a first review. The adjacent 001 work, including the signal identity repair, is excluded. This is the second and last review of 004-23; remaining blockers go to the human through the coordinator.

Node `v24.21.0`, except the explicitly named Node `v22.23.3` checks. Required commands and output:

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.52 lint
> biome check .
Checked 622 files in 403ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.52 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.52 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.52 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  260 passed | 1 skipped (261)
     Tests  2006 passed | 10 skipped (2016)
  Duration  156.42s
exit 0
```

`npm ci` warned that the optional watcher and esbuild installation scripts were not covered by `allowScripts`. Build left both committed plugins unchanged. The full suite ran once. Sampled host load was about 40 during verification. The suite also printed fixture worktree repair messages and its global setup's cleanup of a dead earlier run; the final gate passed.

Focused Node 22 gate:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
  /home/agent/.nvm/versions/node/v22.23.3/bin/node \
  node_modules/vitest/vitest.mjs run \
  test/daemon/observed-timer.test.ts test/scheduler/observed-growth.test.ts \
  test/scheduler/slow-activity.test.ts test/scheduler/slow-artifact.test.ts \
  test/status/slow-tier.test.ts test/delivery/slow-provenance.test.ts \
  test/delivery/slow-run-artifact.test.ts \
  test/harness/stop-require-slow-snapshot.test.ts \
  test/harness/stop-require-slow.test.ts test/harness/stop-slow.test.ts \
  test/scheduler/slow-trigger.test.ts test/scheduler/slow-lane.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  12 passed (12)
     Tests  66 passed (66)
  Duration  61.00s
exit 0
```

Independent probes used an owned `/tmp/squeal-004-24-*` directory, fixture stores and real node:test adapters. They changed no product code. Probe runs used an external Vitest config, one worker and no file parallelism. The final artifact probe used the public delivery interface, not a fabricated transition. The Stop probes replaced only the boundary before the real `endTurn` write, leaving the decision and write implementation intact. The startup probe connected the real lifecycle timer to the real scheduler using the daemon's callback contract. All scratch was removed before committing.

| Probe | Node 24 | Node 22 |
| --- | --- | --- |
| Inherited artifact, public delivery | 1 test passed, 0.566 s | 1 test passed, 0.584 s |
| Stop third retry, both harnesses, with initial artifact probe | 3 tests passed, 10.60 s | 3 tests passed, 2.09 s |
| Preload growth after startup, two affected files and no-growth control | 2 tests passed, 2.23 s | 2 tests passed, 1.99 s |
| Growth during baseline, production 5 s timer, then manual-refresh control | 1 test passed, 11.67 s | 1 test passed, 11.74 s |

Passing defect probes assert the wrong behavior described below. They do not mean those defects are fixed.

A separate background Squeal baseline at revision 4 reported failures in `test/daemon/handover.test.ts:72`, `test/daemon/step-down.test.ts:150` and `test/harness/stop.test.ts:176`. Each file passed in the candidate's full run and in a separate isolated Node 24 rerun, respectively 6, 3 and 8 tests. The last baseline failure measured 1,897.55 ms against 1,875 ms. These background observations are not the candidate full-suite gate, and no failure from them is assigned to this slice. No Node 22 full suite or macOS proof was made.

## Verdict

**FAIL at `068f6de`: 3 proven blockers, 0 should-fix findings, 1 informational nit.**

| Prior wave-2 blocker | Re-review result |
| --- | --- |
| B1, finished slow file still shown running | Closed. Completion and discard controls pass; activity is retired with recording, and rendering checks the named file. |
| B2, historical artifact taken from today's policy | The original policy-edit case is fixed. Inheritance still selects another run's declaration: B1 below. |
| B3, Stop decides on a torn read | The original torn-read case is fixed. The final bounded retry still releases the turn at an unchecked revision: B2 below. |

003-26 works after startup, including preload growth affecting an entire project. It loses a notification during baseline: B3 below. The green committed tests do not cover these three cases.

## Blockers

### B1. Proven: an inherited slow failure names the artifact of a later run at the same commit

Locations: `src/core/delivery/attribution.ts:66`, `:73`, `:77`; rendering at `src/core/delivery/provenance.ts:64`. Remaining wave-2 B2, in 004-23.

Spec 004 goal 4 and D8 require the artifact the failed run tested, not another run's declaration. `slowRunArtifact` identifies an inherited result by source worktree and commit only. The newest failing result with those fields wins. Two runs on different dirty states can share a commit while having different keys and artifact declarations.

Independent public-delivery reproduction on both Nodes:

1. Store a slow failure from worktree A at commit `abcdef`, source revision 1, key `k1`, declared artifact `dist-a/**`.
2. Worktree B inherits that failure under `k1`. Its known state retains A's origin and commit.
3. A changes the artifact declaration and bytes without committing, then stores another failure for the same check at source revision 2, key `k2`, declared artifact `dist-b/**`. Use a later `recordedAt`; both failures may have the same diagnostic fingerprint.
4. Deliver B's retained first failure through `createDelivery().onToolBoundary`. B has not re-keyed or run anything.

Both Nodes produced, in the same message:

```text
Slow tier: 1 test file; 1 current against dist-a/** as of revision 1.

first observed: FAIL, slow tier, Squeal's run in worktree wt-b at commit abcdef
 saw it, inherited at revision 1, against dist-b/** as of revision 1
```

The probe's `wt-b` is the source worktree, and its recipient still holds `k1`. The header reads the correct key's record; the failure line selects `k2`. This is a false historical claim even with no running daemon. The same selector is present in both shipped post-tool bundles at line 998.

Worker-sized fix: bind failure attribution to the result/key actually represented by the delivered state. A commit or fingerprint cannot identify that result. For a current state the current file key can discriminate; pending and stale retained failures also need an exact association, or must say the artifact is unknown when it cannot be recovered. Coordinate any persisted state or store interface change with the 001 owner. Add the same-commit/two-key inherited regression through public delivery, with equal-fingerprint and pending controls; retain the declaration-edit, removed-slow-marking and legacy-unknown cases.

### B2. Proven: Stop's third retry drops its revision guard and can release queued slow work

Locations: `src/harness/shared/stop.ts:119`, `:121`, `:133`; `src/core/delivery/delivery.ts`, `endTurn`'s `atRevision` check. Remaining wave-2 B3, in 004-23.

Spec 004 D7 says `stop.requireSlowSuite` blocks “while a slow file is not current at this revision.” `decide` now uses a coherent read transaction, and the first two attempts condition the end-turn write on that revision. On attempt three, `decision < STOP_DECISIONS` is false, so Stop passes `{}` and ends unconditionally.

Independent reproduction through both harnesses, on both Nodes:

1. Register a main consumer in a turn. One slow file is passing and current at revision 1; `requireSlowSuite: true`, `waitMs: 0`, no news, `stop_hook_active` absent.
2. Immediately before each of the first two real `endTurn` calls, commit an unrelated new revision from the fixture writer. The slow file remains current. The revision guard rejects each write and Stop retries.
3. Immediately before the third real `endTurn`, atomically queue the slow file under `k2` at revision 4 and refresh its check as pending.
4. The unguarded third call writes the idle turn and the hook returns empty stdout.

Measured output for each harness on each Node:

```json
{"options":[{"atRevision":1},{"atRevision":2},{}],"stdout":"","key":{"key":"k2","revision":4,"pending":"queued"},"states":[{"validity":"pending","pendingPhase":"queued"}]}
```

This forces legitimate writer commits at the real read/write boundary. It does not manufacture mismatched states inside the snapshot. Both committed Stop bundles contain the same unconditional final-attempt expression (`claude-code/dist/stop.mjs:3885`, `codex/dist/stop.mjs:3908`).

Worker-sized fix: preserve the guard on every attempt. At the retry bound, return a bounded policy block or decide and end in one short write transaction; do not silently authorize a revision never checked. Retain the two-second hook budget, slow-only no-wait behavior, mixed fast/slow wait, and `stop_hook_active` loop guard. Add this three-boundary regression for both harnesses.

### B3. Proven: the observed timer acknowledges growth while the scheduler cannot queue it

Locations: `src/core/daemon/daemon.ts:184`, `:187`, `:360`; `src/core/daemon/lifecycle.ts:193`; `src/core/scheduler/scheduler.ts:279`, with context assigned at `:153`. New finding in 003-26's first review.

003-26's outcome is that a worktree with no local edit stops holding a pass under a key missing another worktree's observed path within the reconciliation interval. The daemon sets `#loop` before awaiting `loop.start()`. During the scheduler's baseline, `#context` is still null, so `refreshObserved()` returns without queueing anything. The daemon callback nevertheless returns true, causing the timer to advance `observedSeen`. Later ticks see unchanged metadata and never ask again.

Independent reproduction on both Nodes, using the production **5,000 ms** timer interval:

1. Open two real node:test adapters and schedulers over one fixture store. A relative project `--require` preload computes a require of `nt/src/hidden.cjs`. Two test files check the resulting global value. A's helper exports 1; B's exports 2.
2. Start the actual lifecycle timer for B. Its callback calls `b.scheduler.refreshObserved()` and returns true, exactly as the daemon does once `#loop` exists.
3. Start B's scheduler, holding its first closure response after its environment and closure were computed. A runs and records the computed helper in the shared preload set. B is still in its baseline.
4. Wait for the timer to acknowledge that growth while B is held, then release B. It inherits A's pass under the environment key that lacks the helper.
5. Wait past another full five-second interval, without a local edit or another metadata write. B still has a pass and zero runs. A manual `refreshObserved()` now re-keys both files, runs them, and fails them.

Both Nodes printed:

```json
{"preloadGrowthRuns":[],"outcome":"pass","timerCalls":1}
{"manualRefreshOutcome":"fail","runs":["nt/test/control.test.mjs","nt/test/hidden.test.mjs"]}
```

Run order differed between Nodes; both files were selected. This uses an actual observed preload from A's run. The startup hold exposes the production scheduling window; the second five-second interval proves the acknowledged change is not retried after startup. The compiled CLI contains the same callback and early-return path in both plugins.

Worker-sized fix: acknowledge a changed observed snapshot only once a scheduler can retain or accept its refinement. Either make `refreshObserved` report acceptance and propagate it through the callback, or retain a startup notification and drain it after baseline. Do not count it as activity or introduce a revision. Add this timer-to-starting-scheduler preload regression, retain the after-startup two-file control and no-growth control, and keep the timer unref'd and cleared on shutdown.

## Should-fix

None beyond the proven blockers.

## Nits

### N1. Proven, informational: supplied HEAD is a brief correction after the candidate

`2e6bf6d` changes only `tasks/wave-2.5.md` to name the range and 003-26's first-round scope. Product code and bundles equal `068f6de`. Verification ran detached at `068f6de`; no repair is required.

## What fits

- **Wave-2 B1 is closed.** A completed slow run retires its activity in the transaction recording the results. A discarded run publishes the remaining queue's wait reason. The held-fast/two-slow-file controls, ordinary activity states and close cleanup pass on both Nodes. `liveActivity` also rejects a running label unless its named slow file has a running key row. No new slow file is started merely to publish a wait reason.
- **The original artifact-edit examples are fixed.** Selection captures the run's declaration; recording stores it with its run and observed-growth keys. Current headers use only current files' recorded declarations, including the origin worktree for inheritance. Legacy or evicted records say unknown; pending files contribute no artifact claim. Delivery retains a recorded slow run after policy removes its slow marking. These committed controls pass on both Nodes. B1 above isolates the remaining inherited-result selection error.
- **The original torn read is fixed.** `decide` reads states, keys and header in one read transaction. The committed writer-at-each-read matrix passes through both harnesses on both Nodes. `endTurn(atRevision)` tests the latest revision in its own write transaction. B2 concerns the caller abandoning that condition, not those transaction implementations.
- **Slow execution stays separate.** The existing trigger, lane, slow-only Stop and mixed-work controls remain green. No repair in this delta moves a fast file behind slow work or makes ordinary Stop wait for the slow tier.
- **003-26 after startup handles preload growth.** `invalidate([])` reports `recreatedProjects`, which makes refinement re-fetch the environment and every project file's closure. In the independent two-file control, both files re-keyed and failed with no local edit or new revision. The committed file-specific two-scheduler test and the no-growth controls also pass on both Nodes.
- **Timer lifetime and quiet behavior hold in the covered cases.** Reads are two point reads per configured project per interval, comparing serialized raw values. No changed metadata means no runner callback. Changed metadata can produce one empty refinement in its writing worktree, where the adapter already knows the paths, but no test rerun. The timer invokes no activity callback, is unref'd with the other timers, and is cleared on stop. The committed idle-exit and no-project tests pass on both Nodes. B3 is the acceptance gap during baseline.
- **Project addition boundary, read in source.** Policy reload restarts the timers and rebuilds their observed-key list, including a newly added project name. The daemon's actual adapter list is still constructed from startup policy in unchanged `#run`/`createNodeTestRunners` wiring; adding a new node:test project does not dynamically add its adapter. That limitation exists at `d882196` and is outside the range. Restart for a new project; do not mistake a newly watched meta key for a newly active runner. No new-project execution proof is claimed here.
- **Bundles match.** The clean rebuild reproduced both plugins. Source inspection of the compiled post-tool, Stop and CLI paths confirmed the three offending selectors/conditions are shipped, rather than source-only test paths. No store schema or product type was changed by this review.

## Inputs for the next wave

1. Take B1 and B2 to the human through the coordinator. They remain in 004-23's second and last review round; this report does not authorize another automatic repair round. Original wave-2 B1 need not be re-prosecuted.
2. B3 is a first-round 003-26 blocker. The lifecycle callback's true return must mean the scheduler retained the request. Preserve the existing five-second interval, no-content/no-revision refinement, queue coalescing, no-activity rule and shutdown clearing. Test the acceptance boundary during baseline with preload growth, not only a manual call after `idle()`.
3. Keep artifact identity tied to the represented result/key across current, pending and inherited states. If exact recovery is unavailable, use unknown. Do not use a commit or failure fingerprint as a run identifier. Any store or state provenance amendment needs its owner's agreement.
4. Every policy-authorized silent Stop must end at the revision it checked, including the retry bound. Bound execution time with a coherent decision or a block, while keeping the slow-only path immediate and honoring the loop guard.
5. The candidate's full Node 24 gate and focused Node 22 gate are green; the probes demonstrate missing coverage. Wave 3's two-harness e2e shapes and dogfooding remain planned, and Node 22 full-suite evidence remains the integration owner's responsibility.
