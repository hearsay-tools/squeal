# 021-08: daemon writes in the retried path

Worker ca906185, wave 1 (`../wave-1.md`), base `235de8076`, 2026-11-11. Spec D2.

## Commits

| Commit | Part |
| --- | --- |
| `68f121576` | `retryWhileBusy` (`store/busy.ts`); refinement apply retried (`scheduler/refine-apply.ts`, `runner-work.ts`) |
| `fbf4f8654` | `scheduler.ts` by agreement (request d5db635f): runner work gets the busy slice and waits; `#reconcilePaths` retried |
| `5d070e369` | `daemon.ts`: registration, the start's scan mark, writing socket requests, shutdown mark and record clear (`daemon/busy-writes.ts`) |
| `8626bf630` | `bootstrap.ts` and `scheduler.ts` by agreement (request 37866011): the baseline's last commit retried |
| `b77b708b3` | R1: the worker-thread lock holder shared by the daemon's busy tests |
| `2d91c885c` | R1, review 0.1.434 B2: `scheduler.ts` by agreement (request 7cf4a17d): a socket request's write stage retried (`#transact`, `#request`) |
| `9c4aad93a` | R1, B2: the daemon's free-lock probe (`#writable`, `DaemonWrites.writable`) removed |

## The retried path

One loop, `retryWhileBusy(attempt, { sliceMs, waits, key, what, stopped })` in `store/busy.ts`: each try's writes wait at most `sliceMs` (`withBusySlice`), a refusal is told to `BusyWaits` and tried again after `busyBackoffMs`, any other error or a refusal once `stopped` is thrown. `full-check.ts` has a private copy of the same loop for synchronous writes (`sliced`); a later quality pass can fold it into this one.

A busy store refuses `BEGIN IMMEDIATE` before the transaction writes. What a refused try changed in memory before its first write is the caller's to make good. Each site:

| Write | Where | Retry |
| --- | --- | --- |
| Refinement apply | `refine-apply.ts` `applyRefinement` | in place, lock released between tries; the runner part is kept; from the second try the ledger files whose key the index moved and the ledger did not take (`lagging`) are added to `reresolved`, which `applyRunnerPart` touches; `ledger.refineChanges` keeps collecting until the commit lands; after the commit only `importsKeyed` is tried again (018-28 order) |
| Revision recorded refined after another error | `refine-apply.ts` `recordRefined` | whole write |
| A hold's released paths, a run's moved paths | `scheduler.ts` `#reconcilePaths` | whole pass, stat and all; the pass itself is sliced (`#handleBatch(…, true)`) |
| Baseline's last commit | `bootstrap.ts` `commitLast` | `ledger.commit` again; a refused commit puts its writes back (row 011-126) |
| Registration, start's scan mark | `daemon.ts` via `DaemonWrites.write` | within `DAEMON_START_BUSY_TIMEOUT_MS`, or until a stop |
| run --all, run slow, run group, run group paths, retry | `scheduler.ts` `#transact` in `#request` | the request's synchronous stage runs in one store transaction taken before it changes anything, so a refusal comes first and the stage is tried again whole; the lock is released between tries, except after the runner work (`afterTier`), where the task already holds it; another error rolls the store back and `Ledger.hold` puts the ledger back |
| Shutdown mark, record clear | `daemon.ts` via `DaemonWrites.write` | within `SHUTDOWN_WRITE_MS` (5 s, the wait it replaced) |

## Decisions the spec left open

- **A refinement is retried in place, not pushed back on the queue.** It keeps its place, so later revisions still apply in order, and its fetched runner part is reused. Only a busy refusal is retried. Another error keeps today's note and "counted refined": a deterministic error would loop.
- **A refused refinement during the scheduler's close returns quietly.** The revision stays unrefined, and the next daemon's start reads its paths as edits (task 001-113), instead of a note and a refined mark.
- **Socket requests: the write lock first, then the change** (R1, review 0.1.434 B2; the first round's free-lock probe reserved nothing). A request changes scheduler memory before its commit (a full suite creates a checkpoint, a retry claims and queues), so it must never run twice: its stage takes the store's transaction before it changes anything, and only a refusal at that start is retried. A request still refused once the daemon stops answers `<operation>: the store was still busy when the daemon stopped`. A lint group's release writes the code store, so it stays outside the store's transaction (D3). `retryRunner`'s own writes, on the runner-failure path before a full suite, are not retried. `promote` and `focus` are unchanged: their one write, the yields row, is tried once with no wait and skipped when busy (`yields.ts`, `withBusySliceSync(0, …)`).
- **`run --all` in a daemon waits** behind a reconciliation pass started after the request (row 011-198), which the feed retries; its held-lock test is at the scheduler (`test/scheduler/busy-requests.test.ts`), where no such pass runs.
- **Bounds.** Start writes keep the start's 120 s total; shutdown writes keep 5 s each. Everything else retries until it lands or its scheduler or daemon stops.

## Not done here

- CI import (`transfer-import.ts`): spec 018's, by the brief.
- `install-stamp.ts` `refreshInstall`: its only write is `ledger.commit()`, which owes its writes after a refusal; the pump's next commit writes them. Not changed.
- `keying.ts` `trackUntracked` clears `#untracked` before `track`; a refused `#seed` flush loses the paths' ignore check (`checkIgnored` never runs for them). The refinement's retry sets every closure of its runner part again, which refreshes their hashes (`KeyIndex.setClosure` re-acquires shared entries), so keys are right; only the extra-file watch of such a path can be missed. Fix belongs to `keying.ts`.
- `scan()` at start writes revisions with the start's long wait. D2 does not list it.

## Tests

| Test | Held lock | Red on the old code |
| --- | --- | --- |
| `test/scheduler/busy-refinement.test.ts` | second process, 2 s, during revision 1's runner phase, revision 2 queued | yes: `test/new-one.test.ts` keyless |
| `test/scheduler/busy-released.test.ts` | second connection taken as the released paths' pass begins its write | yes: a tier ran at the conflicted keys |
| `test/daemon/busy-writes.test.ts` | second process, 1.5 s; daemon's serving wait mocked to 200 ms | yes: retry rejected `database is locked`; shutdown mark missing |
| `test/daemon/busy-requests.test.ts` (R1) | worker thread, taken when `squeal run tests` takes the scheduler's lock (its `held` callback), after where the probe ran | yes: event loop stopped 1,606 ms; a request refused at the stop failed with a bare `database is locked` |
| `test/scheduler/busy-requests.test.ts` (R1) | second process, 1.5 s, store's own wait 100 ms | yes: retry and run --all rejected `database is locked` |
| `test/daemon/busy-start.test.ts` | worker thread, taken at the baseline's last commit, 1.5 s | yes: no ping answered during the hold |
| `test/store/retry-while-busy.test.ts` | none (unit) | new helper |
