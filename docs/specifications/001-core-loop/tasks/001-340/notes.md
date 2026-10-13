# 001-340 notes: stop reports stopped before the lock is free, and a replacement spawned in that gap exits silently

The cause is in `tasks/001-337/notes.md`. The daemon's `#shutdown` closes its socket, then releases its lock, which is D10's order and stays. Under I/O stalls the daemon sat in that gap for seconds. `squeal stop` said stopped when the socket went. A replacement that a hook spawned in the gap tried the lock once, lost it and exited 0 with no note. Nothing started another daemon until the next hook boundary.

## What changed

All three of the brief's fixes. 1 alone covers only `squeal stop`. The same gap closes every exit: sessions-gone, idle, reinstalled, a signal, and a step-down's `stop` fallback. In each, a boundary that lands there spawns a daemon that then vanishes. 2 alone leaves `stop` saying stopped while the lock is held, and a script can act on that. Neither adds risk to the other, and each is small.

1. **`squeal stop`** (`src/cli/stop.ts`): before the stop request it pings once for the daemon's pid. After the socket stops answering, it says `Squeal daemon stopped for <root>` only once one of these holds:
   - the lock is free, probed every 50 ms by taking it and releasing it at once, as status's `daemonGone` does;
   - that pid is gone (`kill(pid, 0)` gives `ESRCH`). The pid matters because a waiting replacement takes the lock the moment it comes free, so the lock alone would never read free.

   The bound is 30 s from when the socket went. Past it, `stop` prints `Stop requested; the daemon for <root> closed its socket but still holds its lock after 30 s` and exits 0, the same code as its tier-in-flight message.

   `stop` reports stopped without proof of a holder in three cases: no common dir is left (the root is gone), no lock file exists, or the probe throws. Nothing proves a holder in any of them.
2. **A lost lock with no daemon serving** (`src/core/daemon/open.ts`): a daemon started without `--await-lock` (a hook's spawn, `squeal start`, a `squeal daemon` in a shell) may lose its first try. It then retries the lock through `awaitDaemonLock`, every 10 ms on a fresh connection, for up to `VACANT_LOCK_WAIT_MS`, 30 s. It gives up as an ordinary loser, with exit `lost-lock` and no note, once either holds:
   - the store records a daemon whose heartbeat is fresh (`liveDaemonRecorded` in `ensure.ts`, D9's grace of two intervals);
   - the root is gone.

   The first check runs right after the first failed try, so a loser to a serving daemon exits as fast as before, plus one store read. Hooks still spawn and return; only the detached daemon waits, so D9's budget is unchanged.
3. **One note for the lost-lock exit that is not ordinary**: when the 30 s pass with the lock still held, the daemon persists `a daemon gave up: the lock was still held after 30000 ms with no daemon serving; the next hook boundary starts one` and exits 0 with reason `lock-wait-timed-out`, as a successor's timeout does. Two lost-lock exits stay silent:
   - **A loser to a live daemon.** Another daemon serves.
   - **A loser whose root went.** The worktree is gone, and its row with it.

   A repository with no store yet gets no note either: the note opens the store with `create: false`, as the successor's does. Only a first daemon still starting can hold the lock there.

### The rule and why it is the smallest

The wait needs one predicate, "a live daemon is recorded", and the existing `awaitDaemonLock`. It needs no flag and no phase field. The brief allowed "or the recorded one is stopping/stopped", but that case is not needed:

- A hook spawns only when the socket is absent (D10).
- The shutdown clears the record (`setDaemon(null)`) before it closes the socket.
- So a spawn that follows an absent socket finds no record, or a dead daemon's stale one. It never finds a stopping daemon's fresh record.
- `DaemonRecord` has no phase. The shutdown's exit mark in `meta` could tell, but nothing needs it.

While nothing live is recorded, the holder is one of three things:

- a daemon stopping past its record and socket;
- a daemon still starting, before its registration;
- a wedged daemon past its heartbeat's grace, whose socket accepts without answering, so hooks never spawn against it.

In the first two, the lock comes free or a record appears. In the third, the wait times out with the note, which then explains the failure.

### Why 30 s

The holder has finished its tier, because the socket closes after `loop.close()`. Only the socket close, the front desk's end and the lock release remain. That is milliseconds calm; 001-337 caught a daemon 8 s into a journal-commit wait.

The successor's 2 minutes cover a tier in flight, which this holder no longer has. 30 s also covers a starting holder's `integrity_check` on a loaded host. Waiting for that start is pointless, since the starter will serve, but harmless: the waiter gives up when the starter registers.

`stop` uses the same 30 s for the same last steps.

### What the loser rules keep

The lock stays the singleton, so two daemons never serve. Every retry runs on a connection of its own (001-153).

Losers of a burst of concurrent spawns now stay until the winner registers: they poll the lock every 10 ms and the store every 250 ms. Before, they exited at once. `test/daemon/lifecycle.test.ts` "five concurrent starts" still ends with one daemon serving and four exits with `another daemon serves`.

Step-down handover: a hook-spawned daemon that lands in the old daemon's last steps now waits too, and can take the lock before the successor does. The successor then gives up because the store records a daemon other than the one it first saw. The daemon that won serves at its own hook's version. It is older than the successor only when a session of an older plugin, one from this release or later, starts in that gap. D10 already accepts the same class for hooks before 0.1.34.

## Tests

- `test/e2e/stop-gap.test.ts`, on both plugins, is 001-337's reproduction. It starts `squeal stop` and spins until the socket file is gone. It then SIGSTOPs the daemon and checks in `/proc/locks` that the stopped daemon holds the lock. Next it runs a SessionStart, whose text says "A daemon is starting", and waits 5 s. Then it asserts that `stop` has not finished, SIGCONTs the daemon, and expects:
  - `Squeal daemon stopped`;
  - a ready daemon with another pid;
  - no "gave up" note;
  - a validated edit.

  `lockHolders` in `restart-evidence.ts` is now exported for it.
  - **Red** on the 0.1.150 bundles, both plugins. Stop said stopped while the lock was held (soft assertion), and `daemonReady` timed out at 45 s. At the freeze, `ps` showed only the stopped daemon (`Tsl`, `do_signal_stop`) holding the WRITE lock.
  - **Green** after `npm run build`, both plugins.
- `test/cli/stop-lock.test.ts` (source): with a stand-in daemon and the lock held in-process, `stop` takes at least 550 ms when the lock is released at 600 ms. It took 7.6 ms before the fix, so the test was red. With the lock held and the ping's pid gone, it says stopped at once.
- `test/daemon/open.test.ts` (source) covers three cases with the lock held in-process:
  - no record: `openDaemon` waits and takes the lock once it is released;
  - no record at a 300 ms bound: `lock-wait-timed-out` with the one note, and no integrity check;
  - a live record: `lost-lock` at once with no note.

  "Five concurrent starts" passes `0` as the wait, because no winner there registers.

## Key format

`open.ts`, `ensure.ts` and `cli/daemon.ts` are guarded sources, so their changes moved the guard's hash. Key format 9 is re-pinned (unreleased) to `a19a039bedbf1420ae8cec6bd2d1ec1ca92c7f4b13f7e7e7d82e77f5f468fd3e` (on top of 005-34's pin, after the rebase onto 4c89381f), by this repository's convention for an unreleased format. No new seam: `open.ts` reads liveness through `ensure.ts`, which already holds the `delivery/liveness.ts` seam.

## Draft D10 amendment (for the coordinator)

In D10's first paragraph, replace "Losers exit." with:

> Losers exit, except that a daemon started without `--await-lock` that loses the lock while the store records no daemon with a fresh heartbeat retries it every 10 ms, each attempt on a connection of its own, for up to 30 s: the holder has cleared its record and closed its socket, so it is stopping and only its lock release remains, which an I/O stall on a loaded host stretched past 8 s (tasks 001-337, 001-340). It exits as a loser, with no note, once a daemon with a fresh heartbeat is recorded or the root is gone, and at its bound persists one note and exits with code 0 and reason `lock-wait-timed-out`. A hook never waits; only the detached daemon does.

In the handover paragraph, replace "Until it exits the old daemon holds the lock: hooks find it alive (stopping) and spawn nothing, and a daemon spawned without the wait loses the lock and exits." with:

> Until it exits the old daemon holds the lock: hooks find it alive (stopping) and spawn nothing until its socket goes, and a daemon spawned after that waits for the lock as above, so it may take the lock before the successor, which then exits as a loser.

Add to D10, after the shutdown order or beside "Status reports …":

> `squeal stop` asks the daemon to stop, waits up to 60 s for its socket to go, and then up to 30 s more for the lock: it says the daemon stopped only once the lock is free (taken and released at once) or the process the daemon's ping named is gone, and past the bound says the daemon closed its socket but still holds its lock (task 001-340).

`status.md` line:

> - 2026-10-13, 001-340 (`tasks/001-337/notes.md`, `tasks/001-340/notes.md`; the rule and the 30 s bounds decided by the worker): D10 amended. `squeal stop` says stopped only once the daemon's lock is free or its pid is gone, up to 30 s after its socket goes, and past that says the lock is still held. A daemon started without `--await-lock` that loses the lock while no daemon with a fresh heartbeat is recorded waits for it up to 30 s (`VACANT_LOCK_WAIT_MS`), giving up silently once one is recorded or the root goes, and with one note and reason `lock-wait-timed-out` at its bound. Additive: `openDaemon`'s `vacantLockWaitMs`, `liveDaemonRecorded` in `ensure.ts`. No type or schema change. Key format 9 re-pinned (unreleased). Evidence: `test/e2e/stop-gap.test.ts` (both plugins), `test/cli/stop-lock.test.ts`, `test/daemon/open.test.ts`.

## Verification

These runs used bundles rebuilt from this row's sources and left uncommitted, because the e2e cases run the shipped bundles. The coordinator commits the rebuild.

- **The bad-config case**, `test/e2e/lifecycle.test.ts -t "bad squeal.config"` on both plugins, unchanged: 20 runs in a row, 20 passed, at load 38 to 117 (24 cores). A full suite ran beside them.
- **That full suite** (`npx vitest run --maxWorkers=4`, before the rebase onto 4c89381f): 462 files passed, 1 failed, 1 skipped; 3,904 tests passed, 1 failed, 10 skipped, in 1,014 s. The failure is `test/runners/node-test/graph-cost.test.ts`, "re-resolves no slower than a cold build" (ratio 1.088 against < 1). It is a timing ratio under load near 100, and this row did not touch node:test.
- **Squeal's full-suite checkpoint** (`squeal run --all --wait`, Squeal 0.1.131, after the rebase): completed at revision 31 with `Known failures: 0`, 4,390 passed and 10 skipped.
- **Directly, after the rebase:**
  - `test/keys/key-format.test.ts`: 27 passed.
  - `npm run lint`: clean.
  - `npm run typecheck`: exit 0.
- **Directly, before the rebase:**
  - `test/daemon/handover.test.ts`, `step-down.test.ts`, `server-handover.test.ts`, `socket-handover.test.ts`, `lifecycle.test.ts`, `open.test.ts`, `test/harness/ensure.test.ts`, `test/cli/stop-lock.test.ts` and `test/e2e/stop-gap.test.ts`: all passed.
