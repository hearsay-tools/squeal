# 011-250 notes: what stopped a daemon, and a resumed session's first wait

Row 011-250 (gh-1; `tasks/wave-52.md` W1; `research/issue-1.md` sections 3 to 5, open question 1; 011 C9, C13). Worker run `81215145`, 2026-10-26.

## Seam 1: the stop note names the signal and the unit

Before: a signal stop wrote `daemon stopped: signal`, the only source of that note (`research/issue-1.md` section 3).

Now (`src/core/daemon/signals.ts`, `src/cli/daemon.ts`):

- `ownSignals` already passed the signal's name. The handler in `daemonCommand` builds the note at the signal: `signalNote(signal, cgroupUnit())`. A signal during start keeps the note it built and passes it once the daemon owns something to stop.
- `cgroupUnit` reads `/proc/self/cgroup` once, synchronously. It takes the unified hierarchy's line (`0::`) or cgroup v1's `name=systemd` line, and names the deepest path segment that ends in `.service` or `.scope`: `cezar.service` under `user@1001.service/app.slice/cezar.service`, not the user manager. A read that fails (off Linux, a directory) or a path without such a segment (a container's `0::/`, a slice alone) names nothing. It never throws.
- The note text, approved by the coordinator (request `110fa2af`, with the `squeal start` clause added):
  - with a unit: ``daemon stopped: SIGTERM while it ran in systemd unit cezar.service; the next Squeal hook starts a new daemon, or `squeal start` starts one now``
  - without one: ``daemon stopped: SIGTERM; the next Squeal hook starts a new daemon, or `squeal start` starts one now``
- It names no sender. Node passes only the signal's name and number (`research/issue-1.md` section 5), and the unit need not be the sender.
- Type change (additive): `RunningDaemon.stop(reason, note?)`. Without `note`, the text stays `daemon stopped: <reason>`.
- Status groups repeated exit notes by their text (`status-detail.ts`). Stops from one unit and one signal still group as one line.

Tests:

- `test/daemon/signals.test.ts`: a fake `/proc/self/cgroup` names `cezar.service`; a login session's scope; cgroup v1's `name=systemd` line, not a controller's; `0::/` and a slice name nothing; a missing file, a directory, an empty file and garbage name nothing and do not throw; the exact note text with and without a unit.
- `test/daemon/repeated-notes.test.ts` (3 SIGTERM stops of a real daemon) and `test/daemon/restart-handover-signal.test.ts` now read the new note. The expected unit is the test's own (`cgroupUnit()`), since a spawned daemon stays in its parent's control group. On this host that is `cezar.service`.

## Seam 2: the resumed session's first wait (open question 1)

Repro: `test/daemon/resumed-after-signal.test.ts`, a fixture repository under the test scratch directory. A daemon the test started; a Codex SessionStart (`startup`) under a stand-in Codex process the test started; SIGTERM to the daemon; the stand-in ended (Codex dies with the cockpit); a Codex SessionStart (`resume`) for the same session; then `squeal status --wait 60000`.

1. A normal start: the resumed SessionStart spawns a daemon, it registers within the 750 ms settle (`SPAWN_SETTLE_MS`), and the first wait has it (`Returned on quiet`). No fault.
2. A slow start, run before the fix at `96902ca19`, the spawned daemon held with SIGSTOP right after the spawn: SessionStart says `A daemon is starting`. The first wait returns after 1.5 s: `Returned without a daemon: no daemon has validated since <old daemon's last heartbeat>: the daemon stopped`, and its `Outstanding:` line says `` `squeal start` starts one``. After SIGCONT, the next wait has the daemon. This is the incident's text.

Cause (read in source code): `watchDaemon.judge` (`src/cli/wait-liveness.ts`) reads a cleared record as a stopped daemon at once (`record === null` → down `stopped`). A signal stop clears the record (`setDaemon(null)`). A new daemon writes its record only after it takes the lock, opens the store with `quick_check` and binds the socket (`startDaemon`). The wait does not look for a daemon that is starting.

Why the incident's start was slow (inferred, not measured): the reporter's store (cezarion's) is 2.96 GB with a 1.8 GB WAL today (`ls -la`, store not opened), and `quick_check` reads all of it. The cockpit restart resumed every session at once, at a load of 28 to 40 on 24 CPUs. Spawn at 09:46:39 to `alive` at 09:48:04 is about 85 s. The agent's `squeal start` at 09:47:36 needed 28 s to print `alive`, which fits a daemon still starting.

Side effect seen in source code, not measured: during such a start, each hook boundary that finds the record cleared and no socket (PostToolUse, PostToolBatch, Stop) spawns one more daemon. It loses the lock while no daemon is recorded, retries every 10 ms for up to 30 s (`VACANT_LOCK_WAIT_MS`), then notes `a daemon gave up`.

## Seam 2 fix: a wait goes on while a daemon holds the lock (coordinator's option (a), request `b48fc2d8`)

- `watchDaemon.judge` (`src/cli/wait-liveness.ts`) probes the worktree's daemon lock (`lockHeld`, `lockFileFor(commonDir, id)`) only when the record is cleared, at most once a poll. The probe is a non-blocking take (`acquireDaemonLock`, busy timeout 0) and an immediate release. Held: `lapsed` with `locked`, and the wait goes on. Free, no file, no path, or a probe that throws: down `stopped`, as before.
- Both waits carry `locked` to their ending (`lockedOf`). At the deadline (lines approved, request `269a945c`):
  - named, exit 3, `--json` reason stays `lapsed`: `Named test files have no verdict: the deadline passed after 1.5 s: a daemon holds this worktree's lock but does not serve yet: it is starting or stopping; results are as of revision 4. Worktree: …. A later pass is not reported. A failure arrives with a later tool call. For the verdict, wait again: \`squeal status --wait 1500 src/a.test.ts\``
  - pathless, exit 0 as for every pathless timeout: `Returned on timeout after 1.5 s: 2 checks (2 tests) pending at revision 4; a daemon holds this worktree's lock but does not serve yet: it is starting or stopping, so the wait went on; the same wait run again gets the result once it serves. Worktree: …`
- The coordinator's widening, the wait half: with `locked`, the `Outstanding:` no-daemon line above a wait's verdict (pathless, and named `--full`) ends with the same clause in place of `` `squeal start` starts one``. The text logic is in `daemonText` (`src/core/status/outstanding-text.ts`); the wait passes its reading through `formatStatus` and `outstandingLines` options. Plain `squeal status` is unchanged: see follow-up F2.
- Departure from review 0.1.259 B2 (a wait reads the daemon as status prints it), only while the lock is held: past a handoff claim's bound with the record cleared and the lock held, the wait goes on where status reads no daemon. `test/cli/handoff-wait.test.ts` "finds no daemon past the claim's bound" now frees the lock first; a case beside it pins the held lock (coordinator, 2026-10-26).
- The evals parser (`evals/lib/squeal-text.mjs`, `NO_DAEMON`) reads `holds this worktree's lock but does not serve yet` as no daemon validating. Before, it read the named line as a pass with a daemon. `test/evals/no-verdict-evidence.test.ts` round-trips both endings through the real formatters, plain and `--json`, as text and in a hook's JSON.
- Test pause point `store-open` (`src/core/daemon/test-pause.ts`; `pauseAt` in `startDaemon` after `openDaemon`): after the lock and the store open, before the socket and the record. Without a subscriber it does nothing.
- Types (additive): `RunningDaemon.stop(reason, note?)`; `WaitLiveness` lapsed `locked?`; `DaemonWatchOptions.lockFile?`; `StatusWait.locked?`; `NamedWait.locked?`; `OutstandingTextOptions.locked?`; `StatusFormatOptions.locked?`; `TestPause` `"store-open"`.

Tests:

- `test/daemon/resumed-after-signal.test.ts` (real daemons, Linux): a normal resume, first wait `Returned on quiet`; the resumed SessionStart's daemon held at `store-open` (SessionStart says `A daemon is starting`), the wait still running after 3 s, then `Returned on quiet` once released, with no "no daemon"; a named wait with a 3 s deadline while held, exit 3 and the lock line, no `squeal start`; no start and the lock free, `Returned without a daemon: … the daemon stopped`. Each held daemon is resumed (SIGCONT) in a `finally`, and the suite stops every daemon it or a hook started.
- `test/cli/wait-locked.test.ts`: the probe (held, released, no path, no file, a directory that throws); `judge` held and free; named and pathless endings with the lock held; `--json` reason; the Outstanding line with the lock held and free; the lock free as before.

## Follow-ups (for the coordinator to file)

- **F1, option (b): the window before the lock.** A spawned daemon takes the lock only after Node starts and loads the CLI. In that window a wait still says `the daemon stopped` and names `squeal start`. Repro: the daemon held right after the spawn, the first wait returned after 1.5 s with that text. On an idle host the window is under 1 s (the SessionStart settle of 750 ms saw the registration); under load it is longer, not measured. A fix: the hook writes a spawn mark, and a wait reads a cleared record as `lapsed` for `DAEMON_START_GRACE_MS` (10 s) after it. More files: `src/harness/shared/ensure.ts` and a meta key.
- **F2, plain `squeal status`.** It still ends its Outstanding no-daemon line with `` `squeal start` starts one`` while a starting daemon holds the lock, as do `squeal start`'s printed status and the hooks' texts. Its snapshot cannot tell a cleared record from a stale one, so an exact reading needs a snapshot field (a `--json` change) or a second store read. A stale record with the lock held is a busy daemon, which "starting or stopping" would misname.
- **F3, lock waiters during a slow start.** Each hook boundary that finds the record cleared and no socket (PostToolUse, PostToolBatch, Stop) spawns one more daemon. It loses the lock while no daemon is recorded, retries every 10 ms for up to 30 s (`VACANT_LOCK_WAIT_MS`), then notes `a daemon gave up`. Read in source code, not measured. During a start of about 85 s, as the incident's, that is one such waiter for each tool call in that time, each alive up to 30 s.
- **F4, the probe and an older daemon.** A wait's probe holds the lock for one SQLite open, `BEGIN EXCLUSIVE` and release, at most once a poll. A plain spawn that meets it retries in 10 ms. A spawned daemon older than the last one recorded exits as a loser when it loses the lock (C9), so a hook older than the stopped daemon could lose its start to a probe. Not measured; status's `daemonGone` probe has the same window.
- Out of this row: research open questions 2 to 4.

## Checks

- `npm run lint` (biome, 2254 files, no fixes) and `npm run typecheck` (`tsc --noEmit`, no errors) at `6ab15890f`.
- `squeal status --wait 60000 <the 20 changed paths>` at revision 40 (`6ab15890f`, clean): `Named test files at revision 40: 4 known failures: 4 tests; 772 test files, each with a current result`. The 4 are the bundle tests below. 84 test files of the worktree are unknown (no check yet), none of them a reader of a changed path.
- Run directly, beside Squeal, while Squeal had them queued: `test/daemon/resumed-after-signal.test.ts` (4 passed), `test/cli/wait-locked.test.ts` (9 passed), `test/evals/no-verdict-evidence.test.ts` (30 passed). Squeal passed each later at its final inputs.
- `test/harness/opencode-dispose.test.ts` failed once in Squeal at revision 40 (a held Stop killed at +2257 ms against a 2000 ms deadline; load 2.09 per CPU). Already flaky at the same inputs earlier on 2026-10-26. Run directly at load 23.6 on 24 CPUs: 3 passed. `squeal retry --reason load` passed. Transient, from load.

- `test/daemon/socket-handover.test.ts` and `test/daemon/scratch-identity.test.ts` failed once in Squeal at revision 10 (the old daemon had exited before the test's SIGTERM; load 1.36 per CPU). Run directly at load 41, both passed; Squeal's next run passed them at the same inputs. Transient, from load.
- The bundle tests (`test/harness/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`, `codex/plugin.test.ts`) fail on `cli/squeal.mjs` drift: the row does not own the bundles, and the coordinator rebuilds them.

## Commits

- `96902ca19` feat(011-250): a signal stop names the signal and its systemd unit
- `0ba6351ce` fix(011-250): a wait goes on while a daemon holds the lock with no record
- `c5f1f59f8` fix(011-250): a wait's Outstanding line names the held lock, not `squeal start`
- `6ab15890f` docs(011-250): these notes, then this checks section

## Review 0.1.350 repair: B1 and N1

Worker run `df2328a6`, 2026-10-26, on the reviewed baseline `f205f8c53`.

### B1: a wait reads a start mark and never takes the lock

Cause (review 0.1.350, B1; follow-up F4 above): `lockHeld` took the daemon lock for one SQLite open, `BEGIN EXCLUSIVE` and release. A hook's spawn whose version is older than the last daemon recorded lost its first take to that probe, went into the vacant-lock wait, and `servedElsewhere` gave up at its first check because the last version is newer: `lost-lock`, and no daemon serves.

Fix (`src/core/daemon/start-mark.ts`, `open.ts`, `daemon.ts`, `src/cli/wait-liveness.ts`):

- The mark is `<lock file>.starting`: JSON `{ "pid", "startTime" }`. `startTime` is field 22 of `/proc/<pid>/stat` on Linux, `null` elsewhere. It is written to `<mark>.<pid>` and renamed, so a reader never sees half of it. A write that fails is ignored: the wait then reads the start as before 011-250.
- Writer: `takeLock` (the lock step of `openDaemon`, moved out of it unchanged; Squeal's complexity count for `openDaemon` went from 25 to 17) calls `markStart` as soon as it holds the lock: at the first take, or after the lock wait and before the version read after it. Both come before the store open with `quick_check`, the slow part.
- `markStart` returns the lock with a release that removes the mark first and then lets go of the lock, once. Every path that lets go of the lock removes the mark while it still holds it: the decisions after the lock wait, a store that does not open, `abandon`, and `#shutdown`'s `lock release` step. `#step` catches every failure before that step, so it is the shutdown's `finally`. A daemon killed with SIGKILL leaves its mark; its pid is then gone, and the reader ignores it.
- `#register` removes the mark after its transaction commits. From there the wait reads the record.
- Only the lock's holder writes or removes the mark, so two daemons never race on it.
- Reader: `startMarked(lockFile)` parses the mark and checks its process. On Linux the process must exist, have the same start time and not be exiting (`lifeOf`). Elsewhere `process.kill(pid, 0)` must succeed or fail with `EPERM`. No mark, a mark that cannot be read or parsed, a pid that is not a positive integer, or a process that is gone: no start. It takes no lock and never throws.
- `watchDaemon.judge` calls `startMarked` in place of `lockHeld` when the record is cleared. `lockHeld` is removed. The readings and the approved texts are unchanged: `lapsed` with `locked`; named exit 3 with `--json` reason `lapsed`; pathless exit 0.

What a wait now reads with the record cleared:

| The daemon | With the probe (`f205f8c53`) | With the mark |
| --- | --- | --- |
| Starting: holds the lock, no record yet | goes on (`locked`) | goes on (`locked`) |
| Its start failed, ending, lock still held | goes on | goes on (the mark stays until the lock goes) |
| Stopping after it cleared its record, lock still held | goes on | `the daemon stopped`, as before 011-250: it removed its mark when it registered |
| Older than this repair, starting | goes on, and the probe can defeat its start | `the daemon stopped` and `squeal start`, as before 011-250: it writes no mark |
| Died with its mark (SIGKILL) | `the daemon stopped` | `the daemon stopped` |

Limits:

- A daemon of a version before this repair writes no mark, so a wait reads its start as before row 011-250 (`the daemon stopped`, `` `squeal start` starts one``). Its start is no longer at risk from the wait.
- Off Linux there is no start time. A mark left by a daemon that died, whose pid another process reuses, reads as a start until the wait's deadline.
- A mark written in another pid namespace (a container sharing the store) names a pid that is absent here or has another start time, so it reads as no mark.
- `squeal remove` takes only `*.sqlite` daemon locks (`holdDaemonLocks`) and `ps` only `lockFileWorktreeId` names, so neither reads the mark. The temp file `<mark>.<pid>` stays only if a process dies between its write and its rename.

Type changes: no exported type changed. `lockHeld` is no longer exported from `src/cli/wait-liveness.ts` (it had no other caller). `start-mark.ts` is new and exports `startMarkFor`, `markStart`, `clearStartMark` and `startMarked`. `DaemonWatchOptions.lockFile` keeps its name; its comment says the mark beside it is read.

Tests:

- `test/daemon/start-mark.test.ts` (new): the review's regression through the real `openDaemon` and lock. A cleared record, a last version one patch newer than this Squeal, no claim, and a start of this Squeal (the older one). A wait's `judge` runs at the start's first `BEGIN EXCLUSIVE` on the lock file, and the start's attempt runs inside any exclusive transaction the judge opens itself (the order the review's probe forced). The start opens. Against the reviewed `src/cli/wait-liveness.ts` of `f205f8c53` the same test fails with `the start lost: another daemon serves …` (run directly with `npx vitest run test/daemon/start-mark.test.ts -t "polling at its lock attempt"`, then my file restored). Control: a newer daemon that holds the lock and marks its start still defeats the older start (`lost-lock`), and its mark stays. Through `startDaemon`: the mark names this process at `store-open`, and is gone once the daemon serves and once it stops.
- `test/cli/wait-locked.test.ts`: the probe cases became mark cases. A mark this process writes reads as a start until its release removes it. No mark, an empty file, text that is not JSON, `null`, `{}`, a string pid, pid 0 and -1, the pid of a child that exited, and a directory read as none. On Linux, this process's pid with another start time reads as none. `judge` reads `lapsed` with `locked` with a mark and `stopped` without one. A held lock with no mark reads `stopped`, and judging runs no SQL (`DatabaseSync.prototype.exec` and `prepare` spies). The CLI cases hold the lock with a mark, as a starting daemon does.
- `test/cli/handoff-wait.test.ts`: past the claim's bound, the old daemon still holding the lock with no mark: no daemon, `stopped`. A successor that holds the lock and marks its start: the wait goes on, `locked`.
- `test/daemon/resumed-after-signal.test.ts`: while the resumed SessionStart's daemon is held at `store-open`, the mark names its pid. The first wait still goes on and returns on quiet once it serves, and then the mark is gone.

### N1: malformed cgroup rows name nothing

`cgroupUnit` keeps a row only with the header `0::`, or a numeric hierarchy id with `name=systemd`, and a path that starts with `/`. It checks this before it picks the deepest unit. Colons inside the path stay part of it. It never throws.

Tests (`test/daemon/signals.test.ts`): `0::cezar.service`, `garbage:name=systemd:/wrong.service`, `1::/wrong.service` and `0:name=systemd:x/wrong.service` name nothing. A bad row before a valid one: the valid row's unit. `0::/app.slice/a:b.service` names `a:b.service`; `3:name=systemd:/x:y/c.scope` names `c.scope`.

### For C9

A sentence for the mark, offered to the coordinator:

> Between taking the worktree's lock and writing its record, a daemon keeps a start mark beside the lock file (`<lock file>.starting`: its pid and process start time, written by rename, removed once the record is written and before the lock is released); a wait that finds the record cleared goes on while the mark names a live process, reads no mark, an unreadable mark or a gone process as a stopped daemon, and never takes the lock.

### Follow-ups after the repair

- F4 is fixed for waits. Status's `daemonGone` still takes the lock, but its production callers do not reach it with a cleared record (review 0.1.350, "Comparison with status"). Row 011-251 can read the mark in status and in the hooks' texts (F2).
- F1 stays: before a spawned daemon takes the lock there is no mark, and the wait still says `the daemon stopped`. The regression's first reading shows it.

### Checks of the repair

- `npm run lint` (biome, 2262 files, no fixes) and `npm run typecheck` (`tsc --noEmit`, no errors) at `82f30cf51` with these notes added.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA squeal status --wait 60000 <the 5 changed sources and the 6 changed or named tests, test/keys/key-format.test.ts among them>` at revision 19: `Named test files at revision 19: 4 known failures: 4 tests; 269 test files, each with a current result`. The 269 are every reader of the changed paths. The 4 failures are the bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`, `cli/squeal.mjs differs from the build`), which Squeal already reported at revision 0, before any edit: the row does not own the bundles. `test/keys/key-format.test.ts`, `test/daemon/start-mark.test.ts`, `test/cli/wait-locked.test.ts`, `test/cli/handoff-wait.test.ts`, `test/daemon/resumed-after-signal.test.ts`, `test/daemon/signals.test.ts`, `test/daemon/repeated-notes.test.ts`, `test/daemon/restart-handover-signal.test.ts`, `test/daemon/vacant-wait.test.ts` and `test/evals/no-verdict-evidence.test.ts` pass at their final inputs. 84 test files of the worktree are unknown (no check yet); none of them reads a changed path.
- Run directly once: `npx vitest run test/daemon/start-mark.test.ts -t "polling at its lock attempt"` with `src/cli/wait-liveness.ts` of `f205f8c53` in place: 1 failed, `the start lost: another daemon serves …`. This shows the regression catches B1. My file was restored at once, and Squeal later passed the test at the final inputs.
- Host load was 17 to 40 on 24 CPUs during the checks (uptime at 17:33 and 17:42), mostly other work. No flaky or transient failure was seen.

### Commits of the repair

- `0e79f3d22` fix(011-250): a cgroup row with a bad header or a relative path names no unit (review 0.1.350, N1)
- `82f30cf51` fix(011-250): a wait reads a starting daemon's mark and never takes its lock (review 0.1.350, B1)
- the docs commit with this section
