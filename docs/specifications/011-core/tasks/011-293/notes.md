# 011-293 notes: daemon presence, the readers

Worker df80c35c, 2026-11-04. Brief: `tasks/wave-68.md` W1. Design: `research/daemon-presence.md` (decisions 1, 3, 4 and the coordinator's calls). Terms: `GLOSSARY.md`.

## The module

`src/core/presence/`:

| File | What it holds |
|---|---|
| `heartbeat.ts` | The one heartbeat rule: `HEARTBEAT_GRACE_INTERVALS`, `DAEMON_START_GRACE_MS`, `heartbeatFresh`, `heartbeatAge`, `heartbeatLateBy`, `heartbeatGraceMs`, `heartbeatGraceEnd`, `beatBetween`, `lastHeartbeat`, `claimLiveness`, `daemonLiveness`, `worktreeLiveness`. |
| `marks.ts` | The reading half of the lock marks (moved from `daemon/start-mark.ts`): `readLockMarks`, `startOf`, `daemonStart`, `startMarked`, `spawnedAt`, `startMarkFor`, `spawnMarkFor`, and the lock probe `lockFree` (was `daemonGone`). |
| `facts.ts` | `readPresenceFacts`: the row and record, the exit row and exit note, the handoff claim, the short handoff, the rest, stop and feed marks, and the lock marks, read once. The lock probe and the dead daemon's open runs are lazy and read at most once. Also `readRest`, `readFeedDelivered`, `resumesRest`. |
| `decide.ts` | `decidePresence` / `readPresence`: each finding decided once (stop, stopping, start, rest, short, late, death, late heartbeat). The hook spawn's views: `spawnStartCurrent`, `stopHeld`. |
| `state.ts` | `presenceState`: the state and notes in decision 3's priority order. |
| `views.ts` | `statusView` (status and its JSON `daemon`), `headerView` (with an optional told start), `newsChange`, `editLineView` (the hook's Not validated line), `withToldStart`, `toldOf`, `stopOf`. |
| `wait.ts` | `waitView`: the wait's decision. The socket check, the dead-socket timer and the second record read stay in `cli/wait-liveness.ts` and enter as inputs. |

Table tests: `test/presence/presence.test.ts` over `rows.ts` and `rows-stop.ts` (each row: stored facts and a clock in; state, notes, status JSON compared as a string, header, told header, news, edit line, hook spawn, heartbeat fresh and late-by out), `wait.test.ts` (stored facts plus the socket answer and dead time in; the wait's reading out), `marks.test.ts`, `stop-of.test.ts`. Fixture: `fixture.ts` writes the facts into a scratch store and lock directory.

## Byte-for-byte proof

Before the readers moved (between steps 1 and 2) a temporary test compared the old stacks with the new views over random stored facts: row or none, record fresh, stale or cleared, with and without token, last heartbeat, exit mark and note, claims (own, other, live, past bound), short mark, rest (quiet, spawned, overdue, before the heartbeat, unreadable), stop (plain before and after the heartbeat, until start), feed (late, on time, before start), start mark (live, dead pid), spawn mark (recent, before the heartbeat, old), lock (no file, free, held), and seven told values. Each case compared `JSON.stringify` of status, header, header with told, edit line, the wait's stopping reading and news, and whether news forgot the rest. 6,000 cases (seed 20261104) and 12,000 cases (seed 7) agreed. The check was not committed, since it imports the deleted stacks. The table keeps one row per state and flag combination it met.

## Decisions the spec did not settle

1. **Views derive from findings, not from the state alone.** The status payload can carry flags no single state expresses (`stopped` with `stopping`, `stopped` with `died`, `resting` with `startingSince` and `stopping`). Decision 4 keeps the payload byte for byte, so each view builds its `DaemonLiveness` from the findings `decidePresence` made once, appending keys in the old order. `presenceState` names the one state and notes from the same findings; no view reads it yet. 011-295 can move views onto it where text allows.
2. **"Last one died" comes with any state.** A death beside a held stop is possible (stale record, free lock, stop after the last heartbeat): state "stopped by request", note "last one died". Decision 3 lists the note with starting or gone only.
3. **The rest's spawn reads as "starting"** in `presenceState`; status still says gone, as before (the status view reads no rest).
4. **The lock probe stays where it was.** `PresenceFacts.lockFree` is lazy. `decidePresence` decides the stopping reading at once, which probes the lock for a shut-down daemon whose heartbeat is down with no mark, as every stopping reader did before (status, header, news, the wait). The death probes only when a view asks (`Presence.died`: status and the header). The two readers that never probed, the hook's stop check and its edit line, read facts without a decision (`stopHeld`, `editLineView(facts, at)`), and the hook's handoff read and `start`'s short handoff read facts only.
5. **The stop mark's key and parser stay in `delivery/stopped.ts`**, beside its writes (`readStop`, `StopMark`, `stoppedMetaKey`). The meta registry (`types/store.ts`) names that file as the key's owner (`test/store/worktree-meta.test.ts`), and key ownership moves in 011-294. Presence imports them; no import cycle.
6. **`delivery/liveness.ts` re-exports** `daemonLiveness`, `worktreeLiveness`, `DAEMON_START_GRACE_MS`, `resumesRest`, `toldOf` and `ToldLiveness` from presence, and `daemon/start-mark.ts` re-exports the mark readers, so their many importers (`daemon.ts`, other CLI and hook files, tests) did not change. Heartbeat-only readers that are not in the row (`cli/code.ts`, `retry-queue.ts`, `status-paths.ts`, `status-wait-paths.ts`, `verdict.ts`, `delivery/hold-told.ts`, `scheduler/retries.ts`, `harness/pi/run.ts`, `harness/shared/prompt.ts`, `daemon/ensure.ts`) reach the module through that re-export.
7. **`stopHolds` takes the held stop mark** (`Presence.stop`) in place of the row and the liveness.
8. **`readFeedDelivered` moved into presence** (`facts.ts`); `feed-late.ts` keeps the key, the writer (`FeedDeliveredRow`) and the wording. Two tests import it from presence now.

## Type changes

All additive except the moves below.

- New in `presence/`: `PresenceFacts`, `RestMark`, `Presence`, `PresenceState`, `PresenceNote`, `RestReading`, `MarkedStart`, `LockMarks`, `WaitInputs`, `WaitReading`, `SocketState`.
- Moved, re-exported from the old place: `DaemonStart` (`daemon/start-mark.ts`), `ToldLiveness` (`delivery/liveness.ts`), `WaitLiveness`, `DownReason` (`cli/wait-liveness.ts`).
- `StopMark` (was the private `StoppedMark` in `delivery/stopped.ts`) is exported.
- Removed: `LockReading` (`status/died.ts`), the private `Rest` (`delivery/liveness.ts`).
- Signature: `stopHolds(store, at, mark: StopMark | null)` (was `(store, at, worktree, live)`).
- `editLineView(facts, at)` reads `PresenceFacts`, not `Presence` (it must not probe the lock).
- `DaemonLiveness` and its parts stay in `types/status.ts`: `types/` is a leaf module and presence imports it; moving them would make `types/` import presence. The status payload type is unchanged.

## Deleted functions

`status/daemon-facts.ts` (file: `withDaemonFacts`, `withLateHeartbeat`); `withDeath`, `shutDown`, `lockOf`, `marksOf`, `marksAt`, `daemonGone` (`status/died.ts`); `withStopping`, `claimed`, `started`, `replaced`, `withShort` (`status/stopping.ts`); `asStopped`, `heldStop`, `startCurrent`, `withoutStop` (moved), `stopOf` (moved), `readMark` (now `readStop`) (`delivery/stopped.ts`); `asRested`, `asTold` (now `withToldStart`), `restState`, `restAfterHeartbeats` and `readRest` (moved) (`delivery/liveness.ts`); `withLate` (`status/feed-late.ts`); the private `liveness` and `HEARTBEAT_GRACE_INTERVALS` (`status/snapshot.ts`); the private `startCurrent`, `steppingDown`'s store reads (`harness/shared/ensure.ts`); `replacing` and the judge's rules (`cli/wait-liveness.ts`).

## Done-when grep

`grep -rn "heartbeatAt\|HEARTBEAT_GRACE_INTERVALS" src` outside `src/core/presence/` and the presence meta key and lock mark readers outside it leave only these:

| Where | Why it stays |
|---|---|
| `daemon/daemon.ts` (record, exit row, `readDaemonNotes`), `daemon/start-mark.ts` (`markSpawn`), `delivery/liveness.ts` (`markRest`, `spawnedAfterRest`, the overdue rest's delete), `delivery/handoff.ts`, `delivery/stopped.ts` (key, `readStop`, writes), `status/feed-late.ts` (key, writer) | Writers, 011-294. `spawnedAfterRest` reads the rest through presence's `readRest`. |
| `store/repos/worktrees.ts`, `types/store-records.ts`, `ps/work.ts:319` | The store repository and ps's own row reader, which build `DaemonRecord`. |
| `cli/start.ts` `claims()` | Reads the claim in a write transaction before `claimHandoff`: the claim's write, 011-294. |
| `cli/stop-removed.ts:129` | Prints the record's last heartbeat time ("last at …"); its freshness check is presence's. |
| `cli/stop.ts` `lockFreed`/`probeLock` | `squeal stop` probes the lock in its own loop with its own outcomes (free, held, unchecked with the error); its mark reading is presence's `daemonStart`. |
| `status/status-detail.ts:87` | Renders "last heartbeat Ns ago" from the status view's `lastHeartbeatAt`. |
| `readDaemonNotes` in `daemon/policy.ts`, `scheduler/notes.ts`, `status/snapshot.ts` | Read notes by text or topic for other purposes; the exit note presence reads is the one naming the incarnation. |
| `scheduler/claims.ts` | Asks the store's claim query with presence's `claimLiveness`. |

## Readers moved

`delivery/liveness.ts`, `status/daemon-facts.ts` (deleted), `status/died.ts`, `status/stopping.ts`, `delivery/stopped.ts`, `status/snapshot.ts`, `cli/wait-liveness.ts`, `harness/shared/ensure.ts`, `harness/shared/deliver.ts` (the edit line), `cli/start.ts` (short handoff), `ps/discover.ts`, `ps/flags.ts` (serving, hung, the exit rules' grace, the two-sample beat), `status/open-runs.ts`, `scheduler/claims.ts`, `cli/stop.ts`, `cli/stop-removed.ts`, `daemon/start-mark.ts` (read half). Renderers `delivery/format.ts`, `delivery/header.ts`, `status/outstanding-text.ts`, `status/status-detail.ts` import `stopOf` from presence.

## Deleted tests, mapped to table rows

`test/cli/start-readers.test.ts`:

| Case | Now |
|---|---|
| "a hook's spawn mark" (6 cases) | Moved unchanged to `test/presence/marks.test.ts`. |
| a wait: spawn mark is a start, past its grace a stopped daemon | wait rows "a cleared record with a spawn mark older than the last heartbeat…", "…past its grace". |
| a wait, named and pathless, says a hook started one | wait rows above; the text: `test/evals/no-verdict-evidence.test.ts` (`SPAWNED_TEXT`, "so the wait went on"). |
| plain status with either mark: Outstanding line, named status, JSON adds only `startingSince` and `startMark` | rows "a daemon that marks its start, its record cleared", "a hook's spawn, its record cleared" (JSON as a string); text: `wait-locked.test.ts` (`LOCKED_TEXT`), `no-verdict-evidence.test.ts` (`SPAWNED_TEXT`), `harness/until-start-spawn.test.ts` (`--full`). |
| spawn mark past its grace names `squeal start` | row "a cleared record, nothing else"; wait row "…past its grace". |
| stale record, lock held, no mark: busy, not a start | row "a late heartbeat, its lock held"; text: `harness/late-heartbeat.test.ts`, `status/outstanding.test.ts`. |
| stale record, another's start marked: a start, no death | row "a start marked in place of a stale record". |
| stale record, spawn mark only: no start, no death, header alike | row "a spawn mark beside a stale record, its lock held". |
| the hooks' header with either mark | the two start rows (header = status); text: `harness/starting-daemon.test.ts`, `harness/stopped.test.ts`. |

`test/cli/until-start-readers.test.ts`: the 12 cases (each stop × cleared or stale record × no mark, spawn mark or start mark) are `rows-stop.ts` (`besideEitherStop`, both stops) with the moved rows "a stop by request" and "a stop until start", and the wait rows "a cleared record with no mark", "a cleared record with a spawn mark…", "a cleared record while a daemon marks its start", "a stale record whose socket has not answered", "a stale record with a hook's spawn mark only", "a stale record while another daemon marks its start". Stop wording: `cli/stop-mark.test.ts`, `harness/stopped-until-start.test.ts`. The `stopOf` cases moved to `test/presence/stop-of.test.ts`.

`test/status/stopping.test.ts`:

| Case | Row |
|---|---|
| after it cleared its record, a live claim and a held lock read handing over; past the bound plain down | "a live claim after the old daemon cleared its record", "a claim past its bound after the old daemon cleared its record" |
| after it cleared its record and let go of its lock, a live claim reads handing over | "a live claim after the old daemon cleared its record" (no lock is read with the record cleared; header = status). Its wording stays in the kept "with a handoff claim" and "past the claim's bound" cases. |
| after it cleared its record, plain down with a free lock and no live claim | "a cleared record, nothing else", "a claim past its bound…" |
| plain down once its lock is free | "a shutdown whose lock is free" |
| another incarnation's mark: a late heartbeat | "another incarnation's exit mark, its lock held" |

`test/delivery/liveness.test.ts` "daemonLiveness is alive up to two heartbeat intervals": rows "a heartbeat at the end of its grace" (alive at exactly two intervals), "a late heartbeat, its lock held", "a worktree with no row", and the heartbeat columns of every row.

`test/cli/handoff-wait.test.ts` "goes on until the claim's bound, as status reads it": wait rows "a handoff before its bound", "a handoff at its claim's bound".

Kept: the wording cases of `stopping.test.ts`, `status/died.test.ts` (wording only), `daemon/died*.test.ts` (real SIGKILL), the delivery cases of `liveness.test.ts`, the socket case and CLI waits of `handoff-wait.test.ts`, and `harness/handoff*.test.ts`, `daemon/handoff-claim.test.ts` (hook decisions and the claim's writes: no cross-reader case).

Test that followed a move: `test/cli/wait-mixed-read.test.ts` mocks `presence/marks.js` `readLockMarks` in place of `start-mark.js` `daemonStart` to inject its registration between reads.

## Checks

At 5bbd4cc9e: `pnpm run lint` and `pnpm run typecheck` pass. Squeal at revision 71: all 1,453 test files current, 12,694 affected checks passed, 25 skipped, 4 known failures (the bundle drift below). A `runner-part-bound.test.ts` failure at revision 49 passed on its next run (host load).

## Not done here

- Comments in `daemon/daemon.ts:1111` and `types/daemon.ts:531` still name `withDeath`; both files are 011-294's (leave alone).
- `plugins/*/dist` is not rebuilt (the brief: not mine; no `pnpm run build`). Four bundle checks fail on drift (`cli/ps.mjs differs from the build`) until the coordinator rebuilds: `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`.

## For 011-294 and 011-295

- Writers to move (011-294): `daemon/daemon.ts` (record, exit row, exit note), `daemon/start-mark.ts` (`markStart`, `clearStartMark`, `markSpawn`), `delivery/liveness.ts` (`markRest`, `spawnedAfterRest`, the overdue rest's delete in `livenessChange`), `delivery/stopped.ts` and `cli/stopped-mark.ts` (stop mark; `readStop` and the key move with them), `delivery/handoff.ts` (claim, short mark; `readHandoff`, `readShortHandoff`, `liveHandoff` move with them), `status/feed-late.ts` (`FeedDeliveredRow`). `facts.ts` is where their reads land.
- The views keep the old key order on purpose (decision 4). `presenceState` is ready for views that may change text (011-295). The heartbeat-only readers listed in decision 6 above are the next candidates to take a named view.
- The news view (`newsChange`) reads no death, late heartbeat or late feed; 011-295 changes that.
