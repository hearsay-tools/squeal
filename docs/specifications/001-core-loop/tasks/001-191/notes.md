# 001-191 notes: the wait keeps an earlier edit's files the session was told about

## What changed

- `status --wait` asks the daemon for every revision's re-keyed files (`SyncRequest.after = 0`); no daemon change, `Scheduler.rekeyedSince(0, revision)` already answers that. The answer holds at most one entry per test file the daemon re-keyed in its life (`FileState.keyedAt` is the last re-key only).
- `editWindow` (`src/cli/status-wait-edit.ts`) keeps every revision after `lastHeard` as before, and a revision up to it while one of its non-slow files is unseen: no state of the file observed at or after the file's re-key revision at the wait's start, and either pending at the window's read or observed at or after it since (its result landed between the wait's start and the daemon's answer, so its news is the edit's).
- `since` is the earliest kept revision, at most `heard + 1`; with nothing kept, `heard`.

## Why `observedAt` and not `pending`

A file pending again under the same key (`run --all`, 001-171's re-run, a first-observation re-run) has a state observed at or after its re-key, so its revision is seen through and the wait does not hold for that work, as D7 says. A file re-keyed back to a key with a result (an environment revert) is current with an older `observedAt`: not pending, no result since, so it holds nothing. Own results carry their tier's revision, which is never before the re-key that produced their key (a tier selects at a revision only once its runner part is applied); an inherited result's `observedAt` is the revision it was first applied at.

## Behaviour change from 001-186

001-186's test "does not count the revision last heard of when a later one re-keyed a file" (a config edit told at revision 3 whose files are still pending, then an edit at 4) now holds for the config edit's files too: the brief keeps a told revision whose files are still pending. The test is replaced by `test/cli/status-wait-window.test.ts`.

## Tests

`test/cli/status-wait-fixture.ts` holds the shared worktree and daemon fakes; `status-wait-edit.test.ts` keeps 001-186's hold/news cases, `status-wait-window.test.ts` the window's start (001-186) and the told-revision cases (001-191).
