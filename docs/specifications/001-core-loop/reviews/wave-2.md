# Wave 2 review

Reviewer task for spec 001, 2026-10-04. Range `8e1cfb9..bf86167` (19 commits): tasks 001-20 scheduler and validity (`src/core/scheduler`, `src/core/daemon-loop`, S8 lockfile watching in `src/core/keys`), 001-21 known state, transitions and delivery views (`src/core/state`, `src/core/delivery`), 001-22 status and why (`src/core/status`, `src/cli`, `ResultRepo.listForCheck`), and the `StateSink`, `StateProvenance`, `StatusBuilder`, `Scheduler` and `DeltaEntry.baseline` additions in `src/core/types`. Cherry-pick order: state, scheduler, status, with one hand-resolved conflict in `src/core/types/status.ts`. The resolved file is coherent.

## Verdict

The core loop works. With the real store, the real `StateSink`, the scheduler over the real Vitest adapter and the real `HarnessDelivery`, an edit that breaks a test delivers exactly one `PASS -> FAIL`, the fix delivers exactly one `FAIL -> PASS`, break-and-recover between deliveries is silent, and a second worktree bootstraps with 5 lookups, 0 runs and every result inherited. The scheduler honours the wave 1 inputs contract on the write path: results and `test_file_keys` before the sink, one transaction, `current` only on a key match, nothing stored for a crash, file-level expansion from the previous key, retirement on disappearance. Every board "done when" row is met. Lint, typecheck and tests are green. No `any`, no file over 300 lines.

Two defects let status and delivery headers say "current" for checks whose key at the current revision is different, and one of them also reports a full-suite run that never happened. Both were reproduced end to end. The Stop hook (001-31) and `stop.requireFullSuite` read exactly these values, so fix both before wave 3 builds on them.

Counts: 2 blockers, 10 should-fix, 9 nits.

## Verification

```
$ npm ci
found 0 vulnerabilities
npm warn install-scripts @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js) not covered by allowScripts

$ npm run lint
Checked 181 files in 66ms. No fixes applied.

$ npm run typecheck
tsc --noEmit   (no output, exit 0)

$ npx vitest run
 Test Files  51 passed (51)
      Tests  421 passed | 7 skipped (428)
   Duration  10.78s
```

The 7 skipped tests: the 5 @parcel/watcher backend tests, which run only on darwin, and 2 timing tests that skip themselves above load average 8 (the machine was at 15.2; they measured 422 ms and 181 ms, under budget). Expected.

One throwaway probe (`test/zz-probe-wave2.test.ts`, deleted afterwards, tree clean): a scratch copy of `test/fixtures/scheduler/basic`, a real store, `createStateSink`, `createScheduler` with `describeFailure`, `createDelivery` with a `StatusBuilder` wrapping `buildSnapshot`, one registered consumer, edits handed to `handleBatch` as watch batches.

```
PROBE register header: {"revision":0,"counts":{"current":6,...},"fullSuite":{"atCurrentRevision":true,"lastCompletedRevision":0}}
PROBE break delta: [[test/math.test.ts > adds, "pass-to-fail", "current", "expected -1 to be 3 // Object.is equality"]]
PROBE fix delta: [[test/math.test.ts > adds, "fail-to-pass"]]
PROBE break-recover delta: null

PROBE running: 1                                    (a 3 s test is in flight)
PROBE mid-tier revision: [1,2]                      (src/math.ts edited, revision 2 appended)
PROBE mid-tier adds state: [["pass","current",0]]   (key changed at revision 2, still "current")
PROBE after batch adds state: [["pass","pending",0]]

PROBE new broken file delta: [[test/new.test.ts (file-level), "first-seen-fail"]]
PROBE new file fixed delta: (none)
PROBE known file-level checks: []

(vitest.config.ts replaced with a syntax error, batch handled)
PROBE scheduler notes after config break: ["runner invalidate failed: ...", "runner environment failed: ...", "runner affected failed: ..."]
PROBE delta after config break: null
PROBE status after config break:
Revision: 7
Known failures: 0
Affected checks: 7 passed, 0 running, 0 queued

(restart with a runner whose environment() and testFiles() reject)
PROBE status after restart with failing testFiles:
Revision: 8
Known failures: 0
Affected checks: 0 passed, 0 running, 0 queued
Last full suite: completed at revision 8
Current revision has completed a full-suite run

PROBE second worktree scheduler status: {"lookups":{"hits":5,"misses":0},"runs":{"started":0,...},"testFiles":{"current":5,...}}
PROBE second worktree status:
Revision: 0
Affected checks: 6 passed, 0 running, 0 queued
Current revision has not completed a full-suite run
Inherited: 6 current results
```

The first block confirms goals 1 and 2 and the 001-21 board row through the real seams. The rest backs B1, B2, S1 and S3 below.

## Blockers

### B1. A runner call that fails is treated as "nothing changed", so checks stay current and an empty checkpoint counts as a full suite

- **Where:** `src/core/scheduler/revision.ts:47-73` (`invalidate`, `environment` and `testFiles` failures become `null` and the step is skipped), `src/core/scheduler/bootstrap.ts:41-43` and `:63-68` (no test file list means every previously keyed file is "gone"), `src/core/scheduler/ledger.ts:117-125` and `:217` (a `null` key is never queued and its `test_file_keys` row is removed), `src/core/state/sink.ts:121-122` (refresh leaves unkeyed files alone, so their known states keep `current`), `src/core/scheduler/tiers.ts:212` (`run --all` requests only keyed files), `src/core/scheduler/bootstrap.ts:91-96` (baseline over the misses only).
- **What is wrong:** the wave 1 input said a broken config must map "to `unknown` for the project with one status note, never to stored results". The scheduler avoids stored results but maps the failure to silence. Keys are computed from the last environment that worked, so nothing moves.
- **Failure scenario 1, config broken while the daemon runs (probe):** the agent writes a syntax error into `vitest.config.ts`. `invalidate`, `environment` and `affected` reject. Keys stay as they were, nothing is queued, no delta is delivered, and status reports "Known failures: 0, 7 passed" as current at revision 7. No test can run at revision 7.
- **Failure scenario 2, runner failure at daemon start (probe):** `environment()` rejects, so every key is `null`. `testFiles()` rejects, so `refs` is empty and every file in `test_file_keys` is "gone": all known checks are retired and their view entries removed, silently. The baseline checkpoint has no misses, completes at once, and status says "Current revision has completed a full-suite run" with 0 checks. With only `environment()` failing, the previous known states stay `current` (their rows are removed, `refresh` skips them) and the empty baseline still completes. Today `createVitestAdapter` itself rejects on a broken config, so 001-30 decides whether a daemon can start in that state at all; a transient rejection of either call reproduces the scenario.
- **Suggested fix (one task, 001-20 owner):** a runner failure is a state, not a skip. When `environment()` or `invalidate` fails for a project, mark every test file of that project `unknown` at this revision (`markUnknown` with the runner's message, which also delivers one factual line), keep the `test_file_keys` rows with a "no key" marker or keep them and let the sink classify them `unknown`, and persist the note for status (see S6). When `testFiles()` fails, keep the previous file list; never retire on a failed listing. An unkeyed file is never "nothing to run": `run --all` and the baseline include it, and a checkpoint with an unkeyed or unknown file ends `abandoned`, never `completed`. Tests: the probe's two scenarios, asserting `unknown` counts and no full-suite claim.

### B2. The revision is visible before keys and known states catch up, for as long as a tier is in flight

- **Where:** `src/core/scheduler/scheduler.ts:133-141`. `context.keys.reconcile` appends the revision in its own transaction (`src/core/revision/reconcile.ts`), then `applyRevision` awaits `runner.invalidate`, `environment`, `affected` and `closure`, and only `ledger.commit()` writes the new keys, pending phases and `refresh`. The Vitest adapter serializes every call behind the running tier (`src/runners/vitest/adapter.ts:78`), so `invalidate` waits for the whole tier.
- **What is wrong:** spec D5: "A stored result is **current** for a check in a worktree at a revision when its key equals the key computed for that check at that revision." For the duration of the tier, the store says revision N+1 and the known states still carry revision N's classification. Hooks and `squeal status` read exactly that.
- **Failure scenario (probe):** a 3 s test file is running. The agent edits `src/math.ts`. Within 300 ms the store holds revision 2 and `test/math.test.ts > adds` is `pass, current`. Only after the tier ends does it become `pending`. If the agent ends its turn in that window, the Stop hook sees revision 2, 0 pending, 0 known failures, and lets it finish with its last edit unvalidated. `stop.waitMs` does not help: nothing is pending. With no run timeout (S10) and a hung worker, the window never closes.
- **Suggested fix (one task, 001-20 owner):** make the content part atomic with the revision. `reconcile` already exposes its steps for this ("Callers that need more writes in the same transaction run the steps"): diff the batch, then in one `store.transaction` append the revision, flush the stat cache, run `KeyIndex.rekey(paths)` (synchronous, needs no runner), write the new keys with phase `queued` for every file whose key moved, and `sink.refresh` those files. The runner part (`invalidate`, `affected`, re-resolved closures) then refines keys afterwards as today. For structural changes (add, delete, config), mark the possibly affected files `queued` in the same transaction, or every file of the project when the set is not known without the runner. Test: the probe's mid-tier read, asserting `pending` before the tier ends.

## Should-fix

### S1. A file-level failure is retired, never closed, when the file is fixed

- **Where:** `src/core/scheduler/ledger.ts:153-155` retires every check of the previous results that is not in the new ones, including the file-level check; `src/core/state/sink.ts:129-135` removes it from every view; `src/core/delivery/delta.ts:92` drops the view entry silently.
- **Failure scenario (probe):** the agent creates `test/new.test.ts` with a syntax error. It is told `FAIL test/new.test.ts (file-level), first observed: FAIL`. It fixes the file. Nothing is delivered: the file-level check is retired, the new test is a first pass. The vision: "When that same test recovers, Squeal speaks again." An agent waiting for the recovery never gets it. A file with previous checks is less affected (each test delivers `FAIL -> PASS`), but its file-level line still has no closure.
- **Suggested fix:** do not retire a check whose last known state is `fail` silently. Either record the file-level check as `pass` when the file loads (a passing file-level result under the new key, never shown when nothing was told), or let the delta report a told failure that left the view as a resolved entry (`FAIL -> gone`, factual: "no longer reported by the runner"). The second also covers a renamed or deleted failing test. Amend D6 with the choice.

### S2. `StatusBuilder` has no implementation; `HarnessDelivery.status` reaches only a fake

- **Where:** `src/core/types/status.ts:146` declares `build(worktreeId)`. `src/core/status` exports `buildSnapshot(store, root, now)` and `readStatus(cwd)`. Nothing implements the interface. `test/delivery/fakes.ts` is the only builder; `delivery.test.ts:362` tests delegation to it.
- **What is wrong:** the seam named in the task does not close. The builder takes a worktree id; the snapshot needs a root, which only the `worktrees` table maps from the id, and nothing writes that table yet (see inputs).
- **Suggested fix:** `createStatusBuilder(store, { now })` in `src/core/status` that resolves the root with `store.worktrees.get(id)` and returns `StatusUnavailable` when the worktree is not registered. One test through `createDelivery`.

### S3. Header and status compute counts, the full-suite line, known failures and check names twice, and disagree

| Thing | Copies | Difference that matters |
|---|---|---|
| full-suite line | `delivery/header.ts:21-28`, `status/snapshot.ts:69-74` | Snapshot requires a recorded revision. A worktree with no revision whose baseline completed: the delivery header says `atCurrentRevision: true`, status says "has not completed" (probe, second worktree) |
| validity counts | `delivery/header.ts:19-20`, `status/snapshot.ts:93-97` | Same today |
| known failure | `delivery/delivery.ts:33-44`, `status/snapshot.ts:100-113` | `observedAt` falls back to the header revision in one, `0` in the other |
| check name | `delivery/format.ts:37-44`, `status/check-name.ts:9-14` | Delivery prints `test/new.test.ts (file-level)` and caps at 300 characters. `squeal why "test/new.test.ts (file-level)"` finds nothing, so the name an agent was told does not round-trip |
| check map key | `scheduler/files.ts:64`, `state/derive.ts:16` | Identical, two names |
| test file map key | `keys` `testFileId`, `state/derive.ts:21`, `status/snapshot.ts:163` | Three spellings |
| validity of a file or check | `scheduler/files.ts:56`, `state/derive.ts:42` | Scheduler: pending wins over current. Sink: current wins while a forced re-run is pending. `SchedulerStatus` and store counts disagree during `run --all --force` |
| failure describer | `scheduler/records.ts:29`, `state/fingerprint.ts:55` | See S8 |

- **Suggested fix:** `buildSnapshot` uses `readHeader` for revision, counts and full suite, and one `knownFailure` mapper. One `formatCheck` used by delivery, status and `why`, with `parseCheck` accepting what delivery prints. One check key and one test file key helper.

### S4. Test files that never produced a check are invisible in every header

- **Where:** `src/core/delivery/header.ts:9-11` ("a check never observed in this worktree has no row and is not counted"); `status/snapshot.ts:177-180` counts keyed files without checks; unkeyed files have no `test_file_keys` row and appear nowhere.
- **What is wrong:** vision: Squeal can always tell apart "what it has never checked". A new test file queued for its first run, or one that crashed on its first run (`markUnknown` finds no known check to mark), adds nothing to `pending` or `unknown`. The delivery header says "0 unknown". Only the human status shows "Test files without known checks", and only for keyed files.
- **Suggested fix:** add test-file counts by class to `StatusHeader` (or count each check-less file as one `unknown` or `pending` entry), so the header, `--json` and the hook messages carry it. Unkeyed files count as `unknown` (B1).

### S5. Three discarded tiers during normal editing deliver a spurious `PASS -> UNKNOWN`

- **Where:** `src/core/scheduler/ledger.ts:198-206` and `:181-191`.
- **What is wrong:** `discard` counts consecutive discards across keys. The third one calls `markUnknown`, which hands the file to `sink.markUnknown`, which turns every known check of the file `unknown` and records `to-unknown` transitions. The guard targets a test that rewrites its own inputs. It also fires when the agent edits a closure file during three runs in a row, which is ordinary with tests that take a few seconds.
- **Failure scenario:** `test/api.test.ts` takes 4 s. The agent saves `src/api.ts` three times, each during the file's run. The third discard delivers "UNKNOWN 1 check in 1 test file, inputs changed during 3 runs in a row". The file is still queued for its new key and later passes; `unknown -> pass` is not notable, so the agent never hears it resolved.
- **Suggested fix:** count only discards where the key did not move (the inputs changed on disk without a revision, or back to the same key), or apply the cap without calling the sink while `file.key !== key`. Test with three edits during three runs.

### S6. Scheduler notes never reach `squeal status`

- **Where:** `src/core/scheduler/scheduler.ts:288-291` keeps notes in memory; `SchedulerStatus.notes` is daemon-only. `status/snapshot.ts:52-58` reads only `META_STORE_RECOVERED`.
- **What is wrong:** D12: watcher dropped events give "a note in status"; the wave 1 input asked for one status note per broken config. Runner failures, the tier pump stopping, and dropped events are all invisible to agents and to `squeal status`.
- **Suggested fix:** persist the latest notes per worktree in `meta` (bounded, with time and revision) and read them in `buildSnapshot`. 001-30 writes dropped-event notes the same way.

### S7. No test drives the scheduler through the real `StateSink`, and the fake differs from it

- **Where:** every scheduler test uses `test/scheduler/memory-sink.ts`. It never writes `known_states`, so `bootstrap.ts:111-130` (`knownChecks`, `restore`: failing-first order and retirement after a restart) runs only on an empty table. Its validity rule differs from the real one (`memory-sink.ts:147-148` says `pending` for a key match with a pending phase, `derive.ts:47-50` says `current`). No test covers re-planning between tiers (D5 step 5) or failing-first order at integration level.
- **Suggested fix:** replace the fake with `createStateSink` in the scheduler harness (the `calls` log can wrap it), and add three integration tests: the probe's break, fix and break-recover sequence through `createDelivery`; a restart where a known failure is queued first; a revision during a tier that moves a failing file ahead of the queued ones.

### S8. The scheduler still defaults to the stand-in failure describer

- **Where:** `src/core/scheduler/scheduler.ts:52,116` and `records.ts:24-32` ("Stand-in until `describeFailure` lands").
- **What is wrong:** 001-21 landed. A daemon that forgets the option stores results with `fingerprint: null` and an uncapped summary. The sink derives a fingerprint at apply time, so delivery still works, but stored results and inherited results carry no fingerprint, and `squeal why` shows none.
- **Suggested fix:** import `describeFailure` from `src/core/state` as the default and delete `firstLineSummary`.

### S9. A mixed tier labels the agent's own regressions as baseline findings

- **Where:** `src/core/scheduler/tiers.ts:74-77` gives the whole tier the checkpoint id when any file belongs to it; `:195` passes that id for every file; `ledger.ts:241-243` passes the active checkpoint id to `refresh` for every dirty row.
- **Failure scenario:** during a long baseline, the agent edits `src/a.ts`. `test/a.test.ts` is queued with `direct` priority and lands in a tier with two baseline files. Its new failure is recorded as a baseline finding and delivered as "baseline finding, first observed: FAIL". An agent reads that as pre-existing and may ignore it.
- **Suggested fix:** attribute per file: `ledger.checkpoints.idFor(file.ref)` captured at selection, and the same per file for `refresh`.

### S10. No run timeout by default, and the scheduler lock waits on the runner

- **Where:** `src/core/types/policy.ts:69` (`timeoutMs: null`), `src/core/scheduler/scheduler.ts:131-141` (`handleBatch` holds the lock across `applyRevision`, which awaits adapter calls queued behind the tier).
- **What is wrong:** Vitest's `testTimeout` cannot stop a synchronous loop in a worker. One such test holds the adapter queue forever. Every later batch, `run --all` and `close()` wait on the lock; the change feed delivers no further batch; with B2 the store keeps showing a revision whose states are not classified.
- **Suggested fix:** a finite default (for example 10 minutes) in D11 and `DEFAULT_POLICY`, and a test that a hung run times out and the next batch is handled.

## Nits

- **N1.** Inherited provenance in a delta prints the 16-hex worktree id (`delivery/format.ts:85`); status prints the root. Look up the root in `worktrees`.
- **N2.** `tryRunner` notes (`scheduler/context.ts:53`) carry no test file or paths; `closure` failures name no file. Styleguide: errors carry context.
- **N3.** `checkLockfile` (`scheduler/revision.ts:105-115`) re-keys without a new revision. "Current revision has completed a full-suite run" can stay true while files are queued at new keys.
- **N4.** `sameState` (`state/derive.ts:139-141`) compares `JSON.stringify` output, which depends on property order between the decoder and `stateFromResult`. A mismatch costs an upsert per check per refresh, no wrong transition. Compare fields.
- **N5.** Recovery from `unknown` is silent (`state/transitions.ts:28`, `unknown -> pass` is not notable). An agent told "PASS -> UNKNOWN (runner crashed)" gets no closure. Spec-conformant; add to the dogfooding list next to open question 3.
- **N6.** The fingerprint includes line and column, so inserting a line above a failing assertion delivers "FAIL -> FAIL, failure changed". Spec-conformant (D6); measure the rate in dogfooding.
- **N7.** A worktree with no recorded revision has no `HEAD` or dirty flag in status (`status/snapshot.ts:66-67`, probe: second worktree). D7 lists both. Record a revision 0 row at bootstrap with `HEAD`, or have status read `HEAD` from the git dir without spawning git.
- **N8.** `findInstalledLockfile(root, root)` (`scheduler/keying.ts:118`) looks only from the worktree root, while `installedDependenciesFingerprint` is per project. A workspace project with its own `node_modules` lockfile is hashed but not watched.
- **N9.** Results under one key from two worktrees replace each other (`INSERT OR REPLACE` per check and key). A flaky test re-run with `--force` in worktree B changes the stored outcome under worktree A's current key, and A's known state does not follow until A refreshes that file. Record in D8 as accepted, or refresh other worktrees' rows on `putMany`.

## What fits

So that wave 3 does not re-check these:

- Write order and atomicity: `Ledger.commit` (`scheduler/ledger.ts:209-246`) writes `test_file_keys` (key and pending phase), then `applyResults`, `markUnknown`, `retire` and `refresh`, in one `store.transaction`; `recordTier` puts results with `putMany` per file inside the same transaction. The scheduler is the only writer of pending phases; the sink and status only read them.
- Validity: the sink classifies `current` only when the result key equals the `test_file_keys` key (`state/derive.ts:42-52`). `unknown` is never stored under a key: crashes and timeouts go to `markUnknown`, and the adapter reports no completed file for a crashed run.
- File-level expansion uses `results.checksForKey(file.resultKey)` (`scheduler/tiers.ts:190`), never `listByTestFile`. Checks that left a file are retired from `known_states` and every view (`ledger.ts:153-155`, `sink.ts:129-135`); deleted test files and files gone since the last daemon are retired at bootstrap.
- Stability check: a snapshot of the stat cache entries at selection (`scheduler/stability.ts`), `diffCandidates` against it after the run, plus every path a revision reported during the run. Results are discarded and the file re-queued. Board row tested (`test/scheduler/runs.test.ts:13`).
- Bootstrap: keys from the stored closure lists plus local declared inputs, lookup, then a re-key from the worktree's own closure for misses only; a second worktree runs nothing (`checkpoints.test.ts:93`, and the probe). Gitignored closure files and the installed lockfile are tracked, watched as extra files, and watched again after a restart.
- Checkpoints: one row per baseline or `run --all`, tier runs reference it, completion needs every requested file, crash or timeout abandons it, `--force` counts only its own tiers.
- Transitions and deltas share one rule (`state/transitions.ts`); deltas compare the view with the known state, so break-and-recover is silent and a told failure that is skipped and comes back unchanged is silent. Registration seeds the view in the same transaction. Delivery reads and writes the view in one `BEGIN IMMEDIATE` transaction, so two hooks of one consumer cannot deliver the same entry twice; an idle waiter polls read-only and takes the write lock only when there is something to deliver.
- Formatter: header, failures first, unknowns grouped by reason (D12 "one factual line"), 10,000-character cap with a count and a pointer to `squeal status`, no imperative sentences (tested).
- Status and why read the store with `create: false`, never run `integrity_check`, and map missing, newer, corrupt and busy stores to `StatusUnavailable` within a 1 s busy timeout. The human rendering reproduces the vision example; both renderings have snapshot tests. `squeal why` resolves partial names and lists results across worktrees with their run log dirs.
- `src/core/delivery`, `src/core/status` and `src/cli` have no runtime import outside `node:` modules (traced), so hook scripts can bundle them.

## Inputs for wave 3

### 001-30 daemon and CLI

Daemon start, in this order:

1. `root = realpath(argv root)`; `commonDir` from `git rev-parse --path-format=absolute --git-common-dir` (D1); `worktreeId = worktreeIdFor(root)`.
2. `openStore(commonDir, { checkIntegrity: true })`. On `newer-schema`, write the status entry and exit (D8).
3. Exclusive lock on `locks/<worktree-hash>.sqlite` (D10). Losers exit.
4. `store.worktrees.upsert({ id, root, commonDir, isMain, registeredAt, daemon: null })`, then `setDaemon(id, { socketPath, startedAt, heartbeatAt, heartbeatIntervalMs, squealVersion })`. Nothing in wave 2 writes this table. Without it status says "not registered", `StatusBuilder` cannot resolve a root, and `prune` does not count its keys or its last checkpoint as live (`LIVE_KEYS` joins `worktrees`).
5. Load `squeal.config.json` over `DEFAULT_POLICY`. Set a finite `runner.timeoutMs` default (S10).
6. `createVitestAdapter({ root })`. It rejects on a broken config. Do not exit and do not leave the previous known states `current`: until the adapter starts, mark the worktree's checks `unknown` with the error as reason and retry on the next batch that touches the config (B1).
7. `createStateSink(store)`; `createDaemonLoop({ root, worktreeId, store, runner, sink, policy, squealVersion, runsDir: storePaths(commonDir).runsDir, describeFailure, onError, onDropped })`; `await loop.start()`. It runs the baseline before the watcher starts. Pass `describeFailure` explicitly until S8 lands.
8. Bind the socket, heartbeat timer (`worktrees.heartbeat`), `expireConsumers(store)` and `prune` on a timer, idle exit when `consumers.list(worktreeId)` stays empty for `daemon.idleExitMinutes`.

Socket requests: `squeal run --all [--force]` calls `loop.scheduler.requestFullSuite({ force })` and gets the `CheckpointRecord`; the CLI can wait by polling `checkpoints` for its end. Liveness and nudges answer within the hooks' 100 ms socket budget; never await scheduler work in the socket handler.

Shutdown: `loop.close()` (waits for the tier in flight, abandons the open checkpoint), `runner.close()`, `worktrees.setDaemon(id, null)`, `store.close()`.

Also owed by 001-30 or a fix task: persisted notes (S6), the `StatusBuilder` implementation (S2), and `squeal status` reading it.

### 001-31 Claude Code plugin

Every hook: resolve the root (`findWorktreeRoot`), `resolveCommonDir(root)` without git, `openStore(commonDir, { create: false, busyTimeoutMs: 1000 })`, exit 0 silently on any failure or `StatusUnavailable`. Consumer: `{ worktreeId: worktreeIdFor(root), sessionId, agentId: agent_id ?? MAIN_AGENT }`. Budget: hook `timeout: 2`, store busy timeout 1 s (`STATUS_BUSY_TIMEOUT_MS`), socket 100 ms.

- **SessionStart / SubagentStart:** nudge or spawn the daemon, `delivery.register(consumer)`, inject `formatRegistration(registration)`. Arm the idle waiter when interactive.
- **PostToolBatch:** `delivery.onToolBoundary(consumer)`; non-null, inject `formatDelta(delta)`.
- **PreToolUse (`Edit|Write|NotebookEdit`):** needs a way to read regressions without consuming the rest. Missing: `onToolBoundary` marks every entry delivered, including recoveries the denial reason would then have to carry. Add `peek(consumer)` or an `only: REGRESSION_KINDS` option to `HarnessDelivery`, or put the whole `formatDelta` text into `permissionDecisionReason` and accept that.
- **Stop / SubagentStop:** status header plus delta. `stop.waitMs` waits on `pending` counts from `readHeader`; until B2 is fixed a fresh edit can show 0 pending. `stop.blockOnKnownFailures` uses `knownFailures` from status; `stop.requireFullSuite` uses `fullSuite.atCurrentRevision`, which B1 can make true with nothing run.
- **Idle waiter:** `delivery.waitForDelta(consumer, { timeoutMs, signal })` with an explicit long timeout; it polls every 250 ms read-only. Per-consumer lock and the `-p` guard are the plugin's.
- **SessionEnd:** `delivery.unregister(consumer)`.

Bundle the hook entry points: status pulls in 42 modules, which matters for the 80 ms p95 budget.

### Still missing for a working end-to-end loop

1. B1 and B2 fixed, with the probe scenarios as tests.
2. A daemon process that registers the worktree, heartbeats, and runs `createDaemonLoop` (001-30).
3. A `StatusBuilder` over the store (S2).
4. Hook scripts and a regression-only read for PreToolUse (001-31).
5. Closure for a fixed file-level failure (S1), or agents will chase failures that are gone.
