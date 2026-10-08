# 004 wave 1 review

## Verification

Candidate: `7314670419beca6548d039692a8d36ea3d496054`, version 0.1.45.
Range: `687fb0e^..7314670`. Reviewed 004-12, 004-13, 004-19 with 003-37, 003-36 and 003-38. The surrounding 001 work is out of scope. Spec 004 and its amendment log, and spec 003's amended preload contract, are the inputs.

The supplied worktree started at `91890f8`, one documentation-only commit after the candidate. Verification below ran with HEAD detached at the exact candidate, with no tracked changes. The branch was restored before writing this file. See N1.

Node `v24.21.0`. Commands and output:

```text
$ npm ci
added 56 packages, and audited 57 packages in 3s
18 packages are looking for funding
found 0 vulnerabilities
```

npm also warned that the optional watcher and esbuild install scripts were not covered by allowScripts. The verification commands could run.

```text
$ npm run lint
> squeal@0.1.45 lint
> biome check .
Checked 591 files in 643ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.45 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.45 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.45 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output, including no plugin bundle drift)

$ npx vitest run
Test Files  7 failed | 231 passed | 1 skipped (239)
     Tests  7 failed | 1894 passed | 10 skipped (1911)
  Duration  320.41s
exit 1
```

The full-suite failures:

| File and line | Observed failure | Serial rerun |
| --- | --- | --- |
| `test/cli/codex.test.ts:102` | CLI test exceeded 5 s | Passed |
| `test/daemon/lifecycle.test.ts:101` | Daemon exited idle before readiness was observed | Passed |
| `test/delivery/registered.test.ts:400` | Test exceeded 5 s | Passed |
| `test/e2e/worktrees.test.ts:100` | Expected silence, received a daemon-recovery header | Passed for both harness cases |
| `test/scheduler/first-observation.test.ts:146` | Expected at most two runs, received three | Failed again |
| `test/watcher/linked-dirs.test.ts:64` | First batch held `lib`, but not `lib/a.ts` | Passed |
| `test/runners/node-test/fixtures.test.ts:265` | Generated fixture's Node run exited 1 | Passed |

The discriminating rerun used the original timeouts and one worker:

```text
$ npx vitest run test/cli/codex.test.ts test/daemon/lifecycle.test.ts \
  test/delivery/registered.test.ts test/e2e/worktrees.test.ts \
  test/scheduler/first-observation.test.ts test/watcher/linked-dirs.test.ts \
  test/runners/node-test/fixtures.test.ts --maxWorkers=1 --no-file-parallelism \
  -t 'touches nothing under|a registered consumer keeps|are read in one query|runs only the affected files of an edit there|read through a directory link|lists the files behind the link at start|writes 1,000 modules'
Test Files  1 failed | 6 passed (7)
     Tests  1 failed | 7 passed | 65 skipped (73)
  Duration  99.39s
exit 1
```

The remaining assertion is reproducible candidate evidence. Its cause in this wave is **unverified**: the test and the first-observation recorder/stability implementation are unchanged by the reviewed slice, and it declares no slow files. It is not a third blocker against this slice. The host's load average was 106.70 during verification. Passing serial reruns do not make the full-suite gate green.

The background Squeal checkpoint separately reported eight known failures at revision 2, including version-handover and hook timing failures not present in this direct run. Those reports are not substituted for the clean candidate proof above. No all-green claim is made.

Focused probes used only an owned `/tmp` directory, fixture stores and slot directories. They ran candidate code after the clean build, with the source recorder and reporter supplied explicitly to the raw node:test runner. The source adapter was used for the child-mark probe. Scratch was removed before committing. No product code changed. One full suite was run; Node 22 coverage is the focused probes below, not a second full suite.

## Verdict

**FAIL `7314670`: 2 proven blockers, 1 proven should-fix, 1 proven informational nit.**

The idle trigger is not rechecked after a load wait. Stop's wait still includes the newly separate slow queue. Both break explicit wave-1 requirements. The two probes settle these independently of the suite failures.

## Blockers

### B1. Proven: an idle-triggered slow file can start after the consumer enters a turn

Location: `src/core/scheduler/slow-tier.ts:145`, `:186` to `:214`.

Spec 004 D2: "While a consumer is in a turn and no explicit trigger asked, slow files stay pending." Row 004-12's done-when also says nothing slow runs while a consumer is in a turn. An already running file may finish; this probe concerns a file that has not started.

`#candidate()` checks consumer turn state before acquiring the slot and awaiting capacity. `#select()` checks fast work and queue membership after the wait, but does not check the trigger again. A prompt or tool call can change the turn state without producing a filesystem batch, so `preempt()` does not cover this case.

Reproduction on Node 24.21.0 and 22.23.3:

1. Create a fixture scheduler with one slow file, a registered idle consumer, no fast files, an injected load of 4 per CPU and a threshold of 1. Use a private slot, a 25 ms recheck and a 2,000 ms guard budget.
2. Wait until the guard has read the high load. No runner call has started.
3. Use the real delivery turn state to mark the consumer in-turn. Send no slow or full-suite request and no file batch.
4. Drop the injected load to zero. The fake runner records the consumer's state when called.

Both Nodes returned:

```json
{"guardStarted":true,"consumerEnteredTurnBeforeLoadDropped":true,"runs":[{"files":[{"project":"","path":"slow.test.js"}],"turn":"in-turn"}]}
{"slotFreeAfterClose":true}
```

Worker-sized fix: recheck the selected file's trigger under the scheduler lock after the guard, before removing it from the queue or calling `startTier`. Require idle consumers, an open slow request, or that file's open run-all checkpoint. If the trigger disappeared, leave the file pending and release the slot. Add the probe as a scheduler test, plus a control showing explicit requests still run in-turn. Keep the remaining guard budget across this deferral.

### B2. Proven: Stop waits its configured budget when only slow files are pending

Boundary: the new slow pending class in `src/core/scheduler/queue.ts:92` and `src/core/scheduler/slow-tier.ts:214`, consumed by `src/harness/shared/stop.ts:88` and `:172` to `:180`.

Spec 004 D9: "Stop never waits for slow files". Row 004-12 explicitly requires that the silent Stop records them pending and "nothing waits for them". This is an integration omission introduced by keeping slow files in the aggregate pending state; the existing Stop wait helper itself is unchanged.

`waitForPending()` still polls aggregate `isPending(header)`, which includes queued or running slow files. No slow-file filter was wired into the caller. `endTurn()` correctly records slow files, but is reached only after this wait.

Reproduction on Node 24.21.0: a fixture store with a registered in-turn main consumer and one queued test-file row, declared slow by policy. No fast file, runner refinement, failure or undelivered news. Call the real `stopTurn()` with daemon ensuring stubbed as alive. Change only `stop.waitMs` between calls:

```text
waitMs 0:   elapsedMs 14,  outcome null
waitMs 400: elapsedMs 478, outcome null
```

Both calls ended idle and recorded the same pending slow file and key. The pending header was `counts.pending: 0`, `testFilesWithoutChecks.pending: 1`, `runnerPartPending: false`. The elapsed wait is unnecessary slow-only waiting, not a full-suite policy block. The default wait is zero, so a project must configure a positive `stop.waitMs` to encounter it.

Worker-sized fix: Stop's waiting predicate must count only fast pending files/checks, while still waiting for unapplied runner refinement. Keep slow files in status and in the silent Stop's `endTurn()` snapshot. Add an actual Stop-hook test with a positive wait and only slow pending; it must return promptly and record the slow file. Add a mixed fast/slow case that waits for fast completion then returns while slow remains pending. Check both harnesses through their shared Stop path. Do not change full-suite checkpoint coverage or fold the future `stop.requireSlowSuite` block into this wait.

## Should-fix

### S1. Proven: a real preload's `createRequire` load lands in test closures

Location: `src/runners/node-test/run/observed.ts:55` to `:65`.

Spec 003 D1 puts preload closures in the project environment hash; D3 separates them from test closures. The review brief specifically asks whether a real preload can land in a test file's closure. The amended D5 orphan-root heuristic is implemented as written, but does not preserve that separation for this case.

Run either preload form:

```js
// --require ./scripts/create-require.cjs
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/package.json");
req("./scripts/marker" + ".cjs");

// --import ./scripts/create-require.mjs
import { createRequire } from "node:module";
const req = createRequire(process.cwd() + "/package.json");
req("./scripts/marker" + ".cjs");
```

On both Node 22.23.3 and 24.21.0, with two files running concurrently, the helper appeared in each file's observed `paths`; `preloadPaths` held only the preload entry. Both tests passed. The recorder edge's parent is the unloaded `package.json` URL and its specifier is not a preload flag value, so line 60 treats the helper as a test root.

This is nonblocking: the helper remains keyed for files that ran; a missed rerun or stale current result was not demonstrated. It does duplicate a project-wide preload dependency into per-file observed metadata and contradicts the intended environment boundary.

Worker-sized follow-up: preserve the origin of a `createRequire` load made by a preload at recording time, rather than assigning every orphan root by its specifier alone. Keep test-owned `createRequire(package.json)` and spawned CLI loads file-owned. Add the CJS and ESM preload probes alongside the existing test-owned attribution test on both Nodes; their helpers must enter `environment().files`, with no unrelated preload-only paths added to the test closure. Coordinate any change to D5's heuristic and bump the adapter version if key semantics change.

## Nits

### N1. Proven, informational: supplied HEAD was not the candidate

The worker started at `91890f8`, while the brief names `7314670`. `git diff --stat 7314670 91890f8` showed only `docs/board.md` and the added review brief in `tasks/wave-1.md`. Product code and bundles matched. Verification was performed detached at `7314670`; no action is required beyond keeping these two SHAs distinct in the review provenance.

## What fits

- `RunQueue` excludes slow files from recent/backlog selection and starvation accounting. A one-file slow run uses `startTier(..., false)`, so a revision does not cancel it. Fast refinements and pending fast files take precedence before selection and after a guard wait.
- The clean full-suite run passed all ten scheduler slow-tier tests, the real Vitest integration test, slow inheritance tests, CLI/daemon slow-request tests and the slow spawned-CLI integration test. They cover fast-before-slow, in-turn holding, an explicit request, between-file preemption, guard preemption, bounded load waiting, two schedulers' mutual exclusion, stability discard and artifact inheritance. They do not cover B1's turn transition during the guard or B2's actual Stop wait.
- Both baseline settling and last-moment selection use `Ledger.lookup`. It rejects another worktree's slow results without a declared artifact, but permits own-worktree reuse. Artifact candidates come from existing declared inputs, with test files and slow-glob directories excluded. The fast lookup path uses the same policy check.
- Slow runs share the existing on-disk/revision stability check and install-overlap exclusion. The changed-input slow test confirms the old key receives no result and the file runs at its new key.
- The slot is released after recording and in error/finally paths. Close aborts a guard wait; preemption carries the elapsed guard budget. Expired consumers are ignored using the existing 12-hour `CONSUMER_EXPIRY_MS`; the spec's proposed 10-minute rule remains an open question, not an implemented promise. Dead consumers can block only until that expiry unless lifecycle sweeping removes them sooner.
- Ten valid preload cases were probed on both Nodes with two concurrent slow-project files: separated/equal `--require`, separated `-r`, separated/equal `--import`, a package preload, quoted NODE_OPTIONS flag/path, NODE_OPTIONS import, and project NODE_OPTIONS overriding inherited options. Computed preload helper loads stayed preload-owned. Each file's distinct test-owned `createRequire` helper and spawned CLI helper stayed file-owned, with no cross-file contamination. Node rejects `-r=...`; that negative case is not an attribution defect. S1 is the remaining measured exception.
- 003-38's mark was observed as `probe-mark` in both the node:test file and its spawned Node process. The daemon passes the same mark into the adapter; project environment merging remains as designed.
- `run --slow` reaches the front desk and scheduler. Existing tests cover a scheduler without the method and an older daemon's `unknown request type`, both with a clear unsupported message and CLI exit 1. `--wait` uses the existing status-wait behavior.
- Primer construction reads the policy on each registration/compact path in both harnesses. Malformed JSON yielded `coversNodeTest: false` without throwing; a valid node:test entry yielded true. Skills name both covered runners, and seeded/template names are made unique.

## Inputs for the next wave

1. Dispatch B1 and B2 as a fix wave before accepting this slice. They can have disjoint ownership: scheduler/slow-tier tests for B1, shared Stop/hooks tests for B2. S1 is a separate node:test recorder/attribution row; do not ask a scheduler worker to patch it.
2. Keep `Scheduler.requestSlowSuite(): Promise<{ revision, queued }>` and the run-slow request/status protocol. The request overrides consumer state, not pending fast work. A drained request must not authorize a later unrelated pass.
3. 004-18 is explicitly still planned. The current shared runner lets an in-flight slow file delay fast work by one file, as the wave-1 brief permits. Goal 1's full concurrent lane, `nice`/`ionice` and `slow.maxWorkers` are not proven by this wave. Separate runner state and stability tracking before allowing two runs at once; `Ledger.tierChanges` and the key index's run lifetime currently serve one tier. Isolate escaped-child sweeping by lane so fast completion cannot stop a slow run's children.
4. Preserve one-file slot ownership, release between files and on abort/error, carry the remaining `maxDeferMs` across the pass, and keep retries at most 15 s. Add deterministic coverage for close during guard waiting, expiry, and the slot-held-over-one-minute note; the current tests do not settle all of those transitions.
5. 004-15 owns honest slow status/provenance, slow-aware primer text and `stop.requireSlowSuite`. B2 fixes ordinary Stop waiting now; keep slow pending files in the idle waiter's snapshot. Slow failures must retain the revision and declared artifact rather than imply current source coverage.
6. Give real slow-daemon fixtures a high `slow.maxLoadPerCpu` so the host guard does not consume their test deadlines. Do not infer a clean full-suite gate from the serial rerun. Route the persistent first-observation assertion to the 001 owner with the exact output above; this review does not assign its cause to 004.
