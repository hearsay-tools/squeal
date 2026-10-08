# 001-145: the released-bundles handover case, why it missed its successor

2026-10-08, host of 24 CPUs at load 52 to 160.

## Cause

`test/daemon/handover.test.ts` "a 0.1.32 daemon, a current hook, then a released 0.1.31 hook" failed 2 of 6 runs and then 7 of 8 as load rose from 52 to 160. In every failure the released 0.1.31 hook's daemon held the lock and served (`ping` answered `0.1.31`), while the current successor (`--await-lock 120000`) was still alive and waiting. The product did start a successor; it lost the lock race that D10 accepts (`reviews/wave-12c.md` B1).

The window is wider than D10 said. A probe that polled `/proc/<pid>/fd` for the lock database, with times from just before the current SessionStart, in one failing run at load 140:

| ms | event |
|---|---|
| 309 | the current hook returns, the successor spawned |
| 905 | the 0.1.31 hook's daemon holds the lock database open |
| 970 | the 0.1.31 hook returns (the old 0.1.32 daemon had already stopped: no record, no socket) |
| 1043 | the successor first holds the lock database open |

An idle 0.1.32 daemon stops in well under 0.5 s. The successor needs about 0.7 s at that load to start Node, load the test build's modules (unbundled `tsc` output) and run `git rev-parse` before its first lock attempt. A bundled 0.1.31 daemon spawned in that time takes the lock. D10 said "the successor already retries while the old daemon shuts down", which holds only when the old daemon's stop outlasts the successor's start (a tier in flight). The spec now names this window.

## Fix

The test now waits for the successor to hold the lock database open (`successorAtLock`, from `/proc`, so the B1 block runs on Linux only), and only then lets the older boundary come. It then checks what D10 promises: once the successor is retrying, an older hook's daemon loses. Ten runs in a row passed at load 64 to 104.

## Not settled here

- Whether the wider window is still accepted is the human's call. A product change would close it to the 10 ms between retries: the hook spawns the successor first, and the successor sends `step-down`/`stop` itself once it is at the lock.
- Squeal's own runs of the whole file showed the same case failing earlier with `ensured` `['alive']` instead of `['spawned']` (revisions 6, 8 and 11, while the disk was full). My 5 direct runs of `handover` with `step-down` showed nothing like it. Likely cause: the step-down `stop` missed the 100 ms socket budget (D9) or hit ENOSPC. Not reproduced.
