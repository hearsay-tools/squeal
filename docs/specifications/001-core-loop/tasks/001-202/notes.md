# 001-202 notes: a later discharge never erases an earlier wait's own news

## S1 (review wave 13l): discharges per file and revision

`Discharges` (`src/core/scheduler/discharges.ts`) kept one entry per file, so a second move discharged before a wait's sync answer, by an ordinary cache hit in content reconciliation, replaced the first; `since(resolvedSince, after, upTo)` then filtered the replacement out as beyond the captured revision, and the wait ended quiet with the edit's failure counted as another check's. It now keeps one entry per (file, revision), each with its discharge time, in discharge order (a re-discharge of the same pair moves to the end). `since` names every entry discharged at or after `resolvedSince` inside `(after, upTo]`, so a file can be named at both its earlier and later revision, as the live `keyedAt`/`lastKeyedAt` pair already could.

Bounds: entries older than `DISCHARGE_RETENTION_MS` (one hour) are dropped at the next `note`, and at most `DISCHARGE_CAP` (10,000) are kept, the oldest first. An entry discharged at `t` is needed only by a wait that started at or before `t` and still awaits its answer; that wait gives up at its own timeout, so the retention must exceed the longest wait anyone runs. `forget` still drops a removed file's entries. Nothing feeds `keyedAt`, so 003 wave-4.5 B1 stays untouched.

No caller changed: `Ledger.#discharge` and `Scheduler.rekeyedSince` call the same `note`/`since`.

## Tests

- `test/scheduler/later-discharge-wait.test.ts`: the reviewer's exact sequence on the real Vitest adapter (cache warmed at revisions 1 and 2, math broken and held at 3, strings' `invalidate` held at 4, the daemon's capture/`refined()`/`rekeyedSince` sync, math's FAIL, then at 5 the cached failing bytes), and its control without revision 5. Without the fix the cached case returns `quiet` on Node 24.21.0 and 22.23.3; the control passes either way.
- `test/scheduler/discharges.test.ts`: an earlier revision survives a later discharge; age and `forget` drop entries; 1,000 notes over 300 files stay at the cap.

## Decisions the brief left open

- The retention is a fixed hour rather than tracking each outstanding sync request: a request can still be on the wire when its file is discharged, and the daemon does not know about it yet. A sync answered more than an hour after a discharge could again miss it. Waits that long are outside today's use (the skills cap waits at 10 minutes).
- Waits never end when the control's news arrives while strings is still pending, so the test does not assert `pending`.

## Not done here

- `plugins/*/dist` is not rebuilt (the brief said not to run `npm run build`); the bundles drift until the coordinator rebuilds and versions them.
