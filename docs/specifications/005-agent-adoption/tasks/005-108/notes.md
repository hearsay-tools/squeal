# 005-108 notes: a starting daemon told as "no daemon is running"

## Cause (reproduced, `test/harness/starting-no-row.test.ts`)

Not the coordinator's reading. The text does not come from `ensureIfStale` returning
`unavailable` (that path prints a "Not validated:" line). It is the news delta of
`onToolBoundary`, and its cause is the missing worktree row:

1. A new worktree has no row in the store until its daemon registers
   (`recordRegistration`, `src/core/presence/events.ts:80`). A daemon in its store check
   (`quick_check`, before the socket and the registration) holds the lock and has written its
   start mark (`src/core/daemon/open.ts:185`), but there is no row.
2. `readPresenceFacts` finds the lock file only through the row
   (`src/core/presence/facts.ts:79-82`), so `facts.marks()` is `null` without a row.
3. The session start told the consumer `startingSince` (`registerFirst`,
   `src/harness/shared/ensure.ts:335`). `withToldStart` keeps that start for
   `DAEMON_START_GRACE_MS` only (`src/core/presence/views.ts:114`).
4. Past the grace, `newsView` returns the bare heartbeat liveness when the row is missing
   (`src/core/presence/views.ts:234`), without reading the start mark: state `gone`.
   `toldOf` says `gone`, which differs from the told `starting`, so it is news.
5. The header for a worktree with no listed test files and `noneRunning`
   (`src/core/delivery/header.ts:53-57`) prints
   "Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one."

The same missing row also stops `spawnStartCurrent` (`src/core/presence/findings.ts:31`): the
hook ensure probes the socket, which the daemon binds only after its store check, finds
`ENOENT` and spawns another daemon at each boundary (it then waits for the lock).
`squeal status` reads `statusView` → `withRecordFacts`, which also returns early without a row
(`src/core/presence/views.ts:192`), so status says "no daemon is running" too.

Control: the same sequence with a row whose record is cleared passes (the start mark is read,
the daemon is told as starting, no second spawn).
