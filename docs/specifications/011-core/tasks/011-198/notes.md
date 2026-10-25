# 011-198 and 011-200 notes: the change feed records what it delivered

Worker W1 of wave 36 (8e547389), 2026-10-25. Base cand/0.1.304b `776c6832e`. Commits `0ec946eec` (011-198) and `1619a4e24` (011-200). The rounds on `origin/cand/0.1.304` (`f049340cb`, `c51cc53c4`) were read as reference only; nothing of them is in this branch.

## 011-198: one owner for "a pass was delivered"

The two earlier rounds asked the outcome of one requested pass (`reconcile` resolving, then `reconcileChecked` rejecting). Each path that ends a pass without delivery had to carry that outcome: a git failure, a busy retry that failed, a close before the task, a close during a retry (B1's second path). The third round, the single owner the human chose, records the fact where it happens instead:

- `Feed#reconcileNow` counts every pass it starts (`passesStarted`, a retry too) and, only after `emit` returns `true` (`onBatch` took the batch), sets `delivered = { number, startedAt }` beside `passHead`. `emit` returns `false` when the feed is closed.
- `requestFullSuite` (`scheduler.ts`) reads `passes.started()`, awaits `passes.pass()`, and throws `NO_PASS` unless `passes.delivered().number` is above the note. The option `passes` (`FeedPasses`, `types/watcher.ts`) is wired in `createDaemonLoop` to the feed. Without the option (every scheduler test) nothing changes.
- Nothing tracks a pass's outcome. A pass that failed, that a close kept back or that a retry replaced simply is not the last delivered pass. A retry that lands is a pass of its own, numbered after the request, so it counts.
- The CLI needs no change: a rejection becomes `state.error` (`handlers.ts`), and `run --all --wait` prints `No verdict: run --all failed: …` and exits 3.

The note is a pass number, not a clock time. The brief says "notes the time"; a count orders a pass against the request exactly, where two clock reads in one millisecond or a clock step would not. The pass's wall time is kept beside it for 011-200.

`handleBatch` returns without storing when the scheduler is closed or reinstalled. The feed and the scheduler close in the same turn (`createDaemonLoop.close` calls both synchronously; the daemon always closes through it), and a reinstalled scheduler abandons the checkpoint. So a pass "delivered" to a closed scheduler cannot plan a stale checkpoint.

Tests, `test/scheduler/full-suite-pass.test.ts`, run against copies of each source tree (isolated `HOME`, `XDG_*`, `TMPDIR`):

| Test | 776c6832e | e75de61c3 | 6df494769 | 0ec946eec |
|---|---|---|---|---|
| plans at the edit's revision, silent watcher (findings) | fail | pass | pass | pass |
| B1 path 1: git status exits 128 for the requested pass | fail | fail (resolved) | fail (message) | pass |
| B1 path 2: close during a busy retry | fail | fail (resolved) | fail (resolved) | pass |
| busy retry that stores | fail | pass | pass | pass |
| a request joined to a pending pass that fails | fail | fail (resolved) | fail (message) | pass |
| a close before the pass | fail | fail (resolved) | fail (message) | pass |

"(message)": R1 rejected too, with its own error text; this round rejects with `NO_PASS`.

How long `run --all` waits on its pass: in the fixture, `requestFullSuite` took 59 to 126 ms (pass and planning). On this repository (7,714 tracked files, silent backend, the stat cache as `git ls-files`), one pass took 1.1 to 1.4 s, the feed's start 2.0 s, at load average 24 on 24 cores.

## 011-200: the feed's last delivery, stored for status

As approved by the human, with the coordinator's conditions (requests 526f58ad and a001c13b, 2026-10-25):

- The feed calls `onDelivered(startedAt)` after every delivered batch, a watch batch or a pass. A watch batch's time is its task's start; a pass's is the pass's start. A pass-only time would say "late" during steady edits, because every hint pushes the idle pass back 30 s (`armIdle`).
- `FeedDeliveredRow` (`src/core/status/feed-late.ts`) writes `feed-delivered:<worktree>` in `meta`, scheduled by `setImmediate` from the daemon loop, so never inside the feed's queue. It writes only when the stored time is 15 s old or more. A busy store skips the write (`withBusySliceSync(0, …)`): the next delivery writes. Another failure goes to `onError` once until a write lands.
- `withLate` gives an alive daemon `late: { since }` when the stored time is more than 60 s old (`FEED_LATE_MS`, twice the idle interval). A time from before the live daemon's `startedAt` is its predecessor's, so a daemon that has not delivered yet, or a release that stores nothing, is never called late. A stopping daemon is not either.
- Readers: `readLiveHeader` (every hook header, Stop) and `buildSnapshot` (status, `status --wait`, `--json`). Text: the header's liveness part and a status line after the revision line say `Edits since HH:MM:SS may not be seen yet; results are current as of revision N.` (`timeText`, local time, as status's other clock times); `notCurrentText` says `N test files current as of revision R` instead of `all N test files current`. JSON: `daemon.late.since`, additive.
- `test/store/worktree-meta.test.ts` requires a named `…MetaKey` function per row: `feedDeliveredMetaKey`.

Not covered: a feed stuck before its first delivery after a daemon start shows no line (the row is the predecessor's). The feed's start pass runs after the baseline, so this is the start-up window, not 011-197's stall.

Writes per minute on this repository: see W1's final report (measured on a clone with the real watcher).

## Seams for the next worker

- The feed is the only place that knows a batch was delivered: `Feed#emit`. Anything that needs "the feed saw edits up to T" should read `delivered` or the row, never infer it from revisions.
- `FeedPasses` is the scheduler's whole view of the feed. `#requestSync` (`daemon.ts`) still uses the loop's plain `reconcile` and does not check delivery; `status --wait` refuses a verdict on its own grounds.
