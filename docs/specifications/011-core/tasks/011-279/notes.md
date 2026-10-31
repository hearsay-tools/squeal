# 011-279 and 011-280 notes: decisions the brief did not settle

Rows 011-279 and 011-280 (wave 60 W3 in `tasks/wave-60.md`; findings `research/ci-intermittent.md` sections 1 and 2). Worker run `2ffdaada`, 2026-10-31. Tests only: nothing under `src/` changed.

## 011-279: the updater lock test (`test/harness/codex/runtime-update/lock-process.test.ts`)

- **The acknowledgement already existed.** `lock-owner.ts` sends `held` only after `acquireLock` returned, and `acquireLock` returns only after `writeAtomic` wrote the owner hint. So the fixture needed no new acknowledgement message. The old test failed because it required the PID from the two losers' results, and a loser can read before the holder wrote its hint.
- **Three contenders.** Still exactly one `held` and two `busy`. A loser's PID is now `0` (unknown owner) or the holder's PID; any other PID still fails. After all three answered, the test process attempts once in process and must read `busy` with the holder's PID: this is the check that waits for the acknowledgement.
- **The deterministic case.** The test process takes the lock with a `now` callback. `tryLock` calls `now` once, inside `BEGIN EXCLUSIVE` and before the hint. The callback runs one real contender synchronously (`execFileSync`), which must answer `busy` with PID `0`. After `acquireLock` returned, a second real contender must answer `busy` with the test process's PID. If a future `lock.ts` called `now` before `BEGIN EXCLUSIVE`, the first contender would answer `held` and the test fails; it does not pass silently.
- **Fixture mode.** Without an IPC channel `lock-owner.ts` attempts once, releases what it took, and prints its result as JSON on stdout. With IPC (fork) it behaves as before.
- **Timeout.** The deterministic case blocks the event loop for two `tsx` process starts. It has a 40 s test timeout and a 15 s timeout for each child; the other two tests keep Vitest's default.
- **Killed-owner recovery** is unchanged: its PID check already follows the owner's `held` message.
