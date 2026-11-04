# 019-26 notes: repair of cand/0.1.398 (review B1 to B3)

## What changed

- **B2.** `SlowTier.holdsFollowers()` answers, for the `after` check, whether a queued file of the lane's group holds its followers. At `commit` only a file its own trigger lets run holds: a commit ask at the file's key, an open request, or an explicit `run --all` checkpoint for it. At any other moment every queued file holds, as before. The host member is `groupHolds` (was `groupBusy`); `Scheduler#groupHolds` is in flight, or the lane's answer. The private `Scheduler#groupBusy` stays for `#normalIdle`, unchanged. The `scheduler.ts` edit was agreed with the coordinator (request bcf432db).
- **B1.** `waitsToLint(state)` in `core/lint/pass/commit-entry.ts`: pending, or stale. `releaseLintGroup`, `commitHold` and the CLI reader `readGroup` in `cli/run-lint-group.ts` use it. A stale check counts as linting when released or its tool is not held for a commit, else as held; its old outcome counts only once it is no longer stale. Agreed with the coordinator (request f5b0538f).
- **B3.** `cli/run-lint-group.ts` uses `socketBound` and `askWithin` from `run-group-wait.ts`. Its own `ask` is gone. The status-poll sleep ends by the deadline. An unanswered ping is a busy daemon, not a stopped one, as in `waitForGroup`.

## Wording that changed

- A first request with no answer: `the daemon did not answer the request to run group <g> before the deadline; it may still take it once its current work allows` (was `the daemon did not answer (<socket error>)`).
- A request not taken by the deadline gains `; the request is pending, and the daemon takes it once its current work allows`.
- A status poll that finds no daemon: `the daemon stopped before taking the request` (was the no-daemon line).

## Tests

- `test/scheduler/commit-group-after.test.ts`: the commit changes only the follower's files; a selected predecessor file completes while an unasked sibling stays queued; a request for the predecessor still holds the follower for its unasked files; both groups asked keep their order. Each case also checks that the report updates once.
- `test/cli/run-lint-group.test.ts`: a released stale pass, then a stale failure, held across the first poll (exit 3, then 0 or 1); an unreleased stale check (exit 3, held); a silent discovery ping; stalled status polls.

## Known limits, not in this row

- `Scheduler#normalIdle` still counts a `normal` commit group's held files as busy, so a `low` group's lane does not take several files while such files stay queued. This is not a starvation: the lane still runs one file at a time.
- An explicit `squeal run <follower>` with a predecessor at `commit` that holds unasked files no longer waits for those files, because no trigger runs them. Before, it waited until its deadline. The requested line still says "once <predecessor> has nothing pending".
- `heldTestFile` (the report's wait) does not consult a lane's open request. Unchanged here.
