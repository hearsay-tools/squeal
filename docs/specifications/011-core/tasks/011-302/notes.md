# Row 011-302: a pending group request says what holds it

Worker c40e635d, 2026-11-06, wave 71 W1. Issue #154. W2's findings
(`research/issue-154-cause.md`) were relayed during the slice and changed it:
the incident request sat in a main-thread stall of at least 111 s, not in
startup, while the socket worker kept answering.

## What the line says now

`squeal run <group> --wait` past its deadline, before the daemon took the
request, still exits 3 with no verdict. The words after the request id are,
in this order, each part only when it is recorded:

1. The daemon's main thread: `has sent no heartbeat for N` (the store's
   heartbeat past its grace, as `heartbeatLateBy` decides; any daemon
   version), `has not read the request for N` (the socket handed it over and
   the main thread never reported on it), `has been keying lint checks for N`
   (a step the main thread announced before it started).
2. The holder the main thread reported: `it waits for the daemon's startup,
   which has run for N`, or `it waits for the scheduler, which has been
   <operation> for N` (`busy for N with work it does not name` without a
   label).
3. With none of these: `what holds it is unknown`; from a daemon before this
   row, with no late heartbeat: `this daemon does not say what holds it`.

Then: `The request stays pending: wait again with squeal run <group> --wait`,
and for a lint group `, or run the linter yourself`.

The incident would have read, for example: `Group lint has no verdict: the deadline passed
before the daemon took request <id>; the daemon's main thread has sent no
heartbeat for 1 min 51 s and has not read the request for 1 min. The request
stays pending: ...`; with `and has been keying lint checks for ...` if the
stall was inside the keying (W2: the exact function is unknown).

## Seam map

- The socket answers from a worker thread (`front-desk.ts`, started by
  `desk.ts`), so it cannot read the main thread's state. The main thread
  posts it. `postMessage` from a blocked main thread is still delivered, so a
  fact posted before a synchronous step stays readable during it.
- `groupRequests` (`run-group.ts`) keeps per request what the main thread
  last said (`HeldBy`), and `undefined` until the first report: that is the
  `unanswered` kind. The answer turns each `since` into `heldMs`.
- `Daemon.#requestGroup` reports startup while `#phase === "starting"`, then
  `requestGroup` watches the scheduler lock with `Scheduler.watchLock` until
  `Scheduler.requestGroup` resolves or rejects. Each watcher call posts one
  `run-group-held` message; no watcher exists while no request waits.
- The lock (`Mutex`) records its holder at every acquisition, watcher or
  not, so a request that starts watching mid-task hears the current holder.
  The holder is set and cleared inside the reactions the lock already had;
  `test/scheduler/mutex.test.ts` compares the order of tasks and callers with
  the plain lock and fails on one extra microtask (checked with a `.finally()`
  variant).
- Lint keying runs on the main thread outside the scheduler lock
  (`runLintPass` calls `rekey`). `LintPassOptions.onKeying` brackets it; the
  daemon turns it into `FrontDesk.step(keyingStep(tool), running)`. Two
  `main-step` messages per keying, posted always: a blocked main thread
  cannot know that a request arrived.
- The heartbeat is not known to the socket worker. The CLI reads it from the
  store at the deadline (`heartbeatSilence`, one read).

## Type and interface changes (all additive)

- `RunGroupResponse.holder?: GroupHolder | null` (`types/daemon.ts`);
  `GroupHolder`: `unanswered | startup | scheduler | unknown`, each with
  `step`.
- `Scheduler.watchLock?(listener): () => void` and `LockHolder { operation,
  since }` (`types/scheduler.ts`).
- `ToDesk` variants `run-group-held { id, holder: HeldBy }` and `main-step {
  operation, since | null }` (`desk-messages.ts`). `FromDesk` is unchanged.
- `DeskEvents.requestGroup(group, held)`; `FrontDesk.step(operation,
  running)`; `HandlerContext.requestGroup(group, held)` and
  `HandlerContext.mainStep?`.
- `Mutex.run(task, operation?)`, `Mutex.watch(listener, failed?)`;
  `RunnerWork.afterTier(task, operation)`.
- `LintPassOptions.onKeying?`.
- Exported from `run-group.ts`: `HeldBy`, `Held`, `MainStep`, `MainSteps`,
  `keyingStep`.

## Lock labels

`scheduler.ts`: starting the scheduler; reconciling N changed paths or the
worktree; checking the tiers in flight; taking a squeal run --all request
(and after the runner work); taking a squeal run <group> request; taking
squeal retry requests; promoting / focusing for a named wait; finding the
test files that read the paths of a named wait; closing the scheduler;
refreshing the install; selecting the next tier; updating the commit report;
putting the files of an unrecorded tier back in the queue. Elsewhere:
recording the results of a tier / a focused tier / backlog slots;
`applying revision N` or `applying observed paths` (runner part); listing
the queued files of group G; selecting a tier of group G.

## Decisions the spec did not settle

1. The heartbeat clause comes from the store in the CLI, not from the
   socket: the socket worker does not know the heartbeat. It works with
   daemons of any version.
2. The heartbeat age is worded `has sent no heartbeat for N`, not `has not
   answered`: the age is of the last heartbeat write.
3. Main-thread facts lead and the startup or lock holder follows (the
   coordinator: "keep the lock label as a second detail").
4. The receipt without `--wait` and `squeal run --slow`'s line
   (`src/cli/run-slow.ts`, not owned) keep their wording. The slow request
   could take the same holder later.
5. A lock holder that is the request's own task reads `taking a squeal run
   <group> request`.

## Proposed spec sentence (019 D6, Command)

Amended 2026-11-06 (row 011-302, gh-154): when `squeal run <group> --wait`
reaches its deadline before the daemon took the request, the no-verdict line
(exit 3) names what held it as recorded, each with how long: the daemon's
main thread (a heartbeat past its grace, a request it has not read, the lint
keying it runs), then the daemon's startup or the scheduler lock's operation;
otherwise that it is unknown, or that the daemon does not say. It ends with
the next action: wait again with `squeal run <group> --wait`, or, for a lint
group, run the linter. `run-group` answers gain `holder`, additive.

## Tests

- `test/cli/group-pending.test.ts`: every wording, `heartbeatSilence`.
- `test/cli/run-lint-group.test.ts`: a named lock holder; the gh-154 shape,
  a late heartbeat with no holder.
- `test/cli/run-group-daemon.test.ts`: a real daemon held in startup by a
  gated Vitest config.
- `test/cli/group-pending-release.test.ts`: the last release's CLI, from its
  tag, reads the new pending answer: exit 3, no stderr.
- `test/daemon/run-group-holder.test.ts`: `groupRequests` kinds and ages;
  `requestGroup` watches only while waiting; through the desk on both
  threads; no `run-group-held` post while no request waits.
- `test/scheduler/mutex.test.ts`, `test/lint/pass/pass.test.ts` (onKeying).

## Open

- W2: the stall's exact function is unknown, and one revision ran five full
  lint config re-keyings. If the stall is outside `rekey`, only the
  heartbeat and unread clauses show.
- `plugins/*/dist` was not rebuilt (not owned): the bundle tests fail until
  the coordinator rebuilds at landing.
