# Row 011-323 notes: the shared rules reach every request

Worker ec4b104d, 2026-11-13. Brief: `tasks/wave-81.md`, W1. Design: `research/request-intake.md`, differences 1 and 2. Base `371cc8f8c` (origin/main after 0.1.475 and review 0.1.474-r2; first written on `66448a5fb`).

Commits:

- `f04f4378a` fix(011-323): an import's waiting mark is written inside the busy-store retry
- `7841a307e` fix(011-323): a squeal retry wakes the lanes of the files it queued

## Difference 1: the import's waiting mark

### What changed

- `imports-waiting.ts`: the one declaration became two.
  - `importRequest(projects, imports, queueObserved)`: a `Request<boolean>`. Its stage reads the projects' observed entries again (`keys.refreshObserved`), writes the waiting mark (`markImportsWaiting`, a savepoint inside the stage's transaction) and queues the regrow (`queueObserved`), in one transaction tried again while the store is busy (`#request`). Closed or not started: `false`; an install awaited or a reinstall at the at-once check: `false`; covered files `[]` (the regrow re-keys the files it reaches and runs none); no runner work waited for; no lane woken.
  - `observedRequest(queueObserved)`: the lifecycle's refresh, still a `NowRequest<boolean>`. It writes no store, so its store skip now says that, not difference 1. Its `now` only queues the regrow, as the old call with no projects and no imports did.
- `Scheduler.requestImports(projects, imports): Promise<boolean>` takes `importRequest`; `Scheduler.refreshObserved(): boolean` takes `observedRequest` and lost its two optional arguments.
- `ImportsSeen.take` awaits its reread (now a promise). `daemon.ts` `#requestRetries` awaits it before `requestRetries`, as the synchronous call ran before it.
- The lifecycle's boolean (`daemon.ts:416`) is unchanged: same call, same synchronous answer.

### Callers, before and after (coordinator's condition)

| Call | Before | After |
|---|---|---|
| `ImportsSeen.take` | `daemon.ts:1095` (`#requestRetries`), synchronous; `test/shared/daemon-kit.ts:107` (`daemonOf`'s `retry`), synchronous; `test/shared/imports-seen.test.ts` | `daemon.ts:1095`, awaited; `test/shared/daemon-kit.ts:107`, awaited; `test/shared/imports-seen.test.ts` (async); `test/shared/import-busy.test.ts` |
| `Scheduler.refreshObserved(projects, imports)` (an import) | inside the two `take` calls above | gone: `Scheduler.requestImports(projects, imports)` in those calls |
| `Scheduler.refreshObserved()` (no arguments) | `daemon.ts:416` (lifecycle `observedChanged`); `test/scheduler/observed-growth.test.ts:68,82,106,130`; `preload-refresh.test.ts:31`; `runtime-files-shared-timer.test.ts:47` | the same calls, unchanged |

`test/scheduler/runtime-files.test.ts:256` calls the keys' `refreshObserved`, not the scheduler's.

### An import whose request answers false or throws (coordinator's condition)

- While its request runs, the import's ids count as seen: a `#requestRetries` meanwhile does not hand them again, and goes on to its own `requestRetries` without waiting for the first one's mark. Before, the call was synchronous, so no second call could run meanwhile.
- `false` (closed, not started, an install awaited or a reinstall): the ids are seen no more. The next `#requestRetries` hands them again: the next `squeal retry`, `squeal import`, or reader import. As before.
- It throws: the ids are seen no more, and `#requestRetries` rejects before `requestRetries`, as before when `markImportsWaiting` threw. `squeal import` ignores the rejection (`tellDaemons`, `src/cli/import.ts`); the reader's `imported` callback logs it (`daemon.ts:946`). The two ways it throws:
  - the store still busy when the daemon stops: "taking the observed reads of an import: the store was still busy when the daemon stopped". Nothing of the stage ran. The next daemon's start keys every import the store holds and empties the mark (`clearImportsWaiting`), so nothing is lost.
  - any other error in the stage: the transaction rolls back, so no mark is written, and the ledger is put back (`Ledger.hold`). The keys' refresh ran first, in memory: the grown files it found wait in the keys (`#grownElsewhere`) for the next regrow. The next call hands the import again.
- Before: on a busy store the mark failed after the store's own wait (5 s in the daemon, with the event loop stopped), after the keys' refresh, with no regrow queued and no pump. It was handed again only at the next `#requestRetries`.

### Behaviour that moved

- The import now takes the scheduler's lock, once per busy try (no runner work: today's quirk 1). Before, it took no lock. So a `squeal import` or `squeal retry` waits for the lock twice: first the import, then the retry. Before, it waited once. Both requests wait for the same holders, so the total wait is about the same.
- The regrow is queued inside the stage's transaction, under the lock, before the commit. A commit that then fails leaves a queued regrow that finds nothing to re-key.
- The busy note names it: "ran once it was free: the observed reads of an import".

### Test

`test/shared/import-busy.test.ts` (new). A lookup-only scheduler over a fresh clone of a published CI run, with the daemon's busy retry (`BusyWaits`, slice 25 ms) and its store's own wait at 100 ms. The reader imports first. Then another thread holds the write lock for 500 ms, and the daemon's retry request runs as `daemon.ts` wires it. The re-key's refinement is held. The test checks four things. The retry answers after the holder ends. Status names the import (`keysPending` 3 of 3) while the refinement waits. The busy note names the import. Once released, every file is current from the import, with no run.

Red before the fix, with the old wiring (`refreshObserved(projects, imports)` inside `take`): `database is locked (ERR_SQLITE_ERROR)` at `connection.ts:51`, from test line 68 (Squeal, revision 2). Green after (Squeal, revision 6: FAIL -> PASS).

`test/shared/imports-seen.test.ts`: the first case awaits its takes. A new case covers two things. A take while one runs does not hand the import twice. A take whose reread throws leaves the import for the next take.

## Difference 2: the retry's lane wake

### What the test showed

Mostly no wait. Every request ends with the pump, and the pump asks each group's lane again (`#groupLanesNext`):

- an idle lane plans the retried file at the retry's own pump.
- a lane the load guard defers: its `next` ends the deferral and reads the guard again. A retried file is not explicit (`#explicit`), so it waits for the load, with or without a wake.
- a lane with a tier in flight: one tier per group (`#laneMayStart`); a wake does not change that.

One window does make it wait. `SlowTier.next` lists the queued files under the lock (`#candidates`, operation "listing the queued files of group <g>"). Then it checks the runtime and the holds (`#mayStart`), and only a preemption since the listing makes it plan again. Then it selects from the listed files (`#launch`). A retry stage that runs between the listing and that check queues a file the tier leaves out. That file waits for the lane's next planning, once the tier ends: minutes for a slow tier. This is the window `run --all`'s early wake narrows (design, quirk 2; `slow-tier.ts:357`).

`test/scheduler/retry-slow-lane.test.ts` (new). It uses the catch-up fake runner, two slow files and `slow.maxParallel` 2, on an idle machine (load 0, a private slot directory). The first retry queues `s1`. A lock watcher sees the slow lane's listing and then makes the second retry: `s2` is asked and `requestRetries` is called. That retry's stage is the lock's next task, so it runs after the listing. Without the wake the lane ran `[[s1], [s2]]`, red 3 of 3 direct runs. With it the lane ran `[[s1, s2]]`, green 3 of 3.

### What changed

- `request-intake-types.ts`: `WakeRule` gains `{ coveredLanes: string }` (the reason): after the record, the lanes of the covered files' groups.
- `request-intake.ts`: `#wake(wake, covered)` wakes `host.wakeLane(g)` once per group of the covered files (`ledger.queue.checkGroup`). The `tests` group has no lane, and `wakeLane` finds none for it (`GroupTiers.get`). The apply path passes `[]`. `#stage`'s call passes `done.covered`. That is the one line in W2's part I touched, to keep the build compiling.
- `retries.ts`: `retryRequest.wake` is `coveredLanes` in place of its named skip (and its doc line). Nothing else in the file.
- `test/scheduler/request-intake.test.ts`: the real retry row now logs `wake lane tests` between the record and the pump. Its title says so.

### Window still open

A retry stage that runs after `#mayStart`'s last check and before `#launch`'s select task is not seen: `#select` reads the listed files, not the queue. The narrow run's lane wake has the same window. Closing it is in `slow-tier.ts` (not this row's; card 8's).

### Read in source, not tested: a retried file is no trigger

`SlowTier.#trigger` lets a slow file run on its group's moment, an open request, a commit's or narrow run's ask, or its `run --all` checkpoint. A retry is none of these. So a retried file of a group at `commit` or `manual` stays queued until `squeal run <group>` or a commit asks for it. At `pause` or `stop` it waits for the agent's pause. The default `slow` group (`continuous`) and `edit` groups after their quiet window run it. This is inferred from the code, not run. If it is unwanted, it is a new row, not a widening of this one.

## Decisions the design did not settle, and my choice

1. Two declarations, as 011-322's notes proposed: an async `importRequest` for the import, and the synchronous `observedRequest` for the lifecycle, which writes nothing. The lifecycle's boolean did not have to become a promise, so I did not ask about it.
2. The import is a `Request` with a stage: it takes the lock and the busy retry like every other store write. `covered: []`, with a comment, since a stage cannot name a skip for its covered files.
3. The keys' refresh runs inside the stage, first, as before. A busy store refuses `BEGIN IMMEDIATE` before the stage runs, so the refresh runs once per stage that runs.
4. `ImportsSeen.take` sees the ids while their request runs, and sees them no more on `false` or a throw.
5. The wake is a new rule (`coveredLanes`), not a list of lanes in the declaration: the retry's lanes are known only after its stage.
6. The new import test drives the scheduler, as `daemon-kit.ts` does, not a real daemon: the done-when's daemon wiring is `#requestRetries`'s two lines, which `daemon-kit.ts` and the test mirror.
7. Operation names: "taking the observed reads of an import" (busy note: "the observed reads of an import"); the lifecycle's NowRequest is "refreshing the observed reads" (it takes no lock, so no watcher sees it).

## Type changes

- `Scheduler.refreshObserved(): boolean` (was `(projects?, imports?) => boolean`): narrowed; only the import passed arguments.
- New `Scheduler.requestImports(projects, imports): Promise<boolean>` (`src/core/types/scheduler.ts`).
- `ImportsSeen.take(reread: (projects, imports) => Promise<boolean>): Promise<void>` (was synchronous with a boolean reread).
- `observedRequest(queueObserved): NowRequest<boolean>` (was `(projects, imports, queueObserved)`); new `importRequest(projects, imports, queueObserved): Request<boolean>`.
- `WakeRule` gains `{ readonly coveredLanes: string }`. `RequestIntake#wake` takes the covered files (private).
- Test fixture: `SideOptions.busy?: Pick<SchedulerOptions, "busyWaits" | "busySliceMs">` (`test/scheduler/claims-fixture.ts`).

## Files outside the brief's list, by agreement

Coordinator 9ddca779 approved these on 2026-11-13 (reply to request `0c11e048`): `src/core/types/scheduler.ts` (the two methods), `src/core/shared/imports-seen.ts` with `test/shared/imports-seen.test.ts`, `test/shared/daemon-kit.ts`'s `retry`, and the one optional `busy` field on `test/scheduler/claims-fixture.ts`'s `side()`. Row 011-329 also edits that file. In W2's part: the one `#wake` call in `#stage` (above).

## For W2 (row 011-325)

- The import is now a staged request (`importRequest`) whose stage returns `covered: []`. Your record step will see it: decide whether a request with no covered files writes a record. It is not one of your five table rows.
- `#stage` calls `this.#wake(request.wake, done.covered)`; keep the second argument if you move the call.
- In `retries.ts` I changed only `retryRequest.wake` and its doc line; its stage is yours, untouched.
