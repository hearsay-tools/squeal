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

- `test/daemon/socket-handover.test.ts` and `test/daemon/scratch-identity.test.ts` failed once in Squeal at revision 10 (the old daemon had exited before the test's SIGTERM; load 1.36 per CPU). Run directly at load 41, both passed; Squeal's next run passed them at the same inputs. Transient, from load.
- The bundle tests (`test/harness/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`, `codex/plugin.test.ts`) fail on `cli/squeal.mjs` drift: the row does not own the bundles, and the coordinator rebuilds them.

## Commits

- `96902ca19` feat(011-250): a signal stop names the signal and its systemd unit
- `0ba6351ce` fix(011-250): a wait goes on while a daemon holds the lock with no record
- `c5f1f59f8` fix(011-250): a wait's Outstanding line names the held lock, not `squeal start`
