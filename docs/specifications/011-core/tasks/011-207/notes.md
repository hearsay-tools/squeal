# 011-207 notes: a named wait asks one run of a stale or unknown file named by its own path

Worker b528f9fc, wave 41 W1, 2026-10-25. Commits `89ef7b49e` and `716a9479e`. The line and the JSON field were agreed with the coordinator in request ca7aa09c (reply: a new `asked` standing in place of "queued, promoted").

## What the wait does

1. At its first decided read (`ready`, not the final read, no `--check`), `askableFiles` (`src/cli/status-wait-ask.ts`) takes the selected files named by their own paths (`ownNamedFiles`). It keeps a file only when its row has a key and nothing queued, its class is `stale` or `unknown`, no other live worktree runs its key (`claimantOf`, C7), and no retry request was ever kept at its key (any record: pending, ended or cancelled).
2. The read returns `{ ask, root }`. Outside the read transaction, `askNamedRuns` opens the store for writes (`openForWrites`), stores each request with `askNamedRun` (`src/core/retry/records.ts`, one transaction, `noResult: true`, reason `environment` as `retry` stores it) inside `whileBusy` (bound: min(10 s, time left)), then tells the daemon `{ type: "retry" }` (`tellDaemonRetries`). The loop reads again at once.
3. Each later read calls `askedEnds(..., false)`. A request still pending for a file at the asked key whose class is still stale or unknown is `untaken`. It turns a `settled` outcome into "keep waiting". The states and the `retries` meta row are read only for asked files (011-42).
4. The first promotion goes as before. An asked file that was untaken then is promoted again once queued (`takenSince`), since `Promotions.add` keeps a promotion only of files queued or running when it comes.
5. The last read: `askedEnds(..., true)` gives each asked run's `pending` and `outcome`. Untaken files read `state: "pending"` with the `asked` standing (`heldAsFiles`). The verdict counts them pending (`heldAsVerdict`), so `selection.reason` is `pending`.

## Output

- `Run asked: <file> was stale with nothing queued, so this wait asked its one run at these inputs, as `squeal retry <file>` does.` After `Selected:` and the path lines (`askedLines`, one call in `namedText` and one in `printNamed`'s stderr lines).
- Endings: `; the run is pending` and `; the run is pending: the daemon has not taken the request yet`. With several files: `; N runs are pending: <paths>`.
- A busy store: `Run not asked: <paths>: the store stayed busy; `squeal retry <paths>` asks it.` Nothing is held.
- Class line of an untaken file: `run asked by this wait; the daemon has not queued it yet` (`nextStep` case `asked`).
- JSON: `selection.asked` and `wait.asked`, `[{ project, path, pending, outcome? }]`, present only when the wait stored a request or found the store busy.

## Decisions the spec did not settle

- `--check` waits ask nothing. A focused wait keeps 0.1.286 B6's behaviour (it sends `focus` for a stale or unknown file). Asking a whole-file run beside it is a later choice.
- Slow files are not left out. A stale, unqueued slow file is not pause-only (`pauseOnlyIds` takes queued files only), so a wait asks its run. Once the daemon queues it, it can become pause-only, and the wait then returns `slow` as before.
- A request at the key from another process between the read and the write (`joined`) is held for as if this wait had asked it. The `asked` (ended) answer of that race is not held.
- Tests that pin the wording of stale and unknown rows (`next-step-seed.ts` `waited`, `status-wait-reasons.test.ts` `timedOut`) pass `ask: async () => []`. Those rows still apply to a source path's selection, a claimed key and a key whose one run ended.

## Type changes, all additive

- `Standing` gains `{ kind: "asked" }` (`src/core/types/standing.ts`).
- `NamedWait` gains `asked?: readonly AskedEnd[]`. `NamedWaitPayload` gains `asked?: readonly AskedPayload[]`.
- `NamedWaitOptions` gains `ask?: AskNamed` and `asker?: string`. `namedWaitCommand` sets `asker` from `sessionOf(io)`, the value `retry` uses, when the caller gives none.
- `records.ts` gains `askNamedRun` and `NamedRunAnswer`.

## For the next worker

- C15's "does not change which files run" and 005 D2 need the exception in spec text (coordinator).
- `waitForNamed`'s read callback was at complexity 55 before this row. It is higher now. A split of the decided-read part into its own function would help the next change.
