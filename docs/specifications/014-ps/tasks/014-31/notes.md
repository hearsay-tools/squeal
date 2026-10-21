# 014-31: a held lock missed by one `/proc/locks` read

2026-10-22, host of 24 CPUs at load 45 to 71.

## Where the second reading goes

`/proc/locks` is a seq_file: each `read()` returns one page, and an entry can fall between two pages when an earlier entry goes away between the calls (`lessons.md` P9). Before the change I checked whether a read right after the first is a good second reading. A copy of round 2's `locks-exp.mjs` that reads in pairs (read-only; `/tmp/w-18ac069e/pairs.mjs`, not committed) reads `/proc/locks` in pairs and counts, per daemon lock held at both ends, the reads that miss it:

| Pairs | Gap | Daemon locks | Misses, first read | Misses, second read | Both missed |
|---|---|---|---|---|---|
| 1,000 | 0 ms | 20 | 16 | 15 | 2 |
| 1,000 | 0 ms | 21 | 10 | 8 | 1 |
| 1,000 | 0 ms | 18 | 10 | 4 | 1 |
| 300 | 50 ms | 18 | 2 | 2 | 0 |

Back to back, 4 of 36 first misses were missed again: about 11%, against about 0.05% if the reads were independent. A daemon at a page boundary stays there for the next read. So the second reading is at the window's end, 2 s later, as the brief led. The 50 ms row is too small to judge.

## The rule as built

- `snapshot.ts` reads `/proc/locks` once at the window's start and once after the memory read at its end. Before, it read it three times: in `discover`, in `readPool` (both at the start) and in `flag` (only to test for `null`). The flags now take the lock state from `pool.held`, which is `null` exactly when the first reading is.
- `discover.ts` `lockedAgain`: a daemon whose lock the first reading missed holds it when the second shows it; a socket file with no daemon is tied again. A daemon is `false` only when both miss it.
- `host.ts` `readPool` takes both readings: a permit either shows is held, by the holders of the latest reading that shows it. A union of holders would give a permit that passed between two daemons to both.
- `flags.ts` `duplicates`: under the union, a lock that passes from a stepping-down daemon to its successor inside the window shows two holders. No two processes hold one lock file at once, so two holders of one file are the two readings', and neither is flagged; a third daemon that waited still is, naming both.
- `snapshot-shape.ts`: a daemon the first reading missed shows the work of the second store read.

## Known limits

- The first store read (`work.ts` `byStore`) still skips a daemon the first reading missed, since the second reading comes after it. Nothing claims an absence from that: the phase and the flags read the second store read, and `hung` and `dead-consumer`, which need both, claim nothing. But in that snapshot the daemon's escaped test processes (those tied by token, not by ancestry) are unowned at the first sample: they are not listed under it, and their CPU is not in Squeal's share. They are not called orphans, because the second sample owns them.
- The pool is now read at the window's end, not inside it (D4's list of reads inside the window named it). It takes 1.0 to 2.6 ms there on the 650-process cost fixture.

## Cost test

`test/ps/snapshot-cost.test.ts` on its 650-process, 25-daemon fixture, as a copy that prints its three numbers. Base 826972470 and this branch, in throwaway worktrees, 15 interleaved pairs at load 57 to 71 (1-minute):

| | Inside the window | After it | CPU |
|---|---|---|---|
| Base, median (range) | 96 ms (75 to 215) | 103 ms (71 to 130) | 198 ms (140 to 210) |
| 014-31, median (range) | 111 ms (80 to 185) | 135 ms (94 to 171) | 193 ms (167 to 223) |
| Bound | 2,000 ms | 500 ms | 300 ms |

`/proc/locks` reads, inside / after: base 2 / 1, now 1 / 1. Timed apart, the second read took 0.12 to 0.17 ms, `lockedAgain` 0.15 ms and `readPool` 1.0 to 2.6 ms. The CPU medians are equal. The wall gaps are load: the branch is also slower inside the window, where it now does less.
