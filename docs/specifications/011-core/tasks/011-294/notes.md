# 011-294 notes: daemon presence, the writers

Worker 3fa95c94, 2026-11-05. Brief: `tasks/wave-69.md` W1. Design: `research/daemon-presence.md` (decision 2 and the coordinator's calls). Terms: `GLOSSARY.md` (Presence event). Base: main at b9ef6a7e3 (0.1.403).

## The module's new files

| File | What it holds |
|---|---|
| `presence/stored.ts` | The presence meta keys and their stored forms: `daemonExitMetaKey`, `daemonRestMetaKey` (both from `types/daemon.ts`), `stoppedMetaKey`, `StopMark`, `readStop` (from `delivery/stopped.ts`), `handoffMetaKey`, `shortHandoffMetaKey`, `HandoffClaim`, `ShortHandoff`, `handoffFrom`, `readHandoff`, `liveHandoff`, `readShortHandoff`, `SUCCESSOR_LOCK_WAIT_MS`, `HANDOFF_BOUND_MS` (from `delivery/handoff.ts`), `feedDeliveredMetaKey` (from `status/feed-late.ts`), and `RestMark`, `readRest`, `readFeedDelivered` (from `facts.ts`). `WORKTREE_META_ROWS` names `presence/stored` as the owner of all six rows. |
| `presence/events.ts` | The events stored in the store, one function each (table below), and `Registration`, `Registering`, `FEED_STORED_STEP_MS`. |
| `presence/lock-events.ts` | The events stored beside the lock file: `markStart`, `clearStartMark`, `markSpawn` (from `daemon/start-mark.ts`, moved verbatim). |

`daemon/start-mark.ts` and `delivery/handoff.ts` held only re-exports after the move and are deleted. `delivery/stopped.ts` keeps `stopHolds`, `treePrint` and `TREE_PRINT_TIMEOUT_MS`; `status/feed-late.ts` keeps `FEED_LATE_MS` and the late line's text.

## Events

| Event | Function | Stored form | Caller, moment |
|---|---|---|---|
| start marked | `markStart(lockFile, lock)` | `<lock>.starting` = `{"pid":…,"startTime":…}`, by rename | `daemon/open.ts` `takeLock`, right after each lock it takes; its release removes the mark before the lock goes |
| start cleared | `clearStartMark(lockFile)` | removes `.starting` and `.spawned` | `daemon.ts` `#register`, after the registering transaction committed |
| spawned | `markSpawn(lockFile, at, heartbeatAt)` | `<lock>.spawned` = `{"at":…}`; the first spawn since the heartbeat keeps its time | `harness/shared/ensure.ts` `spawnMarked`, after `ensureDaemon` answered `spawned` |
| spawned after a rest | `spawnedAfterRest(store, id, at)` | `daemon-rest:<id>` gains `spawnedAt` | `ensure.ts`, right after `markSpawn` |
| registered | `recordRegistration(store, registration)` | the exit mark deleted (or set to its own incarnation when its shutdown began), the handoff ended (`endHandoff`), `worktrees.upsert` with no daemon, then `setDaemon` | `daemon.ts` `#register`, inside its transaction, between `releaseRunning` and `recordDaemonUsed`, as before |
| handoff ended by a registration | `endHandoff(store, id, registering)` | the claim deleted; the short mark and one note, or the short mark deleted | inside `recordRegistration` |
| beat | `recordHeartbeat(store, id, at)` | `worktrees.heartbeat` | `daemon/lifecycle.ts` `beat`, inside its transaction with the last use |
| exiting | `markExit(store, id, incarnation)` | `daemon-exit:<id>` = the incarnation, only while the row exists | `daemon.ts` `#markExit`, in its own transaction, before the shutdown awaits |
| record cleared | `clearRecord(store, id)` | `setDaemon(id, null)`; the row keeps the last heartbeat | `daemon.ts` `#shutdown`'s `setDaemon` step |
| rested | `markRest(store, id, at)` | `daemon-rest:<id>` = `{"at":…}` | `lifecycle.ts` unused check, before the shutdown |
| the rest overdue | `forgetRest(store, id)` | deletes `daemon-rest:<id>` | `delivery/liveness.ts` `livenessChange`, in its transaction |
| stopped by request | `markStopped(store, id, at, tree, untilStart)` | `daemon-stopped:<id>` = `{"at":…,"tree":…}` (+ `"untilStart":true`) | `cli/stopped-mark.ts` (`squeal stop`); `stopHolds`'s first tree print, in its reread transaction after Git |
| stop over | `clearStopped(store, id)` | deletes `daemon-stopped:<id>` | `cli/stopped-mark.ts` (`squeal start`); `stopHolds` after Git, in its reread transaction |
| handoff claimed | `claimHandoff(store, id, claim)` | `daemon-handoff:<id>` = `{"from","to","at","boundAt"}`, compare and write in one transaction | `ensure.ts` `handOver`, inside its `stillRecorded` transaction; `cli/start.ts` `claims()`, inside the transaction that reads the record and the claim |
| handoff ended | `clearHandoff(store, id)` | deletes `daemon-handoff:<id>` | `daemon/open.ts` `lockWaitTimedOut`, in the note's transaction |
| feed delivered | `FeedDeliveredRow.record(startedAt)` | `feed-delivered:<id>` = the time as a number, every 15 s at most | `daemon-loop/index.ts` |

## Byte-for-byte proof

`test/presence/events.test.ts` holds one case per event, 15 cases, with the stored bytes as literals: each meta row and worktree row read from the database file (`node:sqlite`, read-only) and each mark file read as text. Before any code moved, a throwaway copy of the file imported the old writers (`daemon/start-mark.ts`, `delivery/liveness.ts`, `delivery/stopped.ts`, `delivery/handoff.ts`, `status/feed-late.ts`) and, for the writes that were inline, shims copied from `daemon.ts`, `lifecycle.ts` and `livenessChange` at b9ef6a7e3. Two record literals I had guessed were wrong (the token row holds the start and version too; a cleared record keeps the last start and version); I took them from the old writers. Then all 15 cases passed against the old writers (Squeal revision 4: "no known failures; 1 test file"). The copy was deleted, and the same file passes against presence.

`daemon.ts`'s registration reads the clock twice, as before, in the same order: the handoff's end first, the heartbeat second (object properties are evaluated in source order). A fake clock that counts its calls sees the same calls.

## Done-when grep

Outside `src/core/presence/` (and the registry `types/store.ts`), `src` holds no presence key function, no presence key prefix, no `startMarkFor` or `spawnMarkFor`, no `.starting` or `.spawned` path, and no `worktrees.setDaemon`, `worktrees.heartbeat` or `worktrees.upsert` call outside `src/core/store/`:

```sh
grep -rnE "\b(daemonExitMetaKey|daemonRestMetaKey|stoppedMetaKey|handoffMetaKey|shortHandoffMetaKey|feedDeliveredMetaKey|startMarkFor|spawnMarkFor)\b|\.starting\b|\.spawned\b|\"(daemon-exit|daemon-rest|daemon-stopped|daemon-handoff|daemon-handoff-short|feed-delivered):" src --include=*.ts | grep -v "^src/core/presence/\|^src/core/types/store.ts"
grep -rnE "worktrees\.(setDaemon|heartbeat|upsert)\(" src --include=*.ts | grep -v "^src/core/presence/\|^src/core/store/"
```

The first prints two unrelated lines (`...starting` in `harness/shared/stop.ts:288`, `seen.spawned` in `runners/pytest/adapter.ts:361`); the second prints none.

## Decisions the brief did not settle

1. **Two event files.** The lock-file events sit in `lock-events.ts`, the store events in `events.ts`: the two stored forms differ, and one file would pass 300 lines.
2. **Names.** A moved writer keeps its name (`markStart`, `clearStartMark`, `markSpawn`, `markRest`, `spawnedAfterRest`, `markStopped`, `clearStopped`, `claimHandoff`, `clearHandoff`, `endHandoff`, `FeedDeliveredRow`), so the review reads a move. The new events take names in the same style: `recordRegistration`, `recordHeartbeat`, `markExit`, `clearRecord`, `forgetRest`.
3. **"Spawned" stays two functions.** `markSpawn` (lock mark) and `spawnedAfterRest` (the rest's spawn), called at the same moment as before. The table's rows hold a rest's spawn without a spawn mark and the reverse, which one function could not write.
4. **The record's clear is an event** (`clearRecord`). It is one of `daemon.ts`'s 8 sites (exit delete, exit set, handoff end, upsert, `setDaemon`, start mark clear, `setDaemon(null)`, the exit mark), though the brief's list does not name it.
5. **The exit key moved in the `daemon.ts` commit, not in step 1.** `types/` is a leaf and cannot re-export from presence, and `daemon.ts` is touched in one commit; so the key and its importers moved with it.
6. **Handoff constants move.** `SUCCESSOR_LOCK_WAIT_MS`, `HANDOFF_BOUND_MS` and `handoffFrom` set the claim's stored `boundAt` and `from`; they sit in `stored.ts`. `delivery/handoff.ts` emptied and is deleted.
7. **Parsers sit beside their keys.** `readRest`, `RestMark` and `readFeedDelivered` moved from `facts.ts` to `stored.ts`; the rules `resumesRest` and `restAfterHeartbeats` stay in `facts.ts`. Presence imports nothing from `delivery/` now.
8. **"Pass unchanged" for the handover tests** means the same cases and bodies: `test/harness/handoff*.test.ts`, `test/daemon/handoff-claim.test.ts`, `test/daemon/died*.test.ts` changed only in import lines (`git diff b9ef6a7e3 -- <those files>` shows imports only); `test/version-sensitive.test.ts` did not change. The same holds for the table, I/O and expected-reads tests, except the S1 change below.
9. **The fixture's row and record stay repository writes.** Writing them through `recordRegistration` and `clearRecord` would also keep the last daemon's start and version on a cleared record, a fact today's rows do not hold. The marks and meta rows go through the events. The short handoff is written by a claim and the registration that ends it short, which also writes its note; no view reads that note (presence reads only the note that names the incarnation's exit).
10. **What stays outside presence.** `stopHolds` (the hook's stop decision with Git; its reread after Git stays in its own transaction), `cli/start.ts`'s `claims()` (its read of the claim and `claimHandoff` stay in one transaction), `FEED_LATE_MS` and the late line (a reader rule and wording). `cli/stop.ts` needed no change: it writes the stop through `leaveStoppedMark`, which calls `markStopped`.
11. **Re-exports.** The ones 011-293 left in `delivery/liveness.ts` (readers) stay: the file does not empty. The ones this row added for the move are gone.

## Writers left out, and why

| Writer | Where | Why it stays |
|---|---|---|
| `daemonUsed` | `daemon/last-use.ts` | The brief: leave alone. |
| `daemonToken` | `store/repos/worktrees.ts` | The record's token row; the repository writes it inside `setDaemon`, which `recordRegistration` calls (ADR 0002). |
| `daemonBootstrapped` | `daemon.ts` | The brief: leave alone. |
| `livenessTold`, `revisionTold` | `delivery/liveness.ts` | The brief: leave alone (what a consumer was told). |
| The exit note | `daemon.ts` `#shutdown` (`#note` with the incarnation) | A note, not a presence key; written by the daemon's note path with its log line. Presence reads it. |
| `lockWaitTimedOut`'s note | `daemon/open.ts` | A note; the claim's end in the same transaction is `clearHandoff`. |
| The daemon lock | `daemon/lock.ts` | A lock, not a mark. |

## Review 0.1.403-r3 S1: in-flight run queries in the expected reads

`test/presence/trace.ts` spies on `store.runs.inFlight` and logs `in-flight` at each call. Every changed list differs from the old one only by that token, at two places (checked by a throwaway dump of all 423 traces against the lists, then deleted): a live daemon's header queries its open runs right after its first row read (`openRuns`, row 011-26), so `HEADER_ALIVE` holds it (20 header and told-header lists); a death queries the dead daemon's open runs after the lock probe (status, header and told header of the three death rows, nine lists). A mutation that queried the runs twice in `facts.ts` failed exactly those nine cases; restored.

## Checks

At c09611755: `pnpm run lint` ("Checked 2796 files … No fixes applied") and `pnpm run typecheck` (exit 0) pass; `tsc --noEmit -p .` exits 0. Squeal at revision 59, `squeal status --wait` on every changed `src` and `test` path: "1222 test files, each with a current result", all 1457 test files current, 4 known failures. The four are the bundle drift (`cli/ps.mjs differs from the build`): `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`. `plugins/*/dist` is not this row's, and the brief forbids `pnpm run build`; they pass once the coordinator rebuilds. Squeal does not run `test/e2e/restart-evidence.ts` (an e2e helper; its change is one import line, which the typecheck covers).

## For 011-295 and later

- Writers now report events; a new presence fact gets its key and form in `stored.ts`, its write in `events.ts` or `lock-events.ts`, and its read in `facts.ts`.
- `test/presence/events.test.ts` holds the stored bytes; a form change fails it, and a previous release reads these bytes.
- The reader re-exports in `delivery/liveness.ts` (`daemonLiveness`, `worktreeLiveness`, `DAEMON_START_GRACE_MS`, `resumesRest`, `toldOf`, `ToldLiveness`) still serve many importers; moving them is a reader change.

## R1: repair of review 0.1.404 (B1, S1)

Review: `reviews/0.1.404.md` (FAIL 0c91e7941). Parent's repair request, 2026-11-05: one commit per finding.

### B1: registration reads its clock and layout in the old order

The candidate built `recordRegistration`'s argument before the event ran, so `daemon.ts` read the layout (`linkedWorktreeDir`) and both clock readings before the exit mark, `endHandoff` and `worktrees.upsert`. A pause inside the row's write then stored a heartbeat older than the record. The byte proof above did not catch it: its times were values before the event was called. The sentence "the two clock reads in their old order" in "Byte-for-byte proof" holds for their order to each other only; their place among the writes is fixed here.

The fix (3a5c3cf00): `Registration` carries the daemon's clock (`now`) and a layout reader (`isMain`) in place of the sampled values, and the event reads them where `#register` read them at b9ef6a7e3: the exit mark, the clock as the handoff ends, `endHandoff`, the layout, `worktrees.upsert`, the clock for the heartbeat, `setDaemon`. It builds the record in the old key order. The one transaction, the release of the predecessor's runs before it, and the start and spawn marks' clear after the commit are as before. `daemon.ts` passes `this.#now` and `() => linkedWorktreeDir(root) === null`; what it still evaluates first has no I/O: the incarnation's fields, `#heartbeatMs()` (an option read), `process.argv[1]`, the start time and `existing?.registeredAt`.

Test: `test/presence/registration-order.test.ts` starts a daemon in process (`startDaemon`) over a store whose `openStore` is wrapped: from the registration's `releaseRunning` to its `setDaemon` it logs each presence meta read and write, the layout read and each clock reading, and its `worktrees.upsert` adds 11 s to the daemon's clock (two heartbeat intervals are 10 s). It asserts the old order (`release exit clock claim claim short layout upsert clock setDaemon`), that the second reading is at least 11 s after the first, that the record as stored in the transaction holds the second reading, and that the daemon reads alive at the clock's next reading. Against the candidate's `daemon.ts` and `events.ts` it fails: the order (`release layout clock clock exit …`) and "expected 0 to be greater than or equal to 11000". `test/presence/events.test.ts`'s three registration cases take the new shape with a clock that reads 999, then 1000; their literals are unchanged.

Audit of the other events for an argument evaluated before an I/O step the old code ran first: none. `markExit(store, id, this.#incarnation())` evaluates a string from fields inside the same transaction, before the row read, as a pure value; `recordHeartbeat`, `markRest`, `forgetRest`, `markStopped`, `clearStopped`, `claimHandoff`, `clearHandoff`, `spawnedAfterRest`, `markSpawn`, `markStart`, `clearStartMark`, `clearRecord` and `FeedDeliveredRow.record` get the same expressions their callers passed to the old writers, at the same points.

Type change: `Registration` (new in this row) changed shape: `id`, `root`, `commonDir`, `registeredAt`, `isMain: () => boolean`, `daemon` without `heartbeatAt`, `now: () => EpochMs`, `exiting`. Its only caller is `daemon.ts`.

### S1: the issue-93 probe imports from presence

`docs/specifications/002-codex-adapter/research/probes/issue-93/stop-handover.probe.ts` imports `claimHandoff`, `handoffFrom` and `daemonExitMetaKey` from `src/core/presence/index.js` (0c9f5688a). Import lines only; `run-2026-10-24.txt` is unchanged. The probe was not run (probe isolation). A typecheck of the file alone, with the project's options, exits 0; the same check on the old file fails with TS2307 (`delivery/handoff.js`) and TS2305 (`daemonExitMetaKey`). No other file under `docs`, `evals` or `scripts` imports a name this row moved.

### R1 checks

At 4bdf11cef: `pnpm run lint` ("Checked 2795 files … No fixes applied") and `pnpm run typecheck` (exit 0) pass. Squeal at revision 75, `squeal status --wait` on the changed `src` and `test` paths: "903 test files, each with a current result", all 1458 test files current, 4 known failures, the bundle drift as before (`cli/ps.mjs differs from the build`; `plugins/*/dist` is the coordinator's). One transient failure: `test/daemon/start-spawned.test.ts` "exits 3, still starting, past 30 s while the process lives" found no spawn log line at revision 75 (its stub CLI writes the line once Node started it; the test's clock runs 60 times as fast, and a 33-file tier ran beside it). `squeal retry --reason load` at load 21.66 on 24 CPUs passed at the same inputs; it had 88 passes before.
