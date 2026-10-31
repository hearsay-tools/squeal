# 011-288 design: commit a report only after its hook handed it to the host

Worker f6f61b73, wave 64 W1, 2026-10-31. Rule fixed by the brief (the human, 2026-10-31, option A).

## 1. Prepare and commit: hold the delivery's own transaction open

`deliver` (`src/core/delivery/delivery.ts:248`) already computes the report and every "told" write in one `BEGIN IMMEDIATE` transaction. The split keeps that transaction and only moves its `COMMIT`:

- **Prepare.** A delivery whose options carry a `prepared` sink and whose result is a report leaves its transaction open and gives the sink `{ commit, abandon }`. A delivery that returns `null` commits at once, as today, so the "heard from" writes of a silent boundary are never held.
- **Commit** runs `COMMIT`, then the lint acknowledgement (today it runs after the commit). **Abandon** runs `ROLLBACK`. A process or worker that dies with the transaction open rolls back by SQLite itself (verified by experiment, Node 24.22.1: SIGKILL of a child, and `Worker.terminate()` while idle or in `Atomics.wait`, each left the lock free and the row absent).
- Mechanism: one additive method `Connection.hold()` (`BEGIN IMMEDIATE`, depth + 1, so nested `transaction()` calls become savepoints; returns `commit`/`rollback`) and a `holdTransaction(store)` helper beside `readTransaction`. **These files are outside my ownership** (`src/core/store/connection.ts`, `store.ts`): request below.
- Rejected: prepared writes as data, replayed in a second transaction. Each told helper would split in two, and two concurrent boundaries would both prepare the same transition, so a normal (not stopped) delivery could print twice. That changes normal output: a stop condition.

No schema change, no key change, no change to what a normal delivery prints.

## 2. Each adapter's commit point (`withContext` is the one harness seam)

Every delivery path (tool boundary, turn start, Stop, idle wait, regression `peek`) runs inside `withContext` (`src/harness/shared/hook.ts`). Its context gets the sink. With `deps.handOff` set, `withContext` passes the held reports and the store's `close` to it and does not close the store. Without it, `withContext` commits when `fn` returns. Direct callers and existing tests keep today's behaviour.

| Adapter | Who sets `handOff` | Commit when | Abandon when |
| --- | --- | --- | --- |
| Claude Code, Codex | `runMain` of each bundle | the `stdout` write callback (the waiter's `stderr`) reports success | the write fails; the process dies (host timeout kill) |
| Pi | worker `serve`, one per request | the host writes "commit" into a `SharedArrayBuffer` slot when `DeliveryHost` settles the call while it is still pending | the call was already settled (deadline, cancel, stop); no verdict in 2 s; the worker is terminated |
| OpenCode | `runBridge` | the plugin sends `SIGUSR2` after it parsed an answer marked `held` before its deadline | no signal in 2 s; the group is killed at the deadline |

Pi: after posting a held answer the worker blocks in `Atomics.wait` until the verdict, so no other request on that thread can start a write and wait on its own lock. OpenCode: the bridge answers in one line, so `callBridge` reads the answer before the exit; it sends the verdict, and then gives the bridge 2 s to exit before it kills the group. Version skew: the worker holds only when its `workerData` carries the slot, and the bridge only when the request carries `ack: true`. An older peer gets today's behaviour, never a report held forever.

## 3. What a duplicate looks like

The host received the text, and the process died or the verdict was lost before `COMMIT`. The rollback leaves the view at the old outcome. The next eligible boundary prints the same transition again (for example a second `PASS -> FAIL` in `additionalContext`, a second Stop continuation, or a second regression deny), with the same revision and facts. No test runs again.

## 4. Other "told" effects (research: liveness, holds, revision, counts, edit notes, code, lint)

All main-store effects move with the commit, because they are written in the held transaction: view, liveness, holds, told revision, slow-tier line, counts owed, edit notes, `startTurn` of the idle wait, consumer touch, and the uncovered-edit line when it rides on a held report (alone, with no delta, it still commits as today). The lint acknowledgement moves into `commit`. The code part (`tellCode`) commits its own code-store transaction today. I hold that transaction too, with the same `Connection.hold()`, and commit it after the main store. The lock order (main store, then code store) is the order of today. Not moved: registration (`register`). The brief does not list it, and its header is a snapshot, not a transition.

## 5. Concurrency between two boundaries

The held write lock serializes them, as the short transaction does today. A second boundary's `BEGIN IMMEDIATE` waits for its busy timeout (hooks: 1 s). If the first commits, the second sees the advanced view and repeats nothing. If the first rolls back, the second delivers the owed report. If the wait passes the busy timeout, the second hook is silent and commits nothing, which is today's behaviour on a busy store. Normally the lock is held about 1 ms longer (format, then a pipe write or one message round trip). In the case this row is about, a stalled hook holds the lock until its host kills it (2 s; OpenCode idle `stop.waitMs + 500 ms`). The daemon's writes then retry in their busy slices.

## 6. Tests (done-when)

One test for each adapter. Each holds the report after it is prepared and before the hand-off, then lets the deadline pass: Claude Code and Codex with a child process killed at 2 s, Pi with the real `DeliveryHost`, OpenCode with the real `callBridge` and bridge. At the next boundary the transition arrives once. At the boundary after that, it does not arrive again. A normal delivery commits once. The two research probes, with their assertions reversed, pass.
