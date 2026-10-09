# 004 wave 2.6 review

## Verification

Candidate checked: `29e2f4ede28147b5a981f682b84dc0385937a2a5`, version 0.1.55. The brief pins `35e2769^..265f783`: 003-41, 003-42, 004-25 and their bundles. HEAD is the subsequent documentation-only landing record; its executable files and bundles equal `265f783`. No 001 change preceding `35e2769` is reviewed. The tracked tree was clean throughout executable verification, including after the rebuild.

004-25 is the human-approved third and last review of wave-2.5 B1 and B2. Re-review is bounded by that report. 003-41 and 003-42 receive their first review. The 003-42 brief lives in 004 `tasks/wave-2.6.md`, beside 004-26; 003 `tasks/wave-4.md` contains 003-41.

Required checks, Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.55 lint
> biome check .
Checked 632 files in 1078ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.55 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.55 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.55 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  6 failed | 259 passed | 1 skipped (266)
     Tests  7 failed | 2030 passed | 10 skipped (2047)
  Duration  269.62s
exit 1
```

`npm ci` warned about unapproved installation scripts for the optional watcher and esbuild; installation and build succeeded. The repository's explicit reviewer gate requires this full run. It ran once, alongside background validation. Host 1-minute load rose from about 55 to over 120. The build instruction follows AGENTS.md and `/reviewer`; the wave's common no-build rule is for implementation workers.

Every failing file was rerun with one worker and no file parallelism, at the same clean HEAD:

```text
$ npx vitest run test/cli/codex.test.ts \
  test/harness/session-start.test.ts \
  test/harness/stop-require-slow-snapshot.test.ts \
  test/watcher/links.test.ts test/e2e/worktrees.test.ts \
  test/runners/node-test/fixtures.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  6 passed (6)
     Tests  51 passed (51)
  Duration  92.83s
exit 0
```

| Full-run failure | Evidence and disposition |
| --- | --- |
| `test/cli/codex.test.ts:102` | 5 s timeout, isolated file passes. Init is unchanged in this range. |
| `test/harness/session-start.test.ts:52` | 5 s timeout, isolated file passes. SessionStart source is unchanged. |
| `test/harness/stop-require-slow-snapshot.test.ts:115`, Claude Code | 5 s timeout, isolated file and Node 22 gate pass. The unchanged snapshot regression remains covered. |
| `test/watcher/links.test.ts:94` | 279.1 ms with a link versus a 196.9 ms bound, isolated file passes. Watcher is unchanged. |
| `test/runners/node-test/fixtures.test.ts:265` | The generated project's Node run exited 1; the test took 44.3 s. Isolated file passes. This is not proof of a cause; the adapter and fixture are unchanged. |
| `test/e2e/worktrees.test.ts:62` and `:100`, Claude Code | Expected silence, received a “daemon is validating again” notice. Isolated file passes. The liveness implementation is outside this range. |

None is assigned to this slice. The full gate was not green; isolated recovery does not replace that fact. All new regression files passed in the full run.

Focused Node `v22.23.3` gate:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
  /home/agent/.nvm/versions/node/v22.23.3/bin/node \
  node_modules/vitest/vitest.mjs run \
  test/daemon/observed-timer.test.ts test/scheduler/observed-growth.test.ts \
  test/delivery/slow-represented-run.test.ts \
  test/delivery/slow-run-artifact.test.ts test/delivery/slow-provenance.test.ts \
  test/harness/stop-retry-bound.test.ts \
  test/harness/stop-require-slow-snapshot.test.ts \
  test/harness/stop-require-slow.test.ts test/harness/stop-slow.test.ts \
  test/scheduler/slow-trigger.test.ts test/scheduler/slow-lane.test.ts \
  test/scheduler/slow-activity.test.ts test/scheduler/slow-artifact.test.ts \
  test/status/slow-tier.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  14 passed (14)
     Tests  83 passed (83)
  Duration  82.17s
exit 0
```

A separate background Squeal baseline is not the reviewer gate. Its `status --wait 60000` returned on quiet at revision 1 with 10 known failures and a completed full-suite checkpoint at revision 1. Besides failures also seen above, it reported handover/step-down assertions, a registered-delivery timeout, and hook-bundle timing/timeouts. Those files passed in the explicit full run. No recovery in that background store is claimed; manual Vitest reruns do not update it.

Independent probes used one owned `/tmp/squeal-004-26-review` directory, fixture stores and temporary repositories. No probe opened the project's store. The benchmark used a copy of the pre-range state sink as its control. Initial probe construction errors were corrected before the reported successful runs: the scheduler's `head` callback must return `HeadState`, not a SHA string. Scratch was removed before committing. No product code was changed.

## Verdict

**PASS at `29e2f4e`: 0 blockers, 0 should-fix findings, 1 informational nit.**

| Reviewed item | Result |
| --- | --- |
| Wave-2.5 B1, an inherited failure selects a later run's declaration at the same commit | Closed. The applied failure's key selects its artifact, including while pending. |
| Wave-2.5 B2, Stop's last retry drops the revision guard | Closed. All three writes retain the guard; exhaustion blocks. |
| 003-41, wave-2.5 B3, startup drops an observed refinement | Closed. The timer acknowledges only scheduler acceptance. |
| 003-42, timer restart swallows a just-written observed change | Closed. The daemon carries the last acknowledged snapshot across restarts. |

This verdict is about the reviewed scope, not a claim that the full repository gate passed or that spec 004's remaining e2e and dogfooding are complete.

## Blockers

None.

## Should-fix

None.

## Nits

### N1. Proven, informational: supplied HEAD follows the pinned candidate with documentation only

The 004-26 brief in `tasks/wave-2.6.md` names a range ending at `265f783`; supplied HEAD is `29e2f4e`. `git diff 265f783..29e2f4e --stat` lists only `docs/board.md`, 004 `status.md` and `tasks/wave-2.6.md`. Checks ran at the actual HEAD, not detached at the earlier hash. Executable content is identical. No repair is needed.

## What fits

### Exact artifact association closes B1

At `src/core/state/sink.ts:102` and `:134`, the key of each applied or inherited failing result is written in the same transaction as its known state. Passing or skipped results remove their check's association. A refresh with no result under a pending key retains the earlier failure association. `src/core/delivery/attribution.ts:68` reads the recipient worktree's association and then the origin worktree's artifact record for that key. No commit or diagnostic fingerprint selects the artifact.

The committed public-delivery regression uses two failures from one source worktree at the same commit with the same failure text, `k1` declared `dist-a/**` and later `k2` declared `dist-b/**`. The recipient retaining `k1` reports `dist-a/**`; a recipient inheriting `k2` reports `dist-b/**`. Queuing `k3` keeps the first failure's declaration. Removing the association says “declared artifact unknown”. These tests passed on both Nodes, beside the previous policy-edit, removed-slow-marking and legacy controls.

The row is bounded to 1,024 checks, ordered by their last key change. Artifact records remain bounded to 256 keys. Eviction deliberately loses precision and says unknown for a currently slow file; it does not guess from newer results. Attribution reads each origin worktree's artifact map once per batch.

### Incomplete runs do not remove a retained failure key

Independent probes drive the real scheduler, state sink and SQLite store with a synthetic runner report. Both files initially fail. Only B is edited and run again; its report contains a provisional pass but lists no completed file and ends either `crashed` or `timed-out`. A's retained failure remains failing; B becomes unknown. Neither association is removed. Successful output on **both Node 24 and Node 22**:

```json
{"end":"crashed","retained":2,"states":[{"file":"test/a.test.ts","outcome":"fail"},{"file":"test/b.test.ts","outcome":"unknown"}],"provisionalPassIgnored":true}
{"end":"timed-out","retained":2,"states":[{"file":"test/a.test.ts","outcome":"fail"},{"file":"test/b.test.ts","outcome":"unknown"}],"provisionalPassIgnored":true}
```

Each probe also forces the known-state write to throw after an applied pass would clear a failure key. SQLite rolls back the metadata mutation along with the state write; both associations remain. This checks report filtering and transaction atomicity, not operating-system signal delivery. The unchanged runner owns that boundary.

The source explains the result: `tiers.ts` never applies records from an incomplete file, and `markUnknown` at `sink.ts:106` does not modify failure keys. The map is updated from applied results, not by clearing the worktree's row at the start or end of a run. The existing 1,024-entry eviction rule is distinct from removal due to a crash.

### Stop preserves its guard through the bound

At `src/harness/shared/stop.ts:121`, every blocking attempt passes `atRevision`; the final failure returns a block at `:125`. No attempt silently ends the turn after checking a different revision. The new tests commit two unrelated revisions at the real `endTurn` boundary, then queue the slow file at the third. Both harnesses block with guard options `[{atRevision:1},{atRevision:2},{atRevision:3}]`. The quiet third-attempt control, a slow file discovered by an earlier retry, and `stop_hook_active` pass on both Nodes.

The coherent decision transaction and `endTurn` transaction are unchanged. Slow-only Stop still does not wait; mixed-work waits, the wait cap and the loop guard remain green. The patch adds no wait or unbounded retry. The full suite's old snapshot test timeout recovered in isolation.

### Observed growth is retried after baseline and after a restart

`Scheduler.refreshObserved()` at `src/core/scheduler/scheduler.ts:278` now returns false before its context exists, during an install wait, after reinstall, or after close; true means work was queued or coalesced. The daemon forwards that answer at `daemon.ts:192`. `lifecycle.ts:208` advances the snapshot only on true. The additive `ObservedSeen` type is held by one daemon instance and passed to every `#startTimers` call at `daemon.ts:194`; shutdown still clears the timers.

Independent probes use two real node:test adapters and schedulers over one store, a computed `--require` preload load, and two test files. B's helper differs from A's. B's baseline closure is held while A observes the helper. The timer uses the production **5,000 ms** interval, not the regression tests' shortened interval.

On both Nodes, the startup probe first receives false, then true after release, re-keys both files and fails both without a local edit or a new revision. The restart probe writes the observed growth after the old timer's last snapshot and restarts it with the same `ObservedSeen` before its next tick; both files then run and fail. Another complete interval produces no further runs.

```text
                         Node 24                 Node 22
baseline held            accepted [false,true]   accepted [false,true]
growth before restart    accepted [true]         accepted [true]
files re-run per probe   2                       2
final test outcomes      fail, fail              fail, fail
revision changed         no                      no
further runs next tick   0                       0
```

The committed after-startup, no-growth, idle-exit, stop-clearing and no-project controls also pass on both Nodes. Timer callbacks do not count as activity, all timers stay unref'd, and restart carries the acknowledged snapshot rather than adopting an unread value. Existing project-addition limitations identified in wave-2.5 are unchanged and were not re-prosecuted.

### The 2,000-result write-lock measurement is noisy, not evidence of a row-specific regression

The independent Node 24 benchmark applies 2,000 results through the real sink and store. Its control is `sink.ts` from `35e2769^`, with the same current helper modules and SQLite configuration. The candidate includes the new row; the control omits the entire failure-key calculation and recording. Both start with the same 2,000 known failures and 1,024-entry metadata row. Results and the current file key change before every measured apply. Two warm-up pairs are excluded; 12 pairs alternate which variant runs first. Setup and result construction are outside the measurement.

Instrumentation of `DatabaseSync.exec` starts immediately after `BEGIN IMMEDIATE` acquires the lock and stops immediately after `COMMIT` returns. Nested savepoints do not reset the clock. There is no competing writer to the owned fixture database. The measurement includes synchronous work and descheduling while the transaction holds its lock, and excludes lock acquisition wait.

| 2,000-result apply | With row, min / median / max ms | Without row, min / median / max ms | Median paired difference ms |
| --- | --- | --- | --- |
| All fail under a new key | 84.983 / 385.936 / 910.452 | 192.680 / 436.751 / 812.035 | -54.429 |
| All pass, clearing failures | 103.286 / 221.360 / 375.091 | 144.983 / 299.625 / 444.660 | -44.588 |

```json
{"loadStart":[90,91.01,77.54],"loadEnd":[75.46,87.2,76.9],"node":"v24.21.0"}
```

The negative differences do not prove a speedup. Host scheduling noise dominates the pair differences, so the incremental lock cost is **unverified**. Both versions can hold the write lock for hundreds of milliseconds in this stress shape. This is a measured limit, not a proven break introduced by the row. No calm-load or competing-writer latency claim is made. The candidate performs one bounded JSON metadata update per changed batch inside the existing transaction; unchanged mappings avoid that write.

### Bundles and interfaces agree

The clean rebuild reproduced both committed plugins. Their CLI callbacks return the scheduler's boolean and pass the retained snapshot; their Stop paths preserve every revision guard and block at the retry bound; their state sinks and attribution contain the failure-key association. No source-only fix is claimed.

Public type change: `Scheduler.refreshObserved(): void` becomes `boolean`, with false meaning the caller must retry. `ObservedSeen` and optional `TimerContext.observedSeen` are additive lifecycle types. No store schema, `Store`, persisted known-state type, or report schema changed. Metadata contains only check identities and result keys. Pruning these per-worktree rows remains the already-filed 001 follow-up on the board.

## Inputs for the next wave

1. Wave-2.5 B1 and B2 are closed. This third round adds no blocker requiring another review round. Original wave-2 B1 and the original torn-read and policy-edit cases remain settled.
2. 003-41 and 003-42 have no proven blocker. This review supports the human's requested spec 003 shipment decision within this scope. Record the decision in spec 003's status through the coordinator; this review does not change its stage.
3. Keep timer acknowledgment tied to scheduler acceptance, carry `ObservedSeen` across every timer restart, and keep refinement free of activity and revision writes. Rejected requests must remain retryable. Preserve the five-second interval, coalescing, no-growth silence and stop clearing.
4. Keep failure-key recording in the same transaction as applied state. Refreshing pending states or marking a run unknown must not clear retained associations. Consumers must use exact keys or say unknown, never recover identity from a commit or fingerprint. The 001 owner's planned metadata prune must use known per-worktree prefixes, not a suffix match that deletes shared observed rows.
5. The full Node 24 run failed, but all six failing files recovered in isolated reruns and the focused Node 22 gate passed. Do not describe this reviewer run as a green full suite. No Node 22 full suite or macOS run was made here. The landing status records the coordinator's prior green full gates on both Nodes; those are separate evidence.
6. Carry the lock measurements into the planned quality pass. A calm-load paired measurement is needed before assigning a reliable incremental cost or changing the bounded metadata representation. Spec 004's two-shape e2e, skill references and dogfooding remain their existing rows, outside this review.
