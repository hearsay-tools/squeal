# 011-71: why a Vitest tier stayed `running` with no child process

Researcher R3 of 011 wave 8, 2026-10-21, worktree `cez/ccf7e51d` at 48f9e77b2. Code read at tag `squeal--v0.1.238` (commit 9e82037b1). `src/core/scheduler`, `src/runners/vitest` and `src/core/daemon` are the same at 48f9e77b2 (`git diff --stat` empty). Read: board row 011-71, spec 011 C4, C9 and C15, `research/running-tier-yields.md` section 1. Evidence: the live daemon pid 709144 and the shared store, read only (`results/store.json`, `results/proc.txt`); W4's `status.json` at `.ai/cezar/t/04a258b0/stuck-tier-w4/`. Times are UTC. Probes ran on a scratch clone at the tag with a scratch `HOME` and `XDG_*`, at a one-minute load of 20 to 21. The last run (9 related test files) started at load 26.6, above the brief's limit of 24; after it I started no more runs. Probes: `probes/stuck-tier/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What the daemon waits on | Nothing. No run is open, no child process exists, and every thread is idle. The file's `test_file_keys` row has said `pending = 'running'` since revision 6 (14:10:36), at a key no run holds. The `run --all` checkpoint counts the file as left (281 of 282). The daemon is held only by the drain bound for owed work: it exits at about 16:45 | verified from the live store and `/proc` |
| 2 | Which path lost the end | `recordTier` (`tiers.ts`), the `superseded` branch. A cancelled tier at key K skipped `setRunning(file, null)` because `supersededIn` held by its second clause: the file had moved to key B, and a store hit had applied B's result. Nothing took over the claim, so `runningKey` stayed K. An edit back to K then made `settle` read the file as running. Not the yields (they cancelled correctly), not the sweep, not the gate. The timeout did not fire because it is armed only inside `runner.run`, and no run exists | verified from the live store; read in source code; verified by experiment |
| 3 | A reproduction | `probes/stuck-tier/stuck-running.test.ts`. It is a scheduler test over the real Vitest adapter (`test/scheduler/helpers.ts`), about 1.5 s. It edits C, holds the tier, edits B (stored), releases, then edits C again. Result on 0.1.238: `pending: "running"`, the file never runs again, `owedWork` is "a `run --all` checkpoint (1 test file left)", `busy` is `false`. This is the live daemon's state | verified by experiment |
| 4 | The fix's seam and done-when | In both callers of `supersededIn`: end the tier's own claim (`file.runningKey === key`) before skipping the outcome. These are `recordTier` in `tiers.ts` and `#requeue` in `scheduler.ts` (`probes/stuck-tier/fix.patch`, 2 hunks). With the patch, the probe's file runs again at C and the checkpoint completes. The 9 related scheduler test files still pass (27 tests). Done-when below | verified by experiment |

## 1. What the daemon waits on

*Verified from the live store and `/proc`*, 16:08Z:
- `/proc/709144`: state `S`, 0 children, `MainThread` in `ep_poll`, every other thread in `ep_poll` or `futex_wait_queue`. Open: the store, its WAL and SHM, the worktree's lock database, inotify, 5 pipes, 1 socket. It is not waiting on any process or file read.
- `runs`: 49 rows for worktree `b3025782c392379a`, every one ended. The last run ended at 15:15:15. `status --json` gives `runsOpen: 0`, and the file's standing is `{kind: "running", lane: "vitest", since: null}`: `since` is `null` because `runOf` found no run (`src/core/status/standing.ts:176`).
- `test_file_keys` for `test/daemon/composite-runner.test.ts`: key `70e64e1d…`, revision 6, `pending = 'running'`. It is the only `running` row of 784. Its 24 `known_states` say `pending_phase = 'running'`, outcome pass, inherited at revision 5 from worktree `15c0d83e` at commit d7344427.
- No result anywhere in the store has key `70e64e1d…`. The only run that ever held the file is `9bfab4d5` (revision 4, 14:10:14 to 14:10:25, `completed`, failure "run cancelled: an edit arrived during a backlog tier"). Its log shows every test of the file passing, but `completedFiles` names only `desk-error-log.test.ts`.
- Checkpoint `ebbd3808` (`run-all`, revision 17, 14:56:23) is open: `done 281, total 282`. The 15:44:54 note says the daemon runs that work before it exits, for at most 60 min (`lifecycle.ts`, the drain). The file is never queued, so the daemon exits at the bound and leaves the checkpoint owed. A new daemon's start calls `releaseRunning` (`daemon.ts:365`), which turns the row into `queued`. So a restart heals the file. *Read in source code; not run, by the brief's isolation.*

## 2. Which path lost the end

**The edits** (*verified from the live store*, `revisions` 3 to 6): `src/runners/observe/recorder.cjs` is in the file's closure (`test_files.closure_paths`). Its content changes A → B → A, where B is the committed blob:

| Revision | Time | `recorder.cjs` | The file's key |
|---|---|---|---|
| 3 | 14:08:20 | `79c66e` (edited) | K |
| 4 | 14:08:41 | unchanged (a new test file elsewhere) | K; tier 9bfab4d5 starts at 14:10:14 with the file at K |
| 5 | 14:10:22 | `69b545`, the committed blob (equals d7344427 and HEAD) | B, `7e55680d…`: a hit on 15c0d83e's result at d7344427, inherited (`observed_at 5`) |
| — | 14:10:25 | — | 9bfab4d5 ends, cancelled |
| 6 | 14:10:36 | `79c66e` again | `70e64e1d…`, written at revision 6, `running` |

K at revision 4 and the key at revision 6 hash the same closure bytes. Only `recorder.cjs` changed between them, and it went back to the same blob. So revision 6's key is the cancelled tier's key. *Inferred* from the key's definition (C3). The source supports this by elimination: only two code paths write `running`. `startTier` writes a run row in the same transaction, and no run row holds the file. `settle` writes it when `key === file.runningKey` (`ledger.ts:246`).

**The code path** (*read in source code*, 0.1.238):
1. `startTier` sets `file.runningKey = K` (`tiers.ts:385`).
2. Revision 5: `settle` re-keys the file to B. `lookup(B)` hits, and `applyResults` sets `resultKey = B` (`ledger.ts:347-369`). It does not touch `runningKey`. The yields cancel the tier, which is correct.
3. `recordTier` calls `storeDecision`. `supersededIn(file, K)` reads `runningKey !== null && runningKey !== K`, which is false. It then reads `file.key !== K && resultKey === file.key`, which is **true**, so the result is `superseded`. The branch at `tiers.ts:579` does `continue` before `ledger.setRunning(file, null)`. Review wave-4 B1 wrote that clause for "an edit's tier beside a backlog tier … already stored its result". In that case the newer tier's own `setRunning` had already replaced or cleared the claim. A store hit takes no claim, so here the old claim stays.
4. Revision 6: the key is K again. `settle` sees `key === file.runningKey`, takes the file out of the queue and sets the phase to `running` (`ledger.ts:244-252`). Every later `settle` does the same, the checkpoint of revision 17 included.

`#requeue` in `scheduler.ts:955` has the same `if (supersededIn(file, key)) continue;` before `setRunning(file, null)`. It runs when recording a tier throws.

**What is not the cause:**
- The yields: they cancelled as C4 step 5 says, and the run ended at 14:10:25 with a completed row. *Verified from the live store.*
- The sweep: the notes stopped 1 + 2 + 37 + 2 + 6 + 2 + 4 + 4 = 58 processes. One process belonged to run 9bfab4d5, a `tsgo` stopped at 14:10:25. The sweep (`escaped.ts`) sends signals and writes notes; it writes no ledger state. The probe reproduces the defect with no sweep. *Read in source code; verified by experiment.*
- The gate (`gate.ts`): it orders adapter calls, and the run returned. The probe goes through the real adapter's gate. *Verified by experiment.*
- The timeout: `runner.timeoutMs` is passed to `context.runner.run` (`tiers.ts:450`) and armed in `settleOrStop` (`run.ts:98-104`). It ends a run that does not end. There is no run here, so no timer exists. The tier timeout that row 011-71's draft done-when names would not help: no tier exists to time out. *Read in source code.*

**A side effect** (*read in source code*, `claims.ts`, `test-files.ts`): while the daemon lives, the row is a claim on `70e64e1d…`. Another worktree at that key waits for it, at most `runner.timeoutMs` plus `CLAIM_GRACE_MS` (`claimBoundMs`).

## 3. The reproduction

`probes/stuck-tier/stuck-running.test.ts`, run in a scratch clone at the tag (*verified by experiment*, twice):

```
{"pending":"running","rowKeyIsC":true,"ranAfter":false,"checkpointCompletedAt":null,"busy":false,
 "owed":"a `run --all` checkpoint (1 test file left)","heldTierEnd":"run cancelled: an edit arrived during a backlog tier"}
```

It uses the `basic` fixture and `src/math.ts`. The steps: baseline, then B (stored), then A, then C with its tier held in `gate.before`, then B while the tier is held, release, then C again, then `requestFullSuite`. No timing is involved: the hold is a promise.

## 4. The fix's seam and done-when

**Seam** (`probes/stuck-tier/fix.patch`): where a caller of `supersededIn` skips the file, it first ends the tier's own claim, as in `if (file.runningKey === key) ledger.setRunning(file, null);`. This applies in `recordTier` (`tiers.ts:579`) and in `#requeue` (`scheduler.ts:955`). A claim a newer tier holds at another key is left alone, so B1's first clause keeps its meaning. With the patch, the probe prints `pending: null, ranAfter: true, checkpointCompletedAt: <set>, owed: null`. These still pass: `edit-beside-backlog`, `tier-yields`, `tier-yields-ended`, `-fairness`, `-text`, `-vitest`, `backlog-cancel`, `catch-up-cancel` and `timed-out-tier`, 9 files and 27 tests (*verified by experiment*, load 26.6 at start).

**Done-when as tests** (a new `test/scheduler/superseded-claim.test.ts` over the real Vitest adapter):
1. A tier runs a file at key C. A store hit at key B lands during the run, and the tier is cancelled. After it ends, the file's `test_file_keys` row is not `running`. After an edit back to C, the file runs at C and its result is stored. A `run --all` requested afterwards completes. (The probe with its three assertions inverted.)
2. The same, with the tier's record failing once (`failWrites(store).fail(busyError(), "recordTier")`, as in `busy-record.test.ts`), so `#requeue` ends it: the file's row is not `running`, and the file runs at C.
3. The same, with the tier not cancelled: an edit's tier that cannot yield, or a node:test slot, runs to its end after the hit at B. The file's row is not `running`, and the edit back to C runs it.
4. Unchanged: `edit-beside-backlog.test.ts` tests 2 to 4 (B1, both completion orders). The older run's outcome is discarded, and a newer tier's `running` at another key is not ended by the older tier's record.

## Recommendation

Fix row 011-71 at the claim, not with a timeout: in `recordTier` and `#requeue`, a superseded file whose `runningKey` is the tier's own key gets `setRunning(file, null)` before its outcome is skipped (`fix.patch`). Write done-when tests 1 to 4 above, and change the row's done-when "holds a tier … to its timeout" to test 1, because no tier exists to time out.

## Open questions

- `startTier` sets `runningKey` inside `store.transaction` with no `ledger.hold` restore. If `store.runs.start` or `ledger.commit` throws there (a busy store), the in-memory claim may outlive a rolled-back start, which is the same symptom. Not seen here: no busy-store or stall note at revisions 4 to 7. *Inferred from source; not tested.*
- A cheap guard would catch any further path of this kind: at idle, a file whose `runningKey` no tier in flight holds is a bug. It could be a note, or an assertion in tests. That is a design choice for the coordinator.
- The live daemon exits at about 16:45 on its drain bound. After that, the store rows above are the only evidence, and the next daemon's `releaseRunning` rewrites the row.

## Sources

- Live: pid 709144 (`~/.claude/plugins/cache/hearsay/squeal/0.1.238/dist/cli/squeal.mjs`), store `/home/agent/projects/squeal/.git/squeal/store.sqlite` (read only), run directory `.git/squeal/runs/9bfab4d5-b316-4674-848a-67c8b70ad434/` (`vitest.log`, `report.json`), `.ai/cezar/t/04a258b0/stuck-tier-w4/status.json`.
- Code at `squeal--v0.1.238`: `src/core/scheduler/tiers.ts` (`startTier`, `recordTier`), `store-decision.ts` (`supersededIn`, `storeDecision`), `ledger.ts` (`settle`, `applyResults`, `setRunning`, `#syncPhase`), `scheduler.ts` (`#requeue`), `yields.ts`, `claims.ts`, `src/runners/vitest/run.ts`, `gate.ts`, `src/core/daemon/escaped.ts`, `lifecycle.ts`, `daemon.ts`, `src/core/store/repos/test-files.ts`, `src/core/status/standing.ts`.
- Probes: `probes/stuck-tier/` (`evidence.cjs`, `results/`, `stuck-running.test.ts`, `fix.patch`).
