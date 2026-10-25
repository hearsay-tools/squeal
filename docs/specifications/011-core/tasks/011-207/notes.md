# 011-207 notes: a named wait asks one run of a stale or unknown file named by its own path

Worker b528f9fc, wave 41 W1, 2026-10-25. Commits `89ef7b49e` and `716a9479e`. The line and the JSON field were agreed with the coordinator in request ca7aa09c (reply: a new `asked` standing in place of "queued, promoted").

## What the wait does

1. At its first decided read (`ready`, not the final read, no `--check`), `askableFiles` (`src/cli/status-wait-ask.ts`) takes the selected files named by their own paths (`ownNamedFiles`). It keeps a file only when its row has a key and nothing queued, its class is `stale` or `unknown`, no other live worktree runs its key (`claimantOf`, C7), and no retry request was ever stored at its key (any record: pending, ended or cancelled, in the `retries` row or as an entry of the `retries-asked` row; see B2 below).
2. The read returns `{ ask, root }`. Outside the read transaction, `askNamedRuns` opens the store for writes (`openForWrites`), stores each request with `askNamedRun` (`src/core/retry/records.ts`, one transaction that checks the file again, `noResult: true`, reason `environment` as `retry` stores it) inside `whileBusy` (bound: min(10 s, time left)), then tells the daemon `{ type: "retry" }` (`tellDaemonRetries`). The loop reads again at once.
3. Each later read calls `askedEnds(..., false)`. A request still pending for a file at the asked key whose class is still stale or unknown is `untaken`. It turns a `settled` outcome into "keep waiting". The states and the `retries` meta row are read only for asked files (011-42).
4. The first promotion goes as before. An asked file that was untaken then is promoted again once queued (`takenSince`), since `Promotions.add` keeps a promotion only of files queued or running when it comes.
5. The last read: `askedEnds(..., true)` gives each asked run's `pending` and `outcome`. Untaken files read `state: "pending"` with the `asked` standing (`heldAsFiles`). The verdict counts them pending (`heldAsVerdict`), so `selection.reason` is `pending`.

## Output

- `Run asked: <file> was stale with nothing queued, so this wait asked its one run at these inputs, as `squeal retry <file>` does.` After `Selected:` and the path lines (`askedLines`, one call in `namedText` and one in `printNamed`'s stderr lines).
- Endings: `; the run is pending` and `; the run is pending: the daemon has not taken the request yet`. With several files: `; N runs are pending: <paths>`.
- A busy store: `Run not asked: <paths>: the store stayed busy; `squeal retry <paths>` asks it.` Nothing is held.
- Class line of an untaken file: `run asked by this wait; the daemon has not queued it yet` (`nextStep` case `asked`).
- JSON: `selection.asked` and `wait.asked`, `[{ project, path, pending, outcome? }]`, one entry per file whose request this wait stored, absent when it stored none (B3 below).

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
- R1 (review 0.1.322): `NamedRunAnswer` gains `{ kind: "changed" }`, and its `asked` answer's `record` is optional (B2: the fact can outlive the record). Not additive, but only `askNamedRuns` reads it. `askNamedRun` takes a third argument, `stillAskable`. `AskedRun.record` is now set only for `queued` and `joined`.
- R1: `src/core/retry/kept.ts` is new: `ASKED_KEYS_META_KEY`, `ASKED_KEYS_KEPT`, `AskedKey`, `Held`, `readAskedKeys`, `isAsked`, `addAskedKey`, `keptAskedKeys`, `keptRetries`, `heldIn`.

## Review 0.1.322 repairs (R1, wave 41.5)

- B1, the check and the write are one transaction: `askNamedRun` takes `stillAskable`, which reads the file's row and states again inside the write's transaction, on every busy retry. A file claimed, queued, current or at a new key since the wait's read gets `changed` and no request. Tests: `test/cli/status-wait-ask-race.test.ts`.
- B3: `selection.asked` and `wait.asked` list only `queued` answers. With only busy refusals both are absent; the `Run not asked:` line stays. Tests: the busy and the mixed cases in `test/cli/status-wait-ask.test.ts`.
- B2, the one-run fact outlives the 1,024 kept requests (design agreed in request c40bf8e3; no new column, 011 C7):
  - A new shared `meta` row, `retries-asked`: a JSON array of `[project, path, key, askedAt]`, oldest first. `askRetry`, `askNoResultRun` and `askNamedRun` add the entry in the transaction that stores the request (`addRequest`). A second ask at the same file and key moves the entry to the end with the new time. `askNamedRun` checks it after the `retries` row's guards; `askableFiles` checks it at the decided read.
  - Each write that adds an entry drops entries asked more than 7 days ago whose file and key no worktree's `test_file_keys` row holds (`heldIn`, one indexed lookup per file and key, read once per write). Past 4,096 entries, lapsed entries go first (held by no worktree, any age), then the oldest. So the cap drops a fact at a live key only when more than 4,096 file-and-key pairs that a worktree's row holds each had a request stored. A lapsed entry dropped at 7 days lets a wait ask once more if a worktree later comes back to that key; D8 drops that key's results at the same age.
  - The `retries` row keeps 1,024 requests: past it, ended requests go first, oldest first, then pending requests at a key no worktree holds, oldest first (`keptRetries`). A pending request at a held key is never dropped, so the row holds more than 1,024 while more than 1,024 such requests are pending. `retry`'s answers and its no-result and counted-failure budgets are unchanged; only what the row drops changed.
  - `askedEnds` reads a request the row no longer keeps as pending, never as ended. This release drops no pending request at a held key, but a released writer still keeps the newest 1,024 whatever they are, and writes no `retries-asked` entry.
  - Tests: `test/retry/asked-keys.test.ts` (an ended and a cancelled request past the limit still stop a second ask; a pending request at a held key survives 1,024 later ended ones; the 7-day rule; both caps through the pure functions; `retry`'s answers) and the last two cases in `test/cli/status-wait-ask.test.ts`. `test/store/worktree-meta.test.ts` lists the new key with the shared ones.

## For the next worker

- C15's "does not change which files run" and 005 D2 need the exception in spec text (coordinator).
- `waitForNamed`'s read callback was at complexity 55 before this row. It is higher now. A split of the decided-read part into its own function would help the next change.
