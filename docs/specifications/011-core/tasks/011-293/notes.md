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

## R1: repair of review 0.1.403 (B1, B2)

Review: `reviews/0.1.403.md` (FAIL a5152c810). Parent's repair request, 2026-11-04.

### B1: a fresh heartbeat holds no stop

`heldStop` (now in `presence/findings.ts`) returned the stop mark beside a fresh heartbeat, so the hook's `ensure` returned `stopped` where it ensured the daemon before the move. It returns `null` for a fresh heartbeat again, before it reads the mark, as `delivery/stopped.ts` did. The status, header and news views were not affected: they apply a stop only while the heartbeat is down.

Tests: every table row now states the hook's stop explicitly (`Row.heldStop`, default none), and the table checks both `stopHeld(facts, at)` and `Presence.stop` against it. New rows: a fresh heartbeat beside each stop (`squeal stop` and `--until-start`), the mark written before and after the heartbeat (four rows, `rows-stop.ts`). `test/presence/hook-stop.test.ts` drives `ensure()` with an injected `ensureDaemon` through the review's reproduction: each of the four cases returns `alive` with one `ensureDaemon` call; a stale heartbeat beside `--until-start` still returns `stopped` with none. Against the old `heldStop` the 8 new checks fail.

### B2: each reader reads what it read before

Decision 4 above is superseded: the facts and the decisions are lazy now, not only the lock probe.

- `PresenceFacts` holds a once-only reader per fact (`row`, `shutDown`, `exitNoteAt`, `claim`, `short`, `rest`, `stop`, `feedDelivered`, `marks`, `lockFree`, `inFlight`). `readPresenceFacts` reads nothing itself; the row is read at its first use when the caller gave none. `shutDown` reads the exit row first and the notes only when the exit row does not name the daemon, as `shutDown` in `died.ts` did.
- `LockMarks` reads each mark file at its first call: `startOf` and `daemonStart` stop at a live start mark and never read `.spawned` then.
- `decidePresence` returns memoized getters: each decision is made at its first use and reads only its rule's facts. The rules moved to `presence/findings.ts` (`decide.ts` keeps the types and the decision); `presence/once.ts` holds the shared once-only helper.
- The narrow readers are named functions in `presence/narrow.ts`, and their callers call them: `readHookStop` (`ensure`), `readEditLine` (`deliver.ts`), `readHookHandoff` (`ensure`'s `handOver`, in its read transaction), `readShortHandoffOf` (`start`'s `shortOf`), `readStopping` (`wait-liveness.ts`'s `stoppingOf`). The handoff rule (short mark, live claim, a step-down taken) moved with `readHookHandoff`.

Reads per path, `test/presence/io.test.ts` (one ordered log of presence meta keys, `.starting`/`.spawned` file reads and lock probes; with eager facts 12 of its 13 checks fail):

| Path | Case | Before the move | Now |
|---|---|---|---|
| Edit line | fresh heartbeat | none | none |
| Edit line | stale, no shutdown | exit, notes | exit, notes |
| Edit line | stale, exit row names it | exit | exit |
| Hook stop | fresh heartbeat, stop mark | none | none |
| Hook stop | stale | stop | stop |
| Hook handoff | fresh | short, claim | short, claim |
| Hook handoff | stale, no shutdown | short, claim, exit, notes, claim | short, claim, exit, notes |
| Hook handoff | short mark names it | short | short |
| `start` short handoff | any | short | short (no row read) |
| Wait stopping | record cleared, live claim | claim | claim |
| Wait stopping | record cleared, no claim | claim, .starting, .spawned | claim |
| Wait stopping | stale, no shutdown | exit, notes, .starting, .spawned | exit, notes |
| Wait stopping | shutdown begun, lock held, no mark | exit, .starting, .spawned, probe, notes, claim | the same |
| `daemonStart` | live start mark | .starting | .starting |
| `daemonStart` | no mark | .starting, .spawned | .starting, .spawned |

No path reads a fact it did not read before, and the order of the remaining reads is the old order. Three paths read less: the hook handoff reads the claim once where it read it twice in one read transaction, and the wait's stopping read no longer reads the marks the old `started` and `replaced` layers read for findings the stopping reading never used (the wait reads the marks itself afterwards, as before). The edit line and the hook stop check probe no lock and read no mark file.

The broad views (status and JSON, header, news) read lazily too; their outputs are unchanged: the table's JSON string comparisons pass on all 47 rows (the 43 the review compared, plus the four B1 rows).

### R1 checks

At 222b04cfe: `pnpm run lint` and `pnpm run typecheck` pass. 27 presence, hook, wait and stop test files run directly: 247 tests pass. Squeal at revision 94, `squeal status --wait 60000` on the changed `src` and `test` paths: 901 selected test files, each current; 4 known failures, the same bundle drift as before (`plugin.test.ts`, `codex/packaging/runtime.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`); all 1,455 test files current.

## R2: repair of review 0.1.403-r2 (B2)

Review: `reviews/0.1.403-r2.md` (FAIL 7f2ed2a59, B2 only; B1 resolved). The human approved this round, 2026-11-05; the parent's repair request names the two fixes and the expected-reads column.

### The fix

- `decide.ts`: the stopped decision checks a current start first and reads the stop mark only when none settles it, as `asStopped` did. The hook's stop check keeps its own rule (`stopHeld`: a fresh heartbeat reads nothing, else the stop mark).
- `views.ts`: news asks for stopping, start and the marks only after the told-start guard lets it, in the old layers' order: with the record cleared the claim, then the marks; with a record its shutdown, then the marks (or, once its shutdown began, the start, the lock, the exit note and the claim). `withRecordFacts` (status, header) follows the old order too: with the record cleared the claim, then the start; with a record its shutdown, then the start, then its death or its stopping. Neither destructures the lazy getters any more; `withStart` adds the start.
- Audit of the other views: `aliveView` asks stopping, then the short handoff, then the late feed, as the old layers did; `withStop`, `withRest`, `withLateHeartbeat`, `withToldStart` and `editLineView` read in order and only behind their guards. `presenceState` (`state.ts`) reads every finding; no reader calls it yet (decision 1), and 011-295 must check its reads before a view uses it.

### The expected-reads column

`test/presence/reads.test.ts` traces each of the 47 table rows through nine views, each as its production caller runs it (`trace.ts`):

| View | The expression |
|---|---|
| status | the snapshot's: the row, then `statusView(readPresence(…, row))` |
| header | `readLiveHeader(…).daemon` |
| told header | `withTold(readLiveHeader(…), told, now).daemon` |
| news | `livenessChange` in a transaction, the row's told value stored first |
| edit line | `readEditLine` (the row, then the shutdown) |
| hook stop | `readHookStop`, the row read before |
| hook handoff | `readHookHandoff`, the row read before |
| start short handoff | `readShortHandoffOf` |
| wait stopping | `readStopping`, the row read before |

The log holds each meta key (presence keys by name: `exit`, `notes`, `claim`, `short`, `rest`, `stop`, `feed`, `told`; others without the worktree id), each worktree row read (`row`), each `.starting` and `.spawned` file read, and each lock probe (`probe`). The header's reads before the daemon's (the header's rows and the holds) are three constants in `trace.ts`. The expected lists are literals in `reads-rows.ts` and `reads-stop.ts`.

How the lists were made: a throwaway probe in a private `/tmp` directory, outside the repo, over `git archive 4204b3d47 src package.json test/status/helpers.ts test/store/helpers.ts` with copies of the table's fixture and rows. It ran the old expressions (status: `withDaemonFacts(asStopped(raw))`; header and told header: the old `readLiveHeader`, `withTold`; news: the old `livenessChange`; edit line: `withLateHeartbeat`; hook stop: `heldStop`; hook handoff: the old `handOver` read, its body copied; short handoff: `readShortHandoff`; wait: the old `stoppingOf`) over scratch stores with the same facts, with the same spies. 423 traces. Against the new code: 242 identical, 181 reading less, none adding or moving a read, and no value differing. The probe was deleted; only the lists are committed. Reverting the stopped order fails 141 of the column's cases; destructuring `start` and `marks` before news's told-start guard fails exactly the three told-start rows the review names.

### Where the new code reads less

181 cases. All but the wait's drop only a repeat of a read made earlier in the same view (`again`): the old layers each read their facts again, and presence reads each fact once. The wait's stopping read also drops reads the old `started`, `replaced` and `withShort` layers made for findings the stopping reading never used (R1); the wait reads the marks itself afterwards, as before. The hook handoff's repeat claim read is R1's too.

- **waitStopping**, drops `short`: "a fresh heartbeat"; "a heartbeat at the end of its grace"; "a daemon that ended its handoff short, told once"; "a short handoff already told"; "a late change feed, which is no news"; "a stop by request written before a fresh heartbeat"; "a stop by request written after a fresh heartbeat"; "a stop until start written before a fresh heartbeat"; "a stop until start written after a fresh heartbeat".
- **status**, drops `again notes`: "a fresh heartbeat whose shutdown began".
- **header**, drops `again notes`: "a fresh heartbeat whose shutdown began".
- **toldHeader**, drops `again notes`: "a fresh heartbeat whose shutdown began".
- **news**, drops `again notes`: "a fresh heartbeat whose shutdown began".
- **waitStopping**, drops `again notes`: "a fresh heartbeat whose shutdown began"; "a stale heartbeat handing over, its lock held".
- **status**, drops `again exit again notes again .starting again .spawned again notes again exit again notes`: "a stale heartbeat handing over, its lock held".
- **header**, drops `again exit again notes again .starting again .spawned again notes again exit again notes`: "a stale heartbeat handing over, its lock held".
- **toldHeader**, drops `again exit again notes again .starting again .spawned again notes again exit again notes`: "a stale heartbeat handing over, its lock held".
- **news**, drops `again .starting again .spawned again notes`: "a stale heartbeat handing over, its lock held".
- **status**, drops `again exit again .starting again .spawned again exit`: "a stop past its bound"; "a shutdown whose lock is free".
- **header**, drops `again exit again .starting again .spawned again exit`: "a stop past its bound"; "a shutdown whose lock is free".
- **toldHeader**, drops `again exit again .starting again .spawned again exit`: "a stop past its bound"; "a shutdown whose lock is free".
- **news**, drops `again .starting again .spawned`: "a stop past its bound"; "a claim past its bound after the old daemon cleared its record"; "another incarnation's exit mark, its lock held"; "a shutdown whose lock is free"; "a hook's spawn, its record cleared"; "a spawn mark beside a stale record, its lock held"; "a rest, which status says as no daemon"; "a rest with its hook's spawn after it"; "a rest whose spawn is overdue, forgotten by news"; "a rest beside a spawn mark"; "a late heartbeat, its lock held"; "a death: a stale record, no shutdown, its lock free"; "a cleared record, nothing else"; "a told start past its grace"; "a stop a later heartbeat voided"; "a death while a stop holds"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop by request beside a hook's spawn, its record cleared"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only"; "a stop until start beside a hook's spawn, its record cleared".
- **status**, drops `again .starting again .spawned`: "a claim past its bound after the old daemon cleared its record"; "a hook's spawn, its record cleared"; "a rest, which status says as no daemon"; "a rest with its hook's spawn after it"; "a rest whose spawn is overdue, forgotten by news"; "a rest beside a spawn mark"; "a cleared record, nothing else"; "a start the consumer was told of"; "a told start past its grace"; "a stop a later heartbeat voided"; "a stop by request beside a hook's spawn, its record cleared"; "a stop until start beside a hook's spawn, its record cleared".
- **header**, drops `again .starting again .spawned`: "a claim past its bound after the old daemon cleared its record"; "a hook's spawn, its record cleared"; "a rest whose spawn is overdue, forgotten by news"; "a cleared record, nothing else"; "a start the consumer was told of"; "a told start past its grace"; "a stop a later heartbeat voided"; "a stop by request beside a hook's spawn, its record cleared"; "a stop until start beside a hook's spawn, its record cleared".
- **toldHeader**, drops `again .starting again .spawned`: "a claim past its bound after the old daemon cleared its record"; "a hook's spawn, its record cleared"; "a rest whose spawn is overdue, forgotten by news"; "a cleared record, nothing else"; "a start the consumer was told of"; "a told start past its grace"; "a stop a later heartbeat voided"; "a stop by request beside a hook's spawn, its record cleared"; "a stop until start beside a hook's spawn, its record cleared".
- **waitStopping**, drops `.starting .spawned`: "a claim past its bound after the old daemon cleared its record"; "another incarnation's exit mark, its lock held"; "a hook's spawn, its record cleared"; "a spawn mark beside a stale record, its lock held"; "a rest, which status says as no daemon"; "a rest with its hook's spawn after it"; "a rest whose spawn is overdue, forgotten by news"; "a rest beside a spawn mark"; "a late heartbeat, its lock held"; "a death: a stale record, no shutdown, its lock free"; "a cleared record, nothing else"; "a start the consumer was told of"; "a told start past its grace"; "a told start beside a death, whose late heartbeat it hides"; "a stop by request"; "a stop until start"; "a stop a later heartbeat voided"; "a death while a stop holds"; "a told start over a stop"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop by request beside a hook's spawn, its record cleared"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only"; "a stop until start beside a hook's spawn, its record cleared".
- **status**, drops `again .starting again .spawned again exit again notes again .starting again .spawned again exit again notes`: "another incarnation's exit mark, its lock held"; "a spawn mark beside a stale record, its lock held"; "a late heartbeat, its lock held"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only".
- **header**, drops `again .starting again .spawned again exit again notes again .starting again .spawned again exit again notes`: "another incarnation's exit mark, its lock held"; "a spawn mark beside a stale record, its lock held"; "a late heartbeat, its lock held"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only".
- **toldHeader**, drops `again .starting again .spawned again exit again notes again .starting again .spawned again exit again notes`: "another incarnation's exit mark, its lock held"; "a spawn mark beside a stale record, its lock held"; "a late heartbeat, its lock held"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only".
- **hookHandoff**, drops `again claim`: "another incarnation's exit mark, its lock held"; "a start marked in place of a stale record"; "a spawn mark beside a stale record, its lock held"; "a late heartbeat, its lock held"; "a death: a stale record, no shutdown, its lock free"; "a told start beside a death, whose late heartbeat it hides"; "a death while a stop holds"; "a stop by request beside a stale record"; "a stop by request beside a stale record and a hook's spawn mark only"; "a stop by request beside a start marked in place of a stale record"; "a stop until start beside a stale record"; "a stop until start beside a stale record and a hook's spawn mark only"; "a stop until start beside a start marked in place of a stale record".
- **status**, drops `again .starting`: "a daemon that marks its start, its record cleared"; "a stop by request beside a daemon that marks its start, its record cleared"; "a stop until start beside a daemon that marks its start, its record cleared".
- **header**, drops `again .starting`: "a daemon that marks its start, its record cleared"; "a stop by request beside a daemon that marks its start, its record cleared"; "a stop until start beside a daemon that marks its start, its record cleared".
- **toldHeader**, drops `again .starting`: "a daemon that marks its start, its record cleared"; "a stop by request beside a daemon that marks its start, its record cleared"; "a stop until start beside a daemon that marks its start, its record cleared".
- **news**, drops `again .starting`: "a daemon that marks its start, its record cleared"; "a start marked in place of a stale record"; "a stop by request beside a start marked in place of a stale record"; "a stop by request beside a daemon that marks its start, its record cleared"; "a stop until start beside a start marked in place of a stale record"; "a stop until start beside a daemon that marks its start, its record cleared".
- **waitStopping**, drops `.starting`: "a daemon that marks its start, its record cleared"; "a start marked in place of a stale record"; "a stop by request beside a start marked in place of a stale record"; "a stop by request beside a daemon that marks its start, its record cleared"; "a stop until start beside a start marked in place of a stale record"; "a stop until start beside a daemon that marks its start, its record cleared".
- **status**, drops `again .starting again exit again notes again exit again notes`: "a start marked in place of a stale record"; "a stop by request beside a start marked in place of a stale record"; "a stop until start beside a start marked in place of a stale record".
- **header**, drops `again .starting again exit again notes again exit again notes`: "a start marked in place of a stale record"; "a stop by request beside a start marked in place of a stale record"; "a stop until start beside a start marked in place of a stale record".
- **toldHeader**, drops `again .starting again exit again notes again exit again notes`: "a start marked in place of a stale record"; "a stop by request beside a start marked in place of a stale record"; "a stop until start beside a start marked in place of a stale record".
- **header**, drops `again rest again .starting again .spawned`: "a rest, which status says as no daemon"; "a rest beside a spawn mark".
- **toldHeader**, drops `again rest again .starting again .spawned`: "a rest, which status says as no daemon"; "a rest beside a spawn mark".
- **header**, drops `again rest`: "a rest with its hook's spawn after it".
- **toldHeader**, drops `again rest`: "a rest with its hook's spawn after it".
- **status**, drops `again .starting again .spawned again exit again notes again exit again notes`: "a death: a stale record, no shutdown, its lock free"; "a told start beside a death, whose late heartbeat it hides"; "a death while a stop holds".
- **header**, drops `again .starting again .spawned again exit again notes again exit again notes`: "a death: a stale record, no shutdown, its lock free"; "a told start beside a death, whose late heartbeat it hides"; "a death while a stop holds".
- **toldHeader**, drops `again .starting again .spawned again exit again notes again exit again notes`: "a death: a stale record, no shutdown, its lock free"; "a told start beside a death, whose late heartbeat it hides"; "a death while a stop holds".

### R2 checks

At 6196caec7: `pnpm run lint` and `pnpm run typecheck` pass. `test/presence` run directly: 7 files, 517 tests pass (the reads column 424 of them). 21 other reader files run directly (hooks, handoff, waits, stopping, liveness, news, `no-verdict-evidence`): 200 tests pass. Squeal at revision 112, `squeal status --wait 60000` on the changed `src` and `test` paths: 900 selected test files, each current; 4 known failures, the same bundle drift as before; all 1,456 test files current.
