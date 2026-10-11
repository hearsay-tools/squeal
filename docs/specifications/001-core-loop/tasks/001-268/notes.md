# 001-268 notes: a wait's trust follows the writing daemon's incarnation

Repair of `reviews/wave-13ad.md` B1, third round. It replaces 001-265's key marks.

## The choice

A row's values can't say who wrote them. An older ledger's same-revision K -> K2 -> K leaves every row as the marks named it. So trust now rests on who wrote the record and who is running, not on what the rows hold.

- **Incarnation.** `daemonIncarnation` (`src/core/types/daemon.ts`) is `<squealVersion>@<startedAt>`, read from the registration row (`worktrees.daemon_version`, `daemon_started_at`). It needs no schema change, and every daemon of every release writes those columns in `#register`, before its loop writes a row. Two daemons never hold one worktree at once (the lock). So any other writer registers a different incarnation first, and its rows come after that registration.
- **Writer.** Each `Ledger.commit` names `SchedulerContext.incarnation` as the record's `writer` (`recordMoves`'s required `MovesWriter`). The daemon passes its own value through `DaemonLoopOptions` / `SchedulerOptions.incarnation`. A ledger without one writes `null`, and no wait trusts that record.
- **Answer.** The sync answer adds `incarnation` beside `moves: true` (`handlers.ts`). The CLI's `SyncState` carries `incarnation: string | null` in place of `moves: boolean`. It is `null` without `moves`, or from 0.1.113 to 0.1.115, which send no incarnation.
- **Reader.** `movesTrusted` / `answerMoves` (`rekeyed-moves.ts`) need four things: a record; `dropped <= sinceSeq`; `writer === incarnation`; and the registration row's incarnation `=== incarnation`. All are read in the wait's one read transaction, both before the window is built and at every poll after. A miss drops the window and takes D7's broad fallback for the rest of the wait. The trust check comes before the refining check, so a wait whose daemon changed while refining falls back at once and does not stay `refining`.
- **First commit.** `Ledger.commit` passes `before`, the rows as they were before its first upsert, when `adoptsAtFirstCommit` says so. `recordMoves` then opens a move at each pending row's revision, whatever its values, and sets `dropped` to that commit's sequence. A wait whose start predates that commit falls back. A later wait holds for every adopted row until its result.
- **When it adopts (follow-up, decided by the human).** The daemon reads the registration before its own in `#register`'s transaction, before the upsert (`predecessorIncarnation(row exists, WorktreeRepo.lastDaemon)`), and passes it as `SchedulerOptions.predecessor`. The first commit adopts unless the worktree had no row (`null`: fresh) or that incarnation is the record's `writer` (a restart from one 001-268 daemon to another). An unreadable predecessor (`undefined`: no start time, or no version) adopts, and so does any other.
  - **Why it holds.** Every daemon of every release registers before it writes a row, under the worktree lock. So the last registration names the last daemon that could have written a row. If it also wrote the record last, its moves cover its rows, written in the same transactions. If no row exists, no daemon ever ran and there are no rows. An older daemon's registration overwrites the identity with its own, and its clean exit empties it. Either way the next new daemon adopts.
  - **The clear.** Agreed with the parent, outside this row's read-only ownership of `worktrees.ts`: `setDaemon(null)` keeps `daemon_started_at` and `daemon_version` and clears only the socket and interval. Without that, every idle exit or `squeal stop` would leave the identity unreadable, and new-to-new restarts would still adopt. Every other read gates on the socket (`toRecord`).
- **Marks.** Removed. `moves-keys.ts` is gone and so is the record's `keys` field. A 0.1.115 CLI reading this record finds no `keys` and falls back (checked below).

## Successions

| Succession | Result | Test |
| --- | --- | --- |
| New answers, old registers and does K -> K2 -> K between two polls, before refinement | registration differs: fallback, timeout | `status-wait-round-trip.test.ts`, red at 58cd9a38 (quiet) |
| Same, after the window was built | dropped at the next poll: timeout | same file, red at 58cd9a38 (quiet) |
| Old does K -> K2 -> K, then a new ledger's first commit, then the wait syncs with it | A adopted as an open move: the wait holds for A (2 files, 1 pending) | same file, red at 58cd9a38 (quiet); `first-commit-adoption.test.ts` with a real second ledger, red at 58cd9a38 (nothing adopted) |
| The answering daemon itself does the round trip (control) | its moves name A: holds | same file |
| 13ac's single-move successions, before refinement and after the window | timeout, no window | `status-wait-successor.test.ts` |
| New CLI, a daemon whose sync has no incarnation | fallback | `status-wait.test.ts` (`answering(..., null)`), `rekeyed-moves.test.ts` |
| Actual 0.1.112 CLI (`cf7e8a2c` bundle), static, against this daemon's socket and record | exit 0, timeout, no `edit`, A queued | manual probe, below |
| Actual 0.1.115 CLI (`58cd9a38` bundle), same | exit 0, timeout, no `edit`, A queued | manual probe, below |
| A later daemon registers between two polls, or the answering one unregisters | fallback | `rekeyed-moves.test.ts` |
| Fresh worktree: a wait that starts before the daemon's first commit | nothing adopted: quiet once A has its result, B (baseline) still queued | `status-wait-first-commit.test.ts`, red with always-adopt |
| New-to-new restart, crash or clean exit, wait before the first commit | same: quiet on A | same file, red with always-adopt (crash, clean) and with the clear unchanged (clean) |
| Older registration in between | adopts: timeout, no window | same file (control), the round-trip old-then-new case |
| Real daemons: fresh, clean restart, after a 0.1.112 registration | `dropped` 0, 0, then bumped | `test/daemon/first-commit-predecessor.test.ts`, red with the clear unchanged |

The manual CLI probe was the fixture's `newerDaemon(worktree(4))` with A queued with no move, and B with an open move that has its result 300 ms in. It ran `node <bundle> status --json --wait 1500` in the worktree and printed `Returned on timeout after 1.5 s: 1 check pending at revision 4` for both bundles. It is not committed, because it needs a released bundle from git history. The source is in this task's transcript; to rebuild it, run `git show <commit>:plugins/claude-code/dist/cli/squeal.mjs` and spawn that bundle the same way.

## Costs and edges

- **Restarts.** After the follow-up, only a start after an older, unknown or other writer adopts. Such a start makes a wait that spans it fall back, and later waits hold for every row the predecessor left pending, backlog included, until each has its result. A fresh worktree, or a restart after a new daemon (crash or clean exit), adopts nothing.
- **Same incarnation.** The incarnation is unique only by version and start millisecond. A successor of the same version started in the same millisecond (only possible with an injected clock) or a wall clock stepped back to the exact same millisecond would read as the same incarnation. Every registration row change is otherwise caught.
- **Older CLIs.** 0.1.113 and 0.1.114 CLIs don't check writers and keep their own B1, as before. 0.1.115 CLIs now always fall back against this record.
- **S1 untouched.** A move recorded after a window is built still doesn't join it (row 001-267).

## Seam map

- `src/core/types/daemon.ts`: `daemonIncarnation`, `SyncResponse.incarnation`.
- `src/core/daemon/daemon.ts` passes `incarnation` to `createDaemonLoop`, which spreads it into `SchedulerOptions`. `scheduler.ts` copies it into `SchedulerContext`. `handlers.ts` answers it from its context's version and start.
- `src/core/scheduler/ledger.ts`: `commit` reads `before` on the first commit when `adoptsAtFirstCommit(store, id, context.predecessor)`, and passes `{writer, before}`.
- `src/core/types/daemon.ts`: `predecessorIncarnation`. `src/core/store/repos/worktrees.ts`: `lastDaemon`, and the clear that keeps the identity. `src/core/daemon/daemon.ts`: `#predecessor`, read in `#register`.
- `src/core/scheduler/rekeyed-moves.ts`: `Moves.writer`, `MovesWriter`, `movesTrusted`, `answerMoves(…, incarnation)`.
- `src/cli/status-sync.ts` / `status-wait.ts`: `SyncState.incarnation`, the per-poll `movesTrusted`.
- **Test fixtures.** `test/scheduler/store-wait.ts`'s `HARNESS_DAEMON` / `HARNESS_INCARNATION`: `openHarness` defaults to it, and `liveDaemon` registers it. A test that reads `answerMoves` must register that daemon. `test/cli/status-wait-fixture.ts`'s `INCARNATION` / `BY_LIVE`. `test/cli/status-wait-successor-fixture.ts` holds the real-socket newer daemon (`newerDaemon(w, startedAt)`, `commit(rows, open, first)`), and the older one (`olderSuccessor`, `olderCommit`).
