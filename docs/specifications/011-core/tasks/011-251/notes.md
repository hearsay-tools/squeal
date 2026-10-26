# 011-251 notes: every reader tells a starting daemon from a stopped one

Row 011-251 (gh-1 follow-up; `tasks/wave-53.md` W1; 011 C9 and C15 as amended 2026-10-26; `tasks/011-250/notes.md` F1, F2, F4; `reviews/0.1.350-r2.md` N2). Worker run `1e3c5576`, 2026-10-26.

## What a reader reads now

Two marks beside the worktree's daemon lock file:

- The start mark (`<lock file>.starting`, row 011-250): a daemon holds the lock and has not registered yet. Its pid and process start time; read by process identity, never by time.
- The spawn mark (`<lock file>.spawned`, new): JSON `{ "at" }`, written by rename by the hook that spawned a daemon, after `ensureDaemon` answered `spawned` (plain spawn and handoff successor). A first spawn makes the locks directory. Read for `DAEMON_START_GRACE_MS` (10 s) of `at`. Never written over the start mark: it is a file of its own.

`daemonStart(lockFile, now, heartbeatAt)` (`src/core/daemon/start-mark.ts`) reads both: `locked` with the pid while a start mark names a live process; else `spawned` while a spawn mark is within the grace and after `heartbeatAt`; else `null`. It takes no lock and never throws.

Lifecycle of the spawn mark:

- The registration (`#register` → `clearStartMark`) removes both marks. A lock release (`markStart`'s wrapper) removes only the start mark: a hook may have spawned that daemon's successor.
- The first spawn since the last heartbeat keeps its time (`markSpawn` writes nothing while a mark exists, its `at` is not later than the new spawn and no heartbeat came after it), as `spawnedAfterRest` keeps a rest's first spawn. So a daemon whose starts keep failing reads as stopped once the grace of the first spawn passed, however many boundaries spawn again.
- A reader that knows the last heartbeat reads a spawn mark at or before it as none, as `asTold` ends a told start at a heartbeat: status and headers (`withStopping`, `withDeath`) read the row's last heartbeat; `squeal stop` the stopping daemon's start time.

| Reader | Cleared record, start mark | Cleared record, spawn mark only | Stale record, start mark | Stale record, spawn mark only |
| --- | --- | --- | --- | --- |
| Wait (`judge`) | `lapsed`, `locked` | `lapsed`, `locked` | socket check, as before | socket check, as before |
| Status, headers (`withDaemonFacts`) | `startingSince`, `startMark: "start"` | `startingSince`, `startMark: "spawn"` | `startingSince`, `startMark: "start"`, no death, no probe | no death, no probe, no start (a busy daemon may hold the lock) |
| Hooks' news (`livenessChange`) | none | none within the grace | none (review 0.1.355 B1) | as before: no daemon is validating |
| `squeal stop` lock wait | free (another process holds the lock) unless the mark names the stopping daemon | held, not probed | same | same |

With neither mark, every reader reads as before 011-251.

## F1: a wait right after a hook's spawn

`watchDaemon.judge` (`src/cli/wait-liveness.ts`) reads a cleared record with either mark as `lapsed` with `locked`, and the wait goes on. The wait does not know the last heartbeat, so it reads a spawn mark for its full grace. A new daemon removes the mark when it registers; only a daemon older than 011-251 that registers and stops within the grace leaves a wait going on to the end of the grace.

## N2: the mixed read

Before `judge` says `stopped` from a cleared record and no mark, it reads the record once more on a connection of its own (`freshRecord`: `openStore(commonDir, { create: false, busyTimeoutMs: 100 })`, one `worktrees.get`, close). The poll's read transaction may have begun before the registration that removed the mark. A record found: `lapsed` with `locked`, and the next poll reads it. A store that does not open or a read that fails proves nothing: `stopped`, as the poll's own read says. At most one such read a poll, only in that state. No lock is taken. Both waits pass `commonDir` (the coordinator, D).

## F2: plain status, the named snapshot, `squeal start` and the hooks

`withStopping`'s cleared-record branch (`started`, `src/core/status/stopping.ts`) adds `startingSince` and `startMark` while a mark is live and no handoff claim or stop request holds. Status, `squeal start`'s printed status and every header read `withDaemonFacts`, so:

- The `Outstanding:` no-daemon line and the named no-daemon line end with the start's text in place of `` `squeal start` starts one`` (`startText`, `src/core/status/outstanding-text.ts`).
- The wait endings take the text from the last read's snapshot (`lockedText`): the pathless ending and the named timeout clause (`src/cli/no-verdict-lines.ts`).
- `squeal status --full`'s `Daemon:` line adds `; a daemon is starting`.
- The hooks' header says `A daemon is starting; results are as of revision N.` (`livenessSentence`, unchanged), and `livenessChange` gives no news while it starts.

Texts (approved by the coordinator, requests `a2488c17` and `c51f8f9f`):

- start mark: `a daemon holds this worktree's lock but does not serve yet: it is starting or stopping` (`LOCKED_TEXT`, row 011-250)
- spawn mark only: `a hook started a daemon that does not serve yet: it is starting` (`SPAWNED_TEXT`)

Rendered, the fixture at revision 4 with the record cleared:

```text
Outstanding:
  no daemon has validated since 2026-10-09T11:59:59.000Z; results are as of revision 4; a hook started a daemon that does not serve yet: it is starting
Named test files have no verdict at revision 4: no daemon has validated since 2026-10-09T11:59:59.000Z; a hook started a daemon that does not serve yet: it is starting. Worktree: …. For the verdict, wait once a daemon runs: `squeal status --wait 60000 src/a.test.ts`
Named test files have no verdict: the deadline passed after 1.5 s: a hook started a daemon that does not serve yet: it is starting; results are as of revision 4. Worktree: …. A later pass is not reported. A failure arrives with a later tool call. For the verdict, wait again: `squeal status --wait 1500 src/a.test.ts`
Returned on timeout after 1.5 s: 2 checks (2 tests) pending at revision 4; a hook started a daemon that does not serve yet: it is starting, so the wait went on; the same wait run again gets the result once it serves. Worktree: …
Daemon: no daemon running since 2026-10-09T11:59:59.000Z; a daemon is starting
```

A stale record with the lock held and no mark is a busy daemon: the texts stay as before.

### Behaviour change: the hooks' news at a boundary that spawns

A boundary (PostToolBatch, Stop) that finds no daemon spawns one and marks it. Before, that boundary's news was `no daemon is validating at revision N`, and later `a daemon is validating again`. Now it says nothing while the spawn is marked (a start is no news, as after a registration's spawn, task 001-156), and if no heartbeat comes, the boundary after the grace says `no daemon is validating`, once. The coordinator kept it (request `f52b4d64`, 2026-10-26), with the spawn mark read as none at or before the last heartbeat. Two tests pinned the old news at a boundary that itself spawns; each now checks the silent boundary and then the stop named after the grace: `test/harness/starting-daemon.test.ts` ("heartbeat and then stopped within the grace") and `test/harness/liveness.test.ts` ("is another daemon's when a heartbeat came after it").

### A sentence offered for C9

> Amended 2026-10-26 (row 011-251): a hook that spawns a daemon writes a spawn mark beside the lock file (`<lock file>.spawned`: the spawn's time, written by rename; the first spawn since the last heartbeat keeps its time; the daemon removes it when it registers). While the record is cleared, a wait, status, `squeal start`'s printed status and every header read a start mark that names a live process, or a spawn mark within `DAEMON_START_GRACE_MS` and after the last heartbeat they know, as a daemon starting: a wait goes on; status and the named lines say "a daemon holds this worktree's lock but does not serve yet: it is starting or stopping" with a start mark and "a hook started a daemon that does not serve yet: it is starting" with a spawn mark only, in place of `squeal start`; `squeal status --full` adds "a daemon is starting" to its daemon line; the headers say a daemon is starting, and `--json` adds `daemon.startingSince` and `daemon.startMark` (`start` or `spawn`). A boundary that spawns a daemon gives no news while its spawn is marked; once the grace passes with no heartbeat it says no daemon is validating, once. With a stale record a start mark is a start and no death; no reader takes the lock while a start or a spawn is marked, so status and `squeal stop` no longer make a marked spawn exit as a loser (C9's version rule); a spawn no hook marks (`squeal start`, older hooks) still can. Before a wait says the daemon stopped, it reads the record once more in a read transaction of its own (review 0.1.350-r2, N2).

## F4: no probe while a start is marked

`lockOf(worktree, now)` (`src/core/status/died.ts`) reads the marks before it probes the lock: `starting` (no probe; the recorded daemon is gone, so no death, and a start), `spawned` (no probe; the lock may be being taken), else `daemonGone` as before. `withDeath` and `withStopping`'s stopping branch use it. `squeal stop`'s `lockFreed` reads them before `probeLock` (`marked`, `src/cli/stop.ts`): another process's start mark is the old lock gone; its own, or a spawn mark after the stopping daemon started, is held without a probe.

Limit: a spawn that no hook marked (`squeal start`, a hook older than 011-251) can still meet a status or stop probe at its first lock attempt, and lose as before if it is older than the last daemon recorded. The control test pins this.

## Decisions of the coordinator, 2026-10-26

- A (request `a2488c17`): a spawn mark alone has its own text, `SPAWNED_TEXT`, in plain status, the named snapshot and the wait endings; `LOCKED_TEXT` stays for a start mark. Status does not claim a held lock before one exists.
- B: `squeal status --full`'s `Daemon:` line adds `; a daemon is starting` while either mark is live (`src/core/status/status-detail.ts`, that line).
- C: `daemon-facts.ts` passes `now` to `withDeath`; no `Date.now()` default.
- D: both waits pass `commonDir` to `watchDaemon`; it is not derived from the lock path.
- Request `c51f8f9f`: the field `startMark: "start" | "spawn"`, optional, beside `startingSince`. Three lines outside the list: `src/cli/no-verdict-lines.ts`'s named timeout clause; `evals/lib/squeal-text.mjs` `NO_DAEMON` adds `a hook started a daemon that does not serve yet` (the old pattern reads the new named line as a validating daemon: checked with both patterns on the line); `test/evals/no-verdict-evidence.test.ts` round-trips the spawn-only text through the real store, CLI waits, `formatStatus`, `formatRegistration` and `formatDelta`, as text and in a hook's JSON.

## Type changes (all additive)

- `DaemonLiveness` down: `startMark?: "start" | "spawn"` (`src/core/types/status.ts`); `startingSince`'s comment now says status and every header set it too. `--json`: `daemon.startingSince` and `daemon.startMark` appear while a start is marked; no field removed or renamed.
- `DaemonWatchOptions.commonDir?`, `DaemonWatchOptions.recordNow?` (`src/cli/wait-liveness.ts`).
- `withDeath(store, worktree, live, now)`: `now` is a new required parameter; its one caller passes it.
- New exports: `spawnMarkFor`, `markSpawn`, `daemonStart`, `DaemonStart` (`start-mark.ts`); `lockOf`, `LockReading` (`died.ts`); `SPAWNED_TEXT`, `startText`, `lockedText` (`outstanding-text.ts`). `clearStartMark` now removes the spawn mark too.

## Tests

- `test/cli/start-readers.test.ts` (new): the spawn mark's grace, parsing, the start mark first, removal at registration and not at release, the first spawn keeping its time, a heartbeat voiding it; a wait right after a spawn (named exit 3, pathless exit 0, spawn text, no `squeal start`); plain, named and `--full` status with each mark, `--json` keys (only `startingSince` and `startMark` added); a stale record with the lock held and no mark (busy, as before); a stale record with a start mark (a start, no death); the hooks' header with each mark.
- `test/cli/wait-mixed-read.test.ts` (new): N2 through a pinned real read with a control (`stopped` without `commonDir`); a cleared second read; a store that does not open; named and pathless CLI waits with the registration and the mark's removal at the first start reading 1 s in (past the 750 ms settle). With the second read off, the unit case and both CLI cases fail (run directly once, then restored).
- `test/daemon/start-mark.test.ts`: F4, an older start through the real `openDaemon` after a newer daemon died with its record left, with status's read at the start's first `BEGIN EXCLUSIVE`: with the hook's spawn mark the start opens; the control without a mark loses (`lost-lock`). The first run failed because the fixture had no locks directory, which led to `markSpawn` making it.
- `test/cli/stop-lock.test.ts`: another process's start mark is the lock gone with no probe; its own mark is held; a spawn mark is held unprobed until it lapses, then one probe.
- `test/harness/spawn-mark.test.ts` (new): a hook's `ensure` writes the mark on `spawned` (locks directory made), not on `alive` or `unavailable`.
- `test/cli/wait-locked.test.ts`: the no-SQL case became a no-lock case (no `EXCLUSIVE` statement); a marked start still runs no SQL.
- `test/evals/no-verdict-evidence.test.ts`, `test/harness/starting-daemon.test.ts`, `test/harness/liveness.test.ts`: above.

## For whoever continues

- Row 011-252 (extra spawns during a slow start) is untouched. The spawn mark makes those spawns visible to readers but does not stop them.
- `squeal start` writes no spawn mark (`src/cli/start.ts` was not in this row). It waits for the daemon itself, so only another reader's wait meets its pre-lock window.
- The wait reads a spawn mark without the last heartbeat (`judge` gets only the record). If that matters, `freshRecord` could return the row's `lastHeartbeatAt` too.

## Checks

- `npm run lint` (biome, 2285 files, no fixes) and `npm run typecheck` (`tsc --noEmit`, no errors) at `31092df2a`.
- `squeal status --wait 120000 <the 25 changed paths> test/keys/key-format.test.ts` at revision 60 (`31092df2a`, clean): `Named test files at revision 60: 4 known failures: 4 tests; 772 test files, each with a current result`. The 4 are the bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`: `cli/ps.mjs differs from the build`); the row does not own the bundles, and the coordinator rebuilds them. 59 test files of the worktree are unknown (no check yet); none is in the selection.
- Run directly, beside Squeal: the 7 touched test files (94 tests) passed at `c0f061b76`'s inputs; the discrimination runs above (N2 with the second read off: 3 fail; F4's control).
- `test/daemon/handover.test.ts` ("a 0.1.32 daemon, a current hook, then a released 0.1.31 hook") failed once in Squeal at revision 60 (`expected ['spawned']`, got `['alive']`, 761 ms against a 3.3 s median), and Squeal's rerun passed it at the same inputs. Squeal already recorded this test as flaky on 2026-10-25 at another key. The step-down's ping and request share a 100 ms socket budget; this path reads no mark. Transient, from load (load 20 to 22 on 24 CPUs at 19:36).
- `test/harness/opencode-dispose.test.ts` failed once at revision 46 (a held Stop killed at +2288 ms against a 2000 ms deadline, the failure 011-250's notes record under load); its rerun passed.

## Commits

- `72fd7cf6d` fix(011-251): every reader tells a starting daemon from a stopped one
- `88a588f4c` fix(011-251): a spawn mark alone has its own text; status passes the time; waits pass the store
- `0f024196f` test(011-251): the evals read a spawn-only start as no daemon; N2's waits settle first
- `5fb384690` test(011-251): a hook marks its spawn; squeal stop's lock wait reads the marks first
- `c0f061b76` fix(011-251): the first spawn since the last heartbeat keeps its time; a heartbeat voids a spawn mark
- `31092df2a` docs(011-251): notes: the marks, each reader, the coordinator's decisions, a C9 sentence
- the docs commit with this section

## Review 0.1.355 repair: B1

Cause. `livenessChange` (`src/core/delivery/liveness.ts`) reads `withStopping` alone, not `withDeath`. With a record left by a daemon whose shutdown never began (killed, no shutdown mark), `withStopping` returned through `withShort` before it read the marks. So a replacement that held the lock and marked its start gave the boundary `down` news, while `withDeath` gave the header the start: the title said "no daemon is validating" and the header "A daemon is starting".

Fix. The non-shutdown branch of `withStopping` now reads the marks (`replaced`, `src/core/status/stopping.ts`) through `marksOf` (`src/core/status/died.ts`), which is `lockOf`'s mark read split out of it. A live start mark gives `startingSince` and `startMark: "start"`, as `withDeath` does; status, the header and the hooks' news read the same fact. No lock is taken: `marksOf` never probes. Death and the late feed still start no news, because `livenessChange` reads neither. A stale record with the lock held and no mark is unchanged. A stale record with a spawn mark alone is no start, as before, because a busy daemon may hold the lock: the boundary that spawns says "no daemon is validating" (the coordinator, request `1249e21f`, 2026-10-26, option 1).

A sentence for C9 (accepted by the coordinator as written, request `1249e21f`): "With a stale record, a spawn mark alone is no start, because a busy daemon may hold the lock: the boundary that spawns says no daemon is validating, as before. Once the new daemon marks its start, no boundary gives news until it registers or its start mark no longer names a live process."

Tests.

- `test/harness/stale-replacement.test.ts` (new), through the real Claude Code hook (`runHook`, PostToolBatch) and delivery. A consumer is told alive at its registration. Its record is then left stale with no shutdown mark, and a replacement holds the real lock with `markStart`. There is no test news. The boundaries say nothing while the start is marked. Once the start fails (the lock and its mark go) and the spawn mark's grace passes, one boundary says "no daemon is validating" with the header's death sentence, and the next says nothing. At the replacement's first heartbeat (its record written, both marks removed), nothing. With test news during the start, the header says "A daemon is starting", and neither the title nor the header says that none validates. Before the fix all three cases failed with the review's text (Squeal, revision 62).
- `test/harness/liveness.test.ts`: the stale-record spawn fixture ("is delivered once at a tool boundary when the daemon stops validating") keeps its news, with the rule named in it. A new case: a replacement that marks its start gives no news, and once it lets go of the lock, the boundary says no daemon is validating, while the spawn mark is still within its grace.
- `test/cli/start-readers.test.ts`: with a stale record and a spawn mark alone, plain status names `squeal start`, and the JSON and the header carry no `startingSince` and no `died`.

The review's probe, run again as a scratch Vitest file outside the worktree (`$TMPDIR` scratch, the test fixture's private store). It registered through `createDelivery.register`, set the record's heartbeat 60 s old with a 5 s interval, ran `ensure` with a stand-in that answered `spawned`, then took the real lock with `markStart`:

```text
ensure: spawned
live start: {"kind":"locked","since":1793042267142,"pid":2024364}
liveness: null
header: {"state":"down","since":1793042207140,"startingSince":1793042267142,"startMark":"start"}
(no news)
```

Type changes: none. `marksOf` is a new export of `src/core/status/died.ts`.

For whoever continues: the wait (`judge`, `src/cli/wait-liveness.ts`) still reads a stale record by its socket and reads neither mark (the table above). During a replacement's marked start with the record left stale, a wait can end as "silent" while status says a daemon is starting. This row's repair did not own that file.


Checks for the repair, at `894dd108b`'s code:

- `npm run lint` (biome, 2286 files, no fixes) and `npm run typecheck` (`tsc --noEmit`): exit 0.
- `squeal status --wait <...> src/core/status/stopping.ts src/core/status/died.ts test/harness/stale-replacement.test.ts test/harness/liveness.test.ts test/cli/start-readers.test.ts test/keys/key-format.test.ts` at revision 68: `Named test files at revision 68: 4 known failures: 4 tests; 710 test files, each with a current result`. The 4 are the bundle tests (`cli/ps.mjs differs from the build`), as above; the repair does not own the bundles. `test/keys/key-format.test.ts` passes.
- Before the fix, all three cases of `test/harness/stale-replacement.test.ts` failed at revision 62 with the review's title. After it, one case failed at revision 65 because its expected text had no death sentence. With the marks gone, the header probes the free lock and names the death, which is right, so the expected text now has it.

Commits for the repair:

- `297e5c8e3` fix(011-251): review 0.1.355 B1: a stale record's replacement that marks its start gives no news
- `894dd108b` test(011-251): review 0.1.355 B1: the stale-record spawn fixture names the rule; start-mark and spawn-only cases
- the docs commit with this section
