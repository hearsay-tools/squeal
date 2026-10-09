# 001-153: the step-down successor that missed its successor for 60 s

## Cause

`awaitDaemonLock` (`src/core/daemon/lock.ts`) retried `BEGIN EXCLUSIVE` every 10 ms on one connection opened in `locking_mode = EXCLUSIVE`. In that mode a failed `BEGIN EXCLUSIVE` does not drop the locks it reached: a waiter that got SHARED keeps it, and one that got as far as RESERVED and PENDING keeps those too, until the connection closes.

Evidence, from `/proc/locks` with a reader holding SHARED and one failed attempt:

```
POSIX ADVISORY WRITE <waiter> ... 1073741824 1073741825   # PENDING + RESERVED bytes
POSIX ADVISORY READ  <waiter> ... 1073741826 1073742335   # SHARED range
POSIX ADVISORY READ  <reader> ... 1073741826 1073742335
```

Once the old daemon releases the lock, two waiters can both reach SHARED in the same instant. Then:

- A takes RESERVED and PENDING, fails EXCLUSIVE on B's SHARED, and keeps all three.
- B fails RESERVED, and keeps SHARED.
- Neither can progress until one closes its connection at its 120 s timeout (`lock-wait-timed-out`), and then the other wins at once.

There are always two waiters after a step-down. In both cases of `step-down.test.ts`, SessionStart and the PostToolBatch that follows each spawn a `--await-lock` successor; the log of `ensured` showed `["spawned","spawned"]` on every run. The stepping daemon's heartbeat is still fresh, so the second hook asks again (D10 allows two intervals). The test's 60 s wait for "the successor serving" is shorter than the 120 s timeout, so the deadlock shows up as that miss.

This is the same shape as the live gap of about 120 s in 004-17 dogfooding at the 0.1.56 → 0.1.57 Codex update: successor pid 2451514 took the lock right after a second successor gave up its 120 s wait. It is not load: the race window is when both waiters fall on the same 10 ms poll after the release.

A cross-process race (holder releases, two child waiters polling every 1 ms, a 2 s wait):

- kept connection: 4 of 60 trials stuck
- a connection per attempt: 0 of 60

## Fix

Each attempt is now `acquireDaemonLock`, a connection of its own that is closed when the attempt fails, so a waiter holds nothing between attempts. Exactly one daemon still holds the lock (`BEGIN EXCLUSIVE`). A loser's attempt can make the winner's attempt in the same instant fail, but both release, and the next poll decides.

`test/daemon/lock-wait.test.ts` "two waiters never block each other" reproduces the deadlock deterministically in one process. A third connection holds RESERVED, so both waiters reach SHARED and fail. After it releases, the kept-connection code times out both waiters, and the fix gives the lock to one and then to the other.

D10 says this in one sentence after "retries the lock every 10 ms".
