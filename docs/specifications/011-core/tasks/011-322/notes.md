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
