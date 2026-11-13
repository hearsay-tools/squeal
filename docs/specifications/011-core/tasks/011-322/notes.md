# Row 011-322 notes: one request intake, behaviour preserved

Worker a49fbac4, 2026-11-13. Brief: `tasks/wave-78.md`, W1. Design: `research/request-intake.md`. Base `0f1348625`.

## The intake

- `src/core/scheduler/request-intake.ts`: `RequestIntake.take`, the one entry point; `#transact` and `#request` moved in unchanged (the busy-retry key counter is the intake's own, `scheduler:request:N`; the scheduler keeps its `#retries` for `#reconcilePaths`' `scheduler:paths:N`; a key only names a waiter in `BusyWaits`, so nothing a user sees changes).
- `src/core/scheduler/request-intake-types.ts`: a request's declaration, one field per rule: `start`, `installWait`, `runnerWork`, `store` (with the covered files), `wake`. A rule is left out only by `{ skip: "<reason>" }`.
- The scheduler wires its host (`#intake` in `scheduler.ts`): `waiting()` is `AWAITING_INSTALL_REASON`, else `REINSTALLED_REASON`, else `null`; `record` is `RequestProgress.ask`; `wakeAll` is `GroupTiers.preempt`; `wakeLane(g)` is `lanes(policy)` then `get(g)?.preempt()`; `cutTiers` is `#cutTiers(null)`; `afterRunnerWork` is `RunnerWork.afterTier`.

### Order inside `take`

1. Start or closed: `{ closed: A }` answers at once when closed or not started (`nothing: true`: asks for nothing). `{ skip, afterPass }` waits for a pass delivered after the request (row 011-198), else throws `NO_PASS`. A plain skip leaves it to `started()`, which throws before the start.
2. Install wait: `{ atOnce }` answers at once with the closed check. `{ stage, passFirst? }` runs an awaited install's pass first (before the lock), then answers in the request's transaction instead of its stage. `{ answer }` answers from the request's plan with no write. A skip writes no store.
3. Runner work: `whenPending` defers the stage, inside its first transaction, while runner work is pending or the ledger is broken; then, under the lock behind the runner work, asks the runner again (`recover`), keys what it said (busy-retried), and stores it in the stage's transaction. `always` takes the lock behind the runner work and makes a plan that may ask the runner.
4. Store write: `stage` in one transaction (`#transact`), busy-retried (`#request`); the lock is taken again per try unless runner work holds it (quirk 1). `outside` (lint) is taken first under a lock of its own. A store skip (`apply`) runs once under the lock, no transaction.
5. Record: the stage's covered files after the commit, inside the same lock task, so no tier record can end one of them first. An install-wait answer records nothing; a stage that throws records nothing.
6. Wake: `allLanes` before the lock (quirk 2); `lane` and `cutTiers` after the record; a skip wakes nothing here.
7. Pump: after every answer that comes from the lock; never after a throw (quirk 4); never after an at-once answer (as today: retry, promote, focus, import return before it).

The install-wait state is read under the lock at the start of the request's locked task (it changes only under the lock: `start`, `#handleBatch`, `#reinstall`), except for `atOnce`, read before the lock as today.

## Requests, today's paths and kept quirks

### `squeal retry` (`requestRetries`, today's 823-846; declaration `retryRequest` in `retries.ts`)

Paths today:
- closed, not started, awaiting an install or reinstalled: resolves at once; no lock, no pump.
- otherwise `#request` around `#lock.run(#transact(...))`: the lock is taken again on each busy try. The stage: `#takeRetries` claims and queues, asking each claimed file (`#requests.ask([file])`) inside the stage; `ledger.commit()` when the queue changed.
- busy refusal: tried again; at the daemon's stop: rejects "taking squeal retry requests: the store was still busy when the daemon stopped"; no pump.
- any other error: the store rolls back, the ledger is restored (`Ledger.hold`); rejects; no pump. The asks made before the error stayed in `RequestProgress` (on restored file objects).
- success: pump. No lane is woken (difference 2).

Kept: the lock per busy try; no wake (`wake: { skip }` citing difference 2 and row 011-323); no pump after a throw or an at-once answer.

Changed, as the design asks: the progress record moved from inside the stage to after the commit (same lock task, nothing runs between). A file asked before `ledger.commit()` today is still queued after it, so the set asked is the same; a stage that throws now records nothing.

`takeRetries`' `claimed` is required (coordinator 9ddca779, 2026-11-13, option A): start and pass give `#takeRetries`' ask; `squeal retry` gives its covered-files collector. Two calls outside my file list got `() => {}` as the third argument, by that agreement: `test/scheduler/retry-claims.test.ts:95` and `:125`.

### Promote and focus (`promote`, `focus`, today's 848-888; declarations `promoteRequest`, `focusRequest` in `request-intake-requests.ts`, since `focused.ts` is card 8's)

Paths today, the same for both:
- closed or not started (focus: also no texts): resolves at once; no lock, no pump.
- otherwise the lock once, no transaction and no busy retry: promote orders `ledger.queue` (`answeredOf`); focus adds a focused entry per file `mayFocus` allows. Then `#cutTiers(null)` under the same lock task.
- success: pump. A throw under the lock rejects with no pump.
- No install-wait check: while an install is awaited they still order the queue; the pump then stops at its own install check.

Kept: no install-wait answer (`installWait: { skip: "writes no store: ..." }`); no store write (`store: { skip, covers, apply }`); no progress record (`covers: { skip }`); `cutTiers` under the lock after the change; no runner work. Focus's "no texts" is the closed answer's `nothing: true`.

### An import's observed refresh (`refreshObserved`, today's 901-910; declaration `observedRequest` in `imports-waiting.ts`)

Two callers: the daemon's import take (`daemon.ts:1095`, with projects and imports) and the lifecycle's refresh (`daemon.ts:416`, neither; it writes nothing). Paths today:
- closed, not started, awaiting an install or reinstalled: `false` at once; nothing else.
- otherwise, synchronously and with no lock: the keys refresh the projects' observed sets (`keys.refreshObserved`, when any); `markImportsWaiting` writes the waiting mark in its own transaction with the store's own busy wait, outside any retry (with no imports it writes nothing); `queueObserved` queues the runner work; pump; `true`.
- `markImportsWaiting` throwing (a busy store past the store's wait): the call throws after the keys' refresh, with no runner work queued and no pump; `squeal import` ignores it (`src/cli/import.ts:224`).

Kept: synchronous (`NowRequest`, the intake's `#now`): the closed and install-wait answers at once, then `now`, then the pump; a throw starts nothing. Named skips: the store write outside the busy-store retry until row 011-323 (difference 1), no covered files, no lane woken, no runner work waited for.

### `squeal run <group>` (`requestGroup`, today's 723-766; declaration `groupRequest` in `request-intake-requests.ts`, not beside `slow-tier.ts`'s `queueGroup`; `requestSlowSuite` stays a call to it)

Paths today:
- the lint branch, one lock task, no transaction and no busy retry: `#started` (throws before the start); a lint group while no install is awaited and no reinstall: `releaseLint` (writes the lint store), then a change-feed pass not awaited, the pump, and the answer. A `releaseLint` throw rejects with no pump. Any other group, or while waiting: on to the stage.
- the stage: `#request` around `#lock.run(#transact(...))`, the lock taken again on each busy try. In the transaction: an unknown group answers `null` (an empty transaction); while waiting, `{ revision, queued: 0 }` (an empty transaction); otherwise the lanes are synced, the group's lane marked requested (`SlowTier.request`, which preempts it), `queueGroup` settles and commits, and the group's files are asked (`#requests.ask`, which keeps those queued or running).
- busy refusal: tried again; at the stop: rejects "taking a squeal run <group> request: the store was still busy when the daemon stopped". Other error: rolled back and restored; rejects; no pump.
- every answer from the stage (`null`, `queued: 0`, the count): pump.

Kept: the lint branch first, in its own lock task, outside the store's transaction (`store.outside`, a named skip); the install-wait answer in the stage's transaction after the unknown-group answer (`installWait.stage` answers `null` for an unknown group); the lane marked requested inside the stage (quirk 3; `wake: { skip }`); the lock per busy try; no pump after a throw. An unknown group's answer now goes through the record step with no file (`ask([])`, which does nothing).

### `squeal run <group> <path>...` (`requestGroupPaths`, today's 768-821; declaration `narrowRequest` in `narrow-run.ts`)

Paths today, all in one task that `RunnerWork.afterTier` runs under the lock behind the runner work queued before it:
- closed: `afterTier` rejects "squeal scheduler: closed"; before the start, `#started` throws. No pump.
- an unknown group: `null`; pump.
- a lint group: throws "group X is a lint group, which runs whole: squeal run X"; no pump.
- `selectNarrow` (asks the runner's `affected` for a source path, bounded as a runner part), also while an install is awaited.
- awaiting an install or reinstalled: `{ revision, queued: 0, narrow }` with the reason in each selected file's `notRun`, no store write; pump.
- otherwise `#request(#transact(...))` with the lock held through every busy try (quirk 1, second half): `queueNarrow` settles and commits, the selected files are asked, the lanes synced, the asks added to the group's lane, the lane preempted, the answer made. Busy at the stop: rejects with the operation named; other error: rolled back and restored; no pump. Success: pump.

Kept: `runnerWork: { always }` holds the lock behind the runner work through every try; the install-wait answer is made from the selection (`installWait: { answer }`), with no write. Its state is read at the start of the locked task, before `selectNarrow`; today it is read after it, in the same lock task, and nothing in `selectNarrow` sets it, so the value is the same. The unknown-group and lint answers stay first (the plan's `{ answer: null }` and its throw).

Moved within the same lock task: the record after the commit; the lane's `preempt` from inside the stage to the wake after the record (`wake: { lane }`; `wakeLane` syncs the lanes and preempts the group's). `narrowAnswer` and the covered set do not read the lane, so the answer is the same.

### `squeal run --all` (`requestFullSuite`, today's 629-707; declaration `fullSuiteRequest` in `checkpoint-requests.ts`)

Paths today:
- no closed check. With the change feed's passes: notes how many started, awaits a pass, and throws `NO_PASS` unless one numbered above the note was delivered (row 011-198); no pump.
- awaiting an install: `#request` around `#handleBatch(interval)`, the pass that may end the wait (review wave 11, B1).
- every lane preempted (`#groups.preempt()`), before the lock (quirk 2), also when it will abandon.
- first stage, the lock taken again on each busy try: in the transaction, awaiting or reinstalled: `abandonFullSuite` (an abandoned checkpoint, written); else the ledger broken, runner work queued or a refinement in flight: `null` (an empty transaction); else `queue`: `queueFullSuite`, ask its own files (review wave 3.6, B1), end the backlog's quiet, start a warm-up.
- `null`: `RunnerWork.afterTier`, the lock held through every try: awaiting or reinstalled read once; if not, `fetchRunnerRetry` (asks the runner when the ledger is broken), its keys by `keyRunnerRetry` busy-retried (`lagging` from the second try), then one busy-retried transaction: abandon, or store the runner retry and `queue`. Closed meanwhile: `afterTier` rejects.
- busy at the stop: rejects with the operation named; other error: rolled back and restored; no pump. Every checkpoint answered (queued, joined, completed at once, abandoned): pump.

Kept, all five design quirks hold: the lock per busy try in the first stage and held through every try after the runner work (quirk 1, `runnerWork: { whenPending }`); every lane woken before the lock (quirk 2, `wake: { allLanes: "<reason>" }`); no pump after a throw (quirk 4); the delivered pass and the install's pass first (quirk 5, `start.afterPass`, `installWait.passFirst`). The deferral check stays inside the first transaction after the install-wait check, so an awaited install still abandons at once while runner work is pending. The abandon decision after the runner work is read once before the runner is asked and used in the transaction, as today (`reason` passed in). The checkpoint's files are recorded after the commit, in the same lock task; `queueFullSuite` committed the ledger before the ask today too.

The key counter of `#request` and `NO_PASS` moved with the request into `request-intake.ts`; the scheduler keeps `#retries` for `#reconcilePaths`.

## The table (`test/scheduler/request-intake.test.ts`)

A probe request through `RequestIntake.take` over a real store and a real `Ledger` (a minimal context, as `retry-claims.test.ts` builds; no runner, so no hand-written `RunnerAdapter` fake, per the coordinator's note of 2026-11-13); `threadLockHolder` (`test/helpers/busy-store.ts`) holds `BEGIN IMMEDIATE` on a second connection. The host's record, wakes and pump write a log; the stage and the record line read `A`'s row through a second store connection, so the log shows the record follows the commit. Rows:

- busy store: the stage runs once after the holder ends, the wait's note names the request; a refusal at the daemon's stop rejects with the operation named and records nothing; with no runner work the lock is let go between tries, with `always` runner work it is held (quirk 1).
- install wait, each reason (`AWAITING_INSTALL_REASON`, `REINSTALLED_REASON`): `atOnce` answers before the lock with nothing else; `stage` answers in the transaction, records and wakes nothing, then pumps; `answer` makes the answer from the plan with the reason and writes nothing; `passFirst` runs the install's pass first, and a wait it ended takes the stage.
- progress record: only the stage's covered files, after the commit (`B`, queued by no request, is not recorded); the real group request records the group's files; the real retry request records only the file it claimed; a stage that throws records nothing and leaves the ledger and store as they were.
- stop: the closed answer once closed; `nothing: true`; before the start with no closed answer it rejects and starts nothing; a `NowRequest` answers at once closed or waiting.
- order: record, then wake, then pump; a delivered pass, the install's pass and every lane's wake before the lock (quirks 5 and 2); no delivered pass rejects with `NO_PASS` and takes nothing; a store skip applies under the lock then cuts the tiers; a release outside the store first, or the stage when it declines.
- typecheck: `@ts-expect-error` for a request with no install-wait answer, a stage that returns no covered files, and a store skip that names no `covers`. Each was checked to fail typecheck with its directive removed.

### Deleted cases and the table rows that replace them

| Deleted | What it asserted | Table rows |
|---|---|---|
| `test/scheduler/busy-requests.test.ts:71` "takes a squeal retry once the holder ends, its request claimed once" | a busy store: the retry's stage runs once after the holder; the wait's note names it; claimed once | busy store "runs the stage once, after the holder ends, and names the wait"; progress record "records the real retry request's claimed files only" |
| `test/scheduler/busy-requests.test.ts:93` "takes a squeal run --all once the holder ends, with one checkpoint" | a busy store: `run --all`'s first stage runs once after the holder | busy store "runs the stage once ..." and the lock-per-try row (the per-try path `run --all`'s first stage takes) |
| `test/scheduler/request-progress.test.ts:98` "run tests counts each of its files once it ended" | the group request asks its files, a running one included | progress record "records only the covered files the stage queued, after the commit" and "records the real group request's files" |
| `test/scheduler/request-progress.test.ts:111` "run --all counts each of its files once it ended, slow files included" | `run --all` asks its checkpoint's files | progress record "records only the covered files ..."; `run --all`'s own covered set stays tested by `:121` (now `:99`), `:134` (now `:112`) and `request-progress-forced.test.ts:43` |

Kept in `busy-requests.test.ts`: the runner fake and the runner-recovery race (was `:111`, now `:52`). Kept in `request-progress.test.ts`: the baseline (`:89`), wave-3.6 B1 (was `:121`), the empty `--fast` request (was `:134`) and the re-queue end, B2 (was `:147`).

### Tests the table repeats, kept (removing them is a later quality row)

- `test/scheduler/install-wait.test.ts:230`, `test/scheduler/reinstall.test.ts:159,200,272`: `run --all`'s install wait, kept as proof it did not move.
- `test/scheduler/full-suite-pass.test.ts:117,138,169,186`: no delivered pass, no checkpoint (the table's `NO_PASS` row).
- `test/scheduler/busy-requests.test.ts` (was `:111`): the held lock after runner work (quirk 1, second half), with the runner retry's keys outside the stage.
- `test/daemon/busy-requests.test.ts:71,86`, `test/daemon/busy-writes.test.ts:60`: the busy-store race through the daemon's socket (the bridge).
- `test/scheduler/request-progress-forced.test.ts:43`, `test/scheduler/request-progress-retry.test.ts:19,37`: the progress record of a forced `run --all`, and of retries taken in a pass and at start.
