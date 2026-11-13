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
