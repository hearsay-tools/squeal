# 001-196 notes: `status --wait` compares keys, keeps its own news, and the skill reads the result

## B1: seen is by key

`FileState.keyedAt` is non-null exactly while a move of the file's key has no result (or `unknown`) at the current key: `Ledger.applyResults` and `markUnknown` clear it only at `file.key`, and `settle` clears it when the key moves back to the result's or the unknown's key. So every file `Scheduler.rekeyedSince` names live has no result under its current key at the answer. The CLI's 001-191 test (no state observed at or after the re-key revision at the wait's start) compared revisions where only the key can tell: a result stored at revision 2 under the previous key, then a growth re-key at revision 2, looked seen. `editWindow` now keeps a told revision whenever the daemon names one of its non-slow files, and drops `unseenRevisions`, `lastObserved` and `WindowReads` (the start and window reads it needed).

What 001-191's comparison was for is the daemon's now: a same-key re-run (`run --all`, 001-171's re-run, a first-observation re-run) follows a result that cleared the attribution, so the file is not named live; a key moved back to its result's key is cleared in `settle`.

## S1: results before the answer

`Ledger.#discharge` records each cleared attribution (`Discharges`, `src/core/scheduler/discharges.ts`): the file's `keyedAt` and `lastKeyedAt` and the time, the last per file only, forgotten when the file is removed. `rekeyedSince(after, upTo, resolvedSince)` adds the files discharged at or after `resolvedSince` as `{ resolved: true }`. The CLI sends the time it read its start view (`SyncRequest.resolvedSince`, through `syncDaemon`, the protocol, handlers, front desk and desk to `Daemon.#requestSync`). In the window a resolved-only file is in `ids` (its transitions are own news, it counts in `testFiles`) and in `EditWindow.resolved`, which `heldPending` skips: its new-failure re-run at the same key does not hold the wait (D7).

Why a time rather than a capture from the request's arrival: a result between the CLI's first read and the daemon receiving the request would be in neither the start view nor the capture. CLI and daemon run on one host and read the same clock. A file discharged in the same millisecond before the start read is over-included, which is harmless: its result is in the start view (no transition), and it is held for nothing.

Discharges never feed `keyedAt`, so 003 wave-4.5 B1 (a growth re-keying completed siblings) is untouched: `environment-growth-siblings.test.ts` and `environment-growth-wait.test.ts` pass.

## Tests

- `test/scheduler/environment-growth-same-revision.test.ts`: B1's probe on the real node:test adapter, two waits at once, the ordinary one and the control whose session was last told revision 1.
- `test/scheduler/resolved-wait.test.ts`: S1's probe on the real Vitest adapter; the sync sequence releases math's failing run and waits for its FAIL before `refined()` and the answer.
- Both fail at 7bf2efef (the base) on Node 24.21.0 and 22.23.3: the B1 wait ended quiet while a's re-run was held; the S1 wait returned quiet, not news.
- `test/scheduler/rekeyed.test.ts`: resolved entries by time; a later move is owed again.
- `test/daemon/sync.test.ts`: `resolvedSince` parsed, passed by the handler and through the desk thread.
- `test/cli/status-wait-window.test.ts`: the fake daemon names what the real one would; the B1 case at the unit level (A observed at revision 2, named at 2).
- `test/harness/skill.test.ts`: the red/green wording, and the Codex skill carrying the same section.

## Not done here

- `plugins/*/dist` is not rebuilt (the brief said not to run `npm run build`): `front-desk.mjs` and the CLI bundles drift until the coordinator rebuilds, so `test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` fail on this branch.
- `spec.md` D7 still says the answer names files "with no result there since"; the `resolved` entries are in `status.md` for the coordinator to fold.
