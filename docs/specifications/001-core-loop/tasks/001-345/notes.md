# 001-345 notes: repair of review 001-344 on 001-340

Review 001-344's session was lost before it wrote its findings file. Its messages proved two breaks with probes; this row fixes both and re-checks the stop probe.

## B1: `stop` said stopped on a lock it could not probe

`lockFreed` in `src/cli/stop.ts` returned true when `acquireDaemonLock` threw. The reviewer made the lock file unreadable (`chmod 000`), and `stop` said stopped while `/proc/locks` and a second acquisition showed the live pid holding the lock.

Now `lockFreed` returns a `LockCheck`: `free`, `held`, or `unchecked` with the probe's error. A probe that throws proves nothing. Two other proofs are still checked every 50 ms:

- the pid the daemon's ping named is gone (`kill(pid, 0)` gives `ESRCH`), as before;
- **new**: the store records a daemon whose start time differs from the ping's `startedAt`. A daemon registers only once it holds the lock, and the stopping daemon cleared its own record before its socket went. So a record of another start time proves the old lock gone.

At the 30 s bound, `stop` prints one of two messages and exits 0:

- `held`: the existing "closed its socket but still holds its lock after 30 s";
- `unchecked`: "closed its socket, and whether it still holds its lock could not be checked after 30 s: <error>".

`stop` still says stopped at once when no common dir or no lock file is left.

### Reused pid (the brief's re-check)

A reused pid could only hold `stop` past a real release, never make it say stopped early: `processGone` is false for a live process of any kind. That happens when a waiting replacement took the lock the instant it came free and the old pid now names another process. The lock then never reads free and the pid never reads gone, so before this row `stop` sat out the 30 s and said the lock was still held. The record check above closes that: the replacement registers, and its start time differs from the ping's. Tested.

### The stop probe never makes a waiting daemon exit (the brief's re-check)

No code change. `awaitDaemonLock` ends only in three ways: it takes the lock, its `giveUp` says so, or its timeout passes. A failed attempt just retries 10 ms later. `giveUp` reads only the store: the record, the root and, from this row, the last daemon's version. Nothing in it sees the probe.

The probe holds the lock for microseconds and stops probing once it finds it free. So a waiter loses at most one retry to it.

One case can still lose to the probe: a daemon that tries only once. That is a release before 0.1.152, or a waiter given 0 ms (only the "five concurrent starts" test). Such a daemon would have lost to the stopping daemon anyway, and only a spawn landing in the microseconds of a probe hits it. No test: an in-process probe and waiter never overlap on one event loop, so it cannot show the race.

## B2: a late older spawn won a step-down's stop gap

With 001-340 a daemon started without `--await-lock` that loses a vacant lock waits for it. The handover sequence that broke:

1. A step-down's old daemon cleared its record and closed its socket.
2. A late hook of an older plugin spawned a daemon in that gap.
3. That daemon waited, took the freed lock, and served.
4. The newer successor saw a record other than the one it first saw and exited as a loser.

The reviewer's probe downgraded a 0.1.153 daemon to 0.1.152 and made the 0.1.154 successor exit that way. D10 accepts an older daemon winning only for hooks from before 0.1.34.

**The rule** (`servedElsewhere` in `src/core/daemon/open.ts`): the waiter also gives up, as an ordinary loser with exit `lost-lock` and no note, while the last daemon its worktree's row records is newer than itself. That daemon's identity is `worktrees.lastDaemon`: the start time and version a cleared record keeps (D7, 001-268). This mirrors the successor's own rule, "never the older one it replaces". It is the brief's option "older than the daemon it would replace", read from what the store already keeps. Why this one:

- no new state, no flag, no meta row;
- only the waiter needs the fix; the stopping daemon can be any release.

A step-down is accepted only for a strictly newer hook, so a waiter older than the old daemon is also older than the successor. One `lastDaemonVersion` store read joins each 250 ms check.

Outside a step-down the rule changes one case. A newer daemon exits for another reason (sessions-gone, idle, `squeal stop`) and an older hook spawns in its stop gap. That spawn now exits at once, as every lost lock did before 001-340, and the next boundary of that older session spawns again once the lock is free. This applies only to mixed versions; the same-version case 001-337 hit, the bad-config restart, still waits.

### Accepted residue (the coordinator's call, 2026-10-13, option (a))

A late hook of the **stopping daemon's own version** still waits and may win the gap. The sequence is the same as B2's: the newer successor then exits as a loser with no note. Why it is accepted:

- That daemon is no older than the one that left.
- Its session is now registered, which is the case in which D10 asks no step-down: the daemon serves at that version until the session leaves.
- After that, the next newer hook boundary steps it down.

**Before 001-340** such a spawn lost the lock to the stopping daemon at once and exited silently. The successor won unless that spawn landed in the instant between the release and the successor's next retry. The pre-0.1.34 limit already describes that window, and 001-145 widened it by the successor's start time. With 001-340's wait the window is the whole stop gap.

The coordinator turned down two alternatives:

- reading the step-down note's text for the requested version;
- a new meta row the stopping daemon writes.

### Released waiters without the rule

0.1.152 (on main, so the Codex plugin that follows main has it) has 001-340's wait without this rule. A late 0.1.152 hook in a later release's step-down can still win the gap with an older daemon. Two reasons it stays narrow:

- A session of that plugin starting in the gap is registered from then on, so it is the pre-0.1.34 limit's case.
- Once that session leaves, its daemon exits within 3 s and the next newer hook starts a current one.

The draft below names it beside that limit.

## Tests

| Test | Red before | Green after |
| --- | --- | --- |
| `test/cli/stop-lock.test.ts` "falls back to the pid" (B1): lock held in-process, file `chmod 000`, ping names a child killed at 600 ms | said stopped in 2.9 ms | waits ≥ 550 ms, stopped |
| `stop-lock` "reports the lock unchecked at its bound" (B1): `lockFreed` with a live pid and with none, 300 ms | `lockFreed` not exported (TypeError; it returned `true`) | `unchecked` with the error |
| `stop-lock` "a daemon of another start time is recorded, though the pid lives on" (reused pid) | "still holds its lock" after 30 s | stopped at once |
| `test/daemon/open.test.ts` "exits at once, with no note, while a newer daemon than itself stops" (B2, unit) | `lock-wait-timed-out` with a note after 3 s | `lost-lock`, no note |
| `open.test.ts` "waits for a stopping daemon of its own version" | (control, passes either way) | takes the lock |
| `test/daemon/handover-gap.test.ts` "exits as a loser with no note, and the successor serves" (B2, the reviewer's probe): a 0.1.1 build steps down for the sources' version, SIGSTOP at the socket's unlink, then the successor and a late 0.1.0 spawn | the late spawn "still running after 30000 ms", waiting for the lock (with `open.ts` of 78eb5cf2) | the late spawn exits as a loser, the successor serves |
| `handover-gap` "a late spawn of the stopping daemon's version may win …" (the accepted residue, pinned) | — | the 0.1.1 late spawn serves, the successor exits with `another daemon serves` and no note, then a current SessionStart with no older session steps it down and a current daemon serves |

The existing stop-lock cases now clear the record (`r.daemon("none")`), as a stopping daemon does. `squealRepo`'s default live record of start time 1 would otherwise prove the lock gone by the new record check.

`handover-gap` freezes the successor with a synchronous `/proc/<pid>/fd` spin, `spinUntilAtLock`. Each of its lock attempts lasts well under a millisecond, too short for the kit's `successorAtLock`, which lists processes on every poll. The successor is seen at the lock twice, so it is past its first `giveUp` check, which saw no record. Only then does the test freeze it. Frozen before that check, it would take the winner's record as the first one it saw and wait the full 2 minutes.

## Seam map (for whoever continues)

- **Lock waits**: `openDaemon` (`src/core/daemon/open.ts`) picks the wait. With `--await-lock` it is `takenOver`, the successor's. Without it, it is `servedElsewhere`, the vacant-lock waiter's. Both run under `awaitDaemonLock` (`lock.ts`), which checks `giveUp` every 250 ms.
- **The cleared record**: `worktrees.setDaemon(id, null)` clears the socket but keeps the start time, the version and the last heartbeat. `recordedDaemon` (`ensure.ts`) reads the socket-bearing record. `worktrees.lastDaemon` reads the identity.
- **`stop`**: it pings once, before the stop request, for the pid and `startedAt`. It then waits for the socket (60 s) and then `lockFreed` (30 s).
- **Key format**: `open.ts` is a guarded source. Format 9 is re-pinned again, unreleased, to `8c4570eff25a4d52d705d33ce30e755ab1a220260151d12850766a856b792497`.

## Draft D10 amendment (for the coordinator)

In D10's first paragraph, replace "It exits as a loser, with no note, once a daemon with a fresh heartbeat is recorded or the root is gone," with:

> It exits as a loser, with no note, once a daemon with a fresh heartbeat is recorded, while the last daemon the worktree's row records (the start time and version a cleared record keeps) is newer than itself, since that is a step-down's old daemon whose successor takes the lock (review 001-344, B2), or once the root is gone,

In the handover paragraph, replace "Until it exits the old daemon holds the lock: hooks find it alive (stopping) and spawn nothing until its socket goes, and a daemon spawned after that waits for the lock as above, so it may take the lock before the successor, which then exits as a loser." with:

> Until it exits the old daemon holds the lock: hooks find it alive (stopping) and spawn nothing until its socket goes. A daemon spawned after that by a hook older than the old daemon exits as a loser, so an older hook never takes the lock ahead of the successor; one spawned by a hook of the old daemon's version or newer waits for the lock as above. Accepted (task 001-345, the coordinator, 2026-10-13): a late hook of the old daemon's own version may so take the lock before the successor, which then exits as a loser with no note. That daemon is no older than the one that left, and its session is now registered, which is the case in which no step-down is asked; once that session leaves, the next newer hook boundary steps it down. Before task 001-340 such a daemon lost the lock at once and exited. A hook of 0.1.152, whose daemon waits for a vacant lock without the version rule, can still take the lock ahead of a later successor, as a hook before 0.1.34 can (above).

Replace "it says the daemon stopped only once the lock is free (taken and released at once) or the process the daemon's ping named is gone, and past the bound says the daemon closed its socket but still holds its lock (task 001-340)." with:

> it says the daemon stopped only once the lock is free (taken and released at once), the process the daemon's ping named is gone, or the store records a daemon of another start time than the ping's (which registers only once it holds the lock, so a reused pid holds nothing up); a probe that cannot open the lock proves nothing. Past the bound it says the daemon closed its socket but still holds its lock, or, when the probe failed, that whether it does could not be checked (tasks 001-340, 001-345).

`status.md` line:

> - 2026-10-13, 001-345 (repair of review 001-344 on 001-340; `tasks/001-345/notes.md`; the residue accepted by the coordinator): D10 amended. `squeal stop` no longer counts a lock it cannot probe as free (B1): the pid or a record of another start time must prove the release, and past the bound it says the lock could not be checked. A daemon waiting for a vacant lock gives up silently while the worktree's last recorded daemon is newer than itself, so a late older hook never takes a step-down's lock ahead of the successor (B2). A late hook of the old daemon's own version may still win that gap; accepted and pinned. Additive: `LockCheck` and `lockFreed` exported from `src/cli/stop.ts`. No type or schema change. Key format 9 re-pinned (unreleased). Evidence: `test/cli/stop-lock.test.ts`, `test/daemon/open.test.ts`, `test/daemon/handover-gap.test.ts`.

## Verification

(Filled in below once the load hold lifts.)
