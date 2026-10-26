# 011-225 notes: the vacant waiter's lost-lock case under load

Worker 901f512b, 2026-10-26. Brief: `tasks/wave-44.md` W3.

## Cause

The test was wrong, not the product. The case let go of the holder's lock on a 50 ms timer started just before `startDaemon`. Before its first lock attempt, `openDaemon` resolves the root and spawns `git rev-parse`. When that took longer than 50 ms, the timer fired first and the first attempt took the free lock. A daemon that takes the lock at once is not a waiter, so it never runs the decide-once-more read (`febcbce2a`). It opened the store with the start's 120 s busy timeout, waited until the blocker let go at about 7 s, and served. The 7 s also satisfied the case's `elapsed >= DAEMON_BUSY_TIMEOUT_MS` premise, so only line 180 failed, with a ready daemon.

No other order gives a ready daemon in vacant mode. Under the lock, a busy store throws SQLITE_BUSY and the waiter reads again; `openStore` reports `missing`, read as no daemon recorded, only when the database file does not exist. A first check that gives up, or a wait that runs out, ends `lost-lock` or `lock-wait-timed-out`, never ready.

The product is right to serve after a first attempt that succeeds. Spec 001 D10 limits only the waiters. A downgrade after a newer daemon stopped must still be able to start one.

## Evidence

A probe (`test/e2e/probe-011-225.test.ts`, not committed) used `vi.mock` on two modules:

```ts
// The first runGit call waits `probe.gitDelayOnce` ms longer.
vi.mock("../../src/core/fs/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/fs/index.js")>();
  return { ...original, runGit: async (...args: Parameters<typeof original.runGit>) => {
    const ms = probe.gitDelayOnce; probe.gitDelayOnce = 0;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    return original.runGit(...args);
  } };
});
// Records the time of the first acquireDaemonLock call after `probe.armed`.
vi.mock("../../src/core/daemon/lock.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/daemon/lock.js")>();
  return { ...original, acquireDaemonLock: (path: AbsolutePath) => {
    if (probe.armed && probe.firstAcquireAt === null) probe.firstAcquireAt = performance.now();
    return original.acquireDaemonLock(path);
  } };
});
```

- **A**: the old vacant case body, unchanged except for the first git call made 100 ms slower. Result: `elapsed=7119 ms`, no `lock-wait` pause published, a ready daemon (`exited, ready, root, socketPath, stop, worktreeId`). This is the reported failure.
- **B**: the time from the `startDaemon` call to its first lock attempt, 20 runs, at load 25.6 on 24 CPUs: 4.2 to 7.6 ms, median 5.4 ms. Only a stall of about 7 times the slowest run crosses 50 ms, which fits 1 failure in 169 Squeal records.
- **A, fixed**: the same as A with the new release (below), the first git call 100 ms and then 1000 ms slower. Both runs: `lost-lock`, the waiter waited, about 7 s.

## Fix

`test/daemon/vacant-wait.test.ts`: `releasedOnceWaiting(holder)` subscribes to `pauseAt`'s diagnostics channel (`squeal:test-pause`) in the test process and lets go of the holder at `lock-wait`, which `awaitDaemonLock` publishes after its first failed attempt and the first check after it. The case now waits for the state it asserts, however slow the start is, and it asserts the premise: `waited()` is true. Without that premise, a first check that gave up would pass the case through the wrong path.

The file had the same timer race in two more cases, fixed the same way: the successor case (`awaitLockMs: 5_000`, a 300 ms timer) and the budget case (`openDaemon(..., 15_000, undefined, 1_000)`, a 50 ms timer).

The channel name is a literal in the test, as in `test/daemon/pause-preload.mjs`. `TEST_PAUSE_CHANNEL` in `src/core/daemon/test-pause.ts` is not exported. Exporting it was out of this row's ownership.

## For the next worker

- `startAcrossRegistration` (the first describe) uses a different signal: the first `now()` call, which only the vacant mode's `servedElsewhere` makes. It does not race, because the lock is released only from that call.
- A test that releases a held daemon lock on a timer and then expects what only a waiter does has the same race. The other timer releases found on 2026-10-26 do not: `test/daemon/open.test.ts:111` and `:158` and `test/daemon/lock-wait.test.ts:20` assert the same result whether or not the daemon waited.
