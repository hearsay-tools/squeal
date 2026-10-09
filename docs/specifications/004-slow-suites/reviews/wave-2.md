# 004 wave 2 review

## Verification

Candidate: `6418a6bb54e04cd91845b902c15032dec568f6d5`, version 0.1.51. The supplied branch starts at `5fb497f`, whose only change after the candidate corrects the review brief's range. Executable checks ran detached at `6418a6b` with no tracked changes. The worker branch was restored before writing this report.

Range: `cef8a30..6418a6b`. Reviewed 004-15 (status, provenance, primer, Stop), 004-18 (slow lanes, instances, lane sweeps), 003-40 (preload attribution), and their 0.1.51 bundles. The adjacent 001 work is outside this review. This is the first review of this slice; wave 1.5's closed blockers are controls, not reopened findings.

Node `v24.21.0`, except the explicitly named Node `v22.23.3` checks. Required commands and output:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.51 lint
> biome check .
Checked 620 files in 227ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.51 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.51 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.51 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  13 failed | 242 passed | 1 skipped (256)
     Tests  16 failed | 1964 passed | 10 skipped (1990)
  Duration  339.92s
exit 1
```

`npm ci` also warned that the optional watcher and esbuild installation scripts were not covered by `allowScripts`. The build left both committed plugin bundles unchanged. The full suite was run once. Host load reached 166.43 during it. The failed full-suite gate remains failed even when a file passes alone.

Every failed file was rerun in its own process with the original test timeouts:

```text
$ node node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --no-file-parallelism
```

| File | Full-suite failure | Isolated rerun |
| --- | --- | --- |
| `test/cli/codex.test.ts` | CLI test exceeded 5 s | 13 tests passed |
| `test/daemon/open.test.ts` | concurrent-start test exceeded 5 s | 2 tests passed |
| `test/e2e/lifecycle.test.ts` | bad-config fixture did not become ready within 45 s | 6 tests passed |
| `test/e2e/worktrees.test.ts` | three hook processes failed their expected exit/output assertions | 8 tests passed |
| `test/harness/codex/bundles.test.ts` | hook flow exceeded 5 s | 28 tests passed |
| `test/harness/stop-require-slow.test.ts` | 790.68 ms exceeded the test's 500 ms bound | 8 tests passed |
| `test/harness/stop.test.ts` | locked-store Stop took 1,910.71 ms against 1,875 ms | 8 tests passed |
| `test/runners/node-test/fixtures.test.ts` | generated-file run exited 1 | 10 tests passed |
| `test/runners/node-test/graph-cost.test.ts` | re-resolve 265.82 ms exceeded cold 236.87 ms | 1 test passed |
| `test/scheduler/backlog-tiers.test.ts` | cost ratio; cancelled run completed 192 of 200 files | 4 tests passed |
| `test/scheduler/refinement-lock.test.ts` | revision took 593.75 ms against 500 ms | 2 tests passed |
| `test/scheduler/revision-lag.test.ts` | revision took 645.62 ms against 500 ms | 2 tests passed |
| `test/watcher/links.test.ts` | git-call cost test exceeded 5 s | 6 tests passed |

All 13 isolated reruns passed, 98 tests in total. No full-suite failure is assigned to the wave merely because it appeared in this run. The changed Stop test recovered alone; the three blockers below have independent, deterministic reproductions.

Focused Node 22 gate, at the clean candidate:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
  /home/agent/.nvm/versions/node/v22.23.3/bin/node \
  node_modules/vitest/vitest.mjs run \
  test/daemon/slow-lane.test.ts test/daemon/slow-instance.test.ts \
  test/daemon/escaped-overlap.test.ts test/scheduler/slow-lane.test.ts \
  test/scheduler/slow-trigger.test.ts test/scheduler/slow-activity.test.ts \
  test/status/slow-tier.test.ts test/delivery/slow-provenance.test.ts \
  test/harness/primer-slow.test.ts test/harness/stop-require-slow.test.ts \
  test/harness/stop-slow.test.ts test/runners/node-test/adapter-attribution.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  12 passed (12)
     Tests  62 passed (62)
  Duration  48.79s
exit 0
```

Independent probes used one owned `/tmp` directory, fixture stores and a private scheduler slot. The header/ownership probes passed on both Nodes: 2 files, 11 tests, 41.12 s on Node 24 and 20.63 s on Node 22. The shared Stop race probe passed on both Nodes: 1 file, 1 test, 1.71 s and 3.44 s. These probe assertions demonstrate the candidate's defects; they do not assert the desired repaired behavior. No product code changed. Owned probes and fixtures were removed before the report commit.

A separate Node 24 probe ran the shipped Claude Code CLI bundle as a real daemon over fast and slow node:test projects. It held the slow file on a flag, edited the fast file's dependency, observed a current fast failure before releasing the flag, then observed the slow file current and passing. The slow process carried `<daemon-token>:slow:node-test`. The initial probe using the ordinary tsc output was discarded: that output does not contain the packaged node:test runtime files. Only the subsequent shipped-bundle run counts as evidence.

Node 22's full-suite gate is **unverified**; its focused checks above are not another full proof. Background Squeal results are separate from the clean-candidate commands and are not substituted for them. On the restored worker branch with the report uncommitted, `squeal status` at revision 5 reported 9 known failures, 2,227 passed checks, none running or queued, 10 skipped, and no full-suite checkpoint since revision 2. Those older observations, including handover, step-down, registration and hook tests outside this diff, remain unverified as evidence against this candidate. There is no claim that the background status is green.

## Verdict

**FAIL `6418a6b`: 3 proven blockers, 0 should-fix findings, 1 proven informational nit.**

The slow lane meets the measured concurrency requirement. Two new slow-tier messages can misstate what happened, and the new Stop requirement can accept a torn state.

## Blockers

### B1. Proven: a completed slow file is still reported as running while fast work holds the pump

Locations: `src/core/scheduler/scheduler.ts:428`, `:434`, `:383`; `src/core/scheduler/slow-tier.ts:141`, `:221`; `src/core/state/slow-text.ts:68`.

Spec 004 goal 6 and D8 require the slow line to distinguish current, running and pending state honestly. The activity is published when a slow file is selected. Its completion does not clear or replace that activity. Only the next `SlowTier.next()` does so, and the pump cannot call it until every fast run ends.

Independent reproduction on both Nodes:

1. Mark `test/strings.test.ts` and `test/upper.test.ts` slow; let the first start and hold it before the adapter run.
2. Edit `src/math.ts`; hold its fast tier while it runs beside the slow tier.
3. Release the first slow file and wait for its recorded completion. Its key has `pending: null`; the second slow file remains `queued`; the fast file remains `running`.
4. Read the header with a live daemon. Its line still says the completed first slow file is running.

Measured Node 24 output, with the clock shortened:

```text
Slow tier: 2 test files; 1 current at revision 0, against no declared artifact,
 sources changed since; running test/strings.test.ts since 02:18 (no earlier run).
 Not covered by Stop's wait; `squeal run --slow` runs them now.
```

The persisted activity still has `kind: "running", path: "test/strings.test.ts"`, although that file has completed and the only pending slow file is `test/upper.test.ts`. Node 22 reproduced the same state. The wrong line persists for the whole fast run, rather than just a formatting instant.

Worker-sized fix: retire a run's activity at completion, discard, error and close, in coordination with recording its state. Publish the remaining queue's actual wait reason without starting another slow file. Also validate a running activity against that named file's running state before rendering it. Add a two-slow-file/held-fast-run regression and a discarded-run control; retain the ordinary no-daemon suppression and D2's start gate.

### B2. Proven: an old failure is attributed to artifact declarations edited after its run

Locations: `src/core/delivery/attribution.ts:96`, `:103`; `src/core/delivery/provenance.ts:76`; `src/core/state/slow.ts:112`; `src/core/state/slow-text.ts:63`.

Spec 004 goal 4 and D8 require “against <declared artifact> as of revision N.” The candidate obtains `slowArtifact` from the policy file on disk at delivery. No artifact declaration from the failed run is retained. The renderer then labels today's declaration with the old `observedAt`.

Independent reproduction on both Nodes: retain a failed slow check observed at revision 1 under `inputs: { "test/a.test.ts": ["dist-a/**"] }`; change the declaration to `dist-b/**`; deliver that failure while its rerun is pending. The public attribution and provenance functions produce:

```text
first observed: FAIL, slow tier, Squeal's run saw it at revision 1,
 against dist-b/** as of revision 1, revision 2 pending
```

Revision 1's run was never declared to test `dist-b/**`. Marking the result pending does not repair the false historical artifact claim. Before a daemon observes the policy edit, the header over the retained current state likewise says `current against dist-b/** as of revision 1`, including when there is no validating daemon.

Worker-sized fix: retain the slow/artifact provenance with the executed key or result and use that historical metadata for delivery. If it is absent in old stores, say the artifact is unknown instead of assigning today's declarations to the old revision. Header current claims need the same association with current results; avoid associating artifacts of pending files with current ones. Cover a declaration edit before delivery, a no-daemon policy edit, removal of slow marking, and an inherited result. Preserve the ordinary slow failure and pending/stale wording.

### B3. Proven: `stop.requireSlowSuite` can allow Stop after a slow file was queued

Locations: `src/harness/shared/stop.ts:105`, `:106`, `:119`, `:120`; `src/core/state/slow.ts:80`.

Spec 004 D7 says a main agent's Stop blocks “while a slow file is not current at this revision.” Stop reads `states`, then the live header, then keys in separate store reads. The new gate classifies a file with checks solely from the captured states, ignoring a new key's pending phase when those old states all say current.

The independent probe drove the real shared `stopTurn`, with `requireSlowSuite: true`, `waitMs: 0`, a registered main consumer, no news and one passing current slow file at revision 1. It instrumented only the reader boundary: immediately after Stop's nontransactional `knownStates.list` returned, a second connection committed revision 2, key `k2` queued, and the check pending. This is the daemon's normal atomic state shape. The rest of Stop ran unchanged.

Both Nodes returned:

```json
{"outcome":null,"revision":2,"states":[{"validity":"pending","pendingPhase":"queued"}],"keys":[{"key":"k2","pending":"queued"}]}
```

Stop let the turn end instead of blocking. This is deterministic torn-read evidence, not a proposed timing race. The header/count transaction probe passed; it does not cover this later policy decision.

Worker-sized fix: read the decision's states, keys, header and slow classification from one transaction and one revision. Keep the read snapshot distinct from delivery's earlier transaction; if the end-turn write depends on that decision, preserve its revision relationship too. A regression should force a writer commit at this boundary and require a coherent decision/header, never an old-current/new-queued combination. Retain the no-wait slow-only control, the mixed fast/slow wait, and the `stopHookActive` loop guard in both harnesses.

## Should-fix

None. The limits below are recorded as measured bounds, not additional blockers.

## Nits

### N1. Proven, informational: supplied HEAD is the brief correction, not the candidate

`5fb497f` changes only `tasks/wave-2.md` after `6418a6b`. Product code and bundles match. Verification was detached at the named candidate. No repair is required; keep the candidate SHA distinct from this report's commit.

## What fits

- **Goal 1, both runners.** The committed real-daemon Vitest test passed in the Node 24 full run and Node 22 focused run: a current fast failure arrived while the slow Vitest file remained held, and the slow process ran at nice 10. The independent shipped-daemon node:test probe demonstrated the same ordering and later slow completion. These are actual concurrent runs, not just distinct lane names.
- **Start rule and triggers.** `#inFlight.size === 0` still guards slow selection. A fast run can start beside a slow one, but a new slow run cannot start beside pending/in-flight fast work. The post-guard trigger check remains intact. The committed trigger and held-fast controls passed on both Nodes. Requests override consumer turn state, not fast work.
- **Instance lifecycle and invalidations.** `withSlowInstance` routes runner-part calls to the fast instance, queues invalidations for an existing slow instance, drains them before its next run, and makes a fresh instance after `releaseLane`. The scheduler retains the slow lane until release settles. Lifecycle tests passed on both Nodes. No stranded run or cross-instance close was demonstrated.
- **Stamps and observation.** Both Vitest factories call the same `createVitestAdapter` path, which attaches `SourceStamps` before standalone. The slow adapter has its own stamps and observer; reports enter the existing keyed-input/observed-growth stability path. Lane marks and observer paths are excluded from canonical environment inputs as before. The intentional slow worker-count override is operational; the scheduler takes keys from the fast adapter's environment. No additional stale-result escape was proven at these seams.
- **Sweeps.** Runs receive a per-lane child mark, including the node:test override over its adapter's bare mark. The real overlap test and lane sweeper tests passed on both Nodes. A fast stop leaves a marked slow worker alive. The existing distinction between lane carriers and unmarked/group orphans remains explicit.
- **Headers and liveness.** Aggregate and slow counts derive from the same state/key arrays. The independent two-connection header probe kept the first transaction current and the next transaction pending. Status and delivery use the same slow-line renderer; the no-daemon case suppresses activity. B1 and B2 concern the metadata interpreted inside that otherwise consistent snapshot.
- **Header cost.** After five warmups, 100 `readHeader` calls averaged 0.76 ms with one input rule and 14.29 ms with 1,000 rules on Node 24; Node 22 measured 0.26 ms and 13.35 ms. This includes store reads and policy loading/compilation, not total process startup or lock waits. No 2 s hook-budget violation was established by this policy cost. Passing `isSlow` does not skip `worktreeSlowView`; the read remains on every Stop poll.
- **Stop and primer controls.** All ordinary slow-only, mixed fast/slow and requirement on/off tests passed in focused checks. Slow files remain in the silent Stop's idle snapshot. Both harness primers distinguish slow timing and Codex's next-prompt/tool delivery; no-slow variants remain unchanged. B3 concerns the final requirement decision, not the repaired ordinary wait.
- **003-40 closes the prior S2 and S3 examples.** On both Nodes, an eval Worker's helper, a test-owned child's preload/helper, and a nested `node --test` child's preload/helper stayed in `a`'s closure; unrelated `b` did not acquire them. Editing the helper affected only `a`. A genuine relative project preload's computed helper stayed in the environment and affected both files. Adapter version 9 separates these semantics from old keys.
- **Preload bounds remain explicit.** An absolute project `--require` still puts its computed orphan helper in both file closures, not the environment, as amended spec 003 D5 already permits. A project preload that computes its helper only inside a Worker also leaves that helper in the worker-owning file's closure: the new rule marks no worker phase. The helper remains keyed and affects its owning file. This follows the amended worker-phase rule; no missed rerun was demonstrated. Do not treat either control as proof that every project-preload load enters the environment.
- **Scope.** No macOS priority proof or Node 22 full-suite proof was made. Wave 3's two-harness e2e shapes, artifact-change reruns, cross-worktree inheritance and dogfooding remain planned. This review does not claim those goals shipped.

## Inputs for the next wave

1. Dispatch a fix wave before wave 3: B1 to the slow scheduler/state owner, B2 to the provenance/header owner, B3 to the shared Stop owner. Review the repaired three scenarios on both Nodes. The fixes must not move slow execution back behind fast work.
2. Keep `RunOptions.lane` and `childEnv` flowing from selection through the sweeper to the owning adapter. `releaseLane` is after recording and before freeing that lane. Queued slow invalidations must reach its instance before reuse; a fresh instance reads disk directly.
3. For B1, couple activity retirement to run completion and its store state, then publish a wait reason for remaining files. Validate the named running file; a positive aggregate pending count is insufficient.
4. For B2, settle a small persisted provenance shape for slow marking, artifact declarations and the result/key they belong to. Coordinate any store/type amendment with its owner. Legacy metadata must produce uncertainty, not invented historical declarations.
5. For B3, keep one decision snapshot and revision across the final gate's states and keys. Continue waiting only for fast work; `requireSlowSuite` blocks at once and names `run --slow`. Preserve silent Stop's pending-file snapshot and the loop guard.
6. Carry the failed full-suite output to integration. Isolated recoveries do not turn that gate green. After the fixes, the coordinator owns the combined checks and bundle rebuild/version step; reviewers change no product code.
