# 001-437: a child its fork was still forking when the fork was lowered kept nice 0

Worker notes, 2026-10-17. Spec 001 D11 Priority, "what it spawns inherits it". Node 24.21.0, a 24-CPU host, the test process at nice 0.

## Cause

A product gap, not a test that samples too early. `clone()` copies the parent's nice when it starts. The child is listed in `/proc/<parent>/task/*/children` only when `copy_process` ends. `lowerWhile` walked a fresh carrier's descendants once (`below`), then set the carrier to nice 10. A child the carrier was forking across that look was in neither: `below` could not see it, and `setPriority` came too late for it. The carrier was never walked again (the `lowered` set), so the child ran at nice 0 for good.

## Evidence

`probe.test.ts.txt` in this folder. Copy it to `test/daemon/probe437.test.ts` to run it, and delete it afterwards. It runs the test's short fork 12 at a time; `ROUNDS` sets the number of rounds. Each fork logs the time its `spawn()` of the child began and returned, and its result goes to `/tmp/probe437.forks.<pid>`. The diagnosis runs also used an instrumented `low-priority.ts`, reverted. It logged when `below` read and when `setPriority` finished, and re-read the carrier's children right after.

Before the fix, `ROUNDS=60` (720 forks) under `taskset -c 0` beside a pinned `node -e "for(;;){}"`. 5 of 720 forks ended `{ own: 10, child: 0 }`, both in a run beside one hog and in a timed run beside two:

| when the fork was lowered (timed run) | forks | child at nice 0 |
|---|---|---|
| before `spawn()` began | 657 | 0 |
| after `spawn()` returned | 30 | 0 |
| during `spawn()`, `below` saw the child | 16 | 0 |
| during `spawn()`, `below` saw none | 17 | **5** |

- In each of the 5, the fork was lowered 15 to 30 ms after its `spawn()` began, and `spawn()` took 117 to 278 ms.
- The re-read right after `setPriority` caught the new child in only 1 of the 5. Most of the gap is the clone in flight, not the moment between `below` and `setPriority`.

## Fix

The coordinator chose option B, then its cheaper variant, which is what landed (eb544d71). A lowered carrier is walked on every look for its first second (`WALK_MS`), then once a second while it lives. What is new among its descendants is lowered, with `ionice` too on a slow lane. Before each walk, the carrier's pid and start time are checked (`statOf`); a carrier whose pid and start no longer match is dropped. Each walk is compared with the carrier's previous one, so a descendant is lowered once, not on every walk. A child forked late is lowered within a second of being listed, plus the look's own delay.

Under the probe, `ROUNDS=60` (720 forks) under `taskset -c 0`:

| version | hogs on CPU 0 | forks with the child at nice 0 |
|---|---|---|
| before (2c3d0121) | 1, then 2 | 5 of 720, each time |
| one walk more (8cf65404) | 2 | 1 of 720, its `spawn()` 249 ms |
| walked for 1 s after the last new descendant (27f80282) | 2 | 0 of 720 |
| B, every look while it lives (f5f294b2) | 1 | 0 of 720 |
| every look for 1 s, then once a second while it lives (eb544d71) | 1 | 0 of 720 |

`walk` is an optional fifth parameter of `lowerWhile`, `below` by default, so that a test can stand in for a clone that is listed late. Two tests use it:

- `lowers a child still being forked when its fork was lowered (001-437)` lists the child on the 16th walk. Under this cadence that is about 7 s after the fork was lowered, so the test takes about 7 s and has a 15 s timeout. The one-walk and 1 s window versions fail it with `{ fork: 10, late: 0 }`.
- `walks a lowered fork once a second after its first, and lowers a late child so (001-437)` lists the child from 1.5 s on. It checks that the child is lowered within 3 s of the start, and that there are at most 2 walks between 1.25 s and 2.25 s. The 1 s window version fails it with the child at 0. B fails it with 3 walks in that second; 1 s at a 100 ms look under load leaves 3 looks or more.

Both hold trivially when the test process already runs at nice 10, as under Squeal: the late child starts at 10.

## Cost

Measured by `bench.test.ts.txt` in this folder; copy it to `test/daemon/bench437.test.ts` to run it, and delete it afterwards. It drives the real `lowerWhile` with a `walk` that does what `below` and `childrenOf` do, with counters, plus the liveness `stat` read before each walk. The test process ran at nice 0, unpinned. Each carrier is a Node process with one Node child, as in the test.

B, every look while the carrier lives (f5f294b2, load about 7; the first 5 looks dropped, the liveness `stat` timed apart):

| | walks per look | reads per look | walk wall per look | walk CPU | `carriers()` per look |
|---|---|---|---|---|---|
| 12 carriers, 10 s (85 looks) | 12 | 204 | p50 2.15 ms, p95 3.23 ms | about 21 ms a second | 0.70 ms |
| 1 carrier, 60 s (583 looks) | 1 | 17 | p50 0.20 ms, p95 0.29 ms | 0.42 ms a second | 0.37 ms |

The variant, every look for 1 s then once a second (eb544d71, load about 13; every look counted, means):

| | part | looks | walks per look | reads per look | walk wall per look | walk CPU | `carriers()` per look |
|---|---|---|---|---|---|---|---|
| 12 carriers, 10 s | first second | 10 | 12 | 204 | mean 3.62 ms | 33 ms a second | 1.43 ms |
| | after | 82 | 1.17 | 19.9 | mean 0.27 ms, p95 2.71 ms | **2.4 ms a second** | 0.76 ms |
| 1 carrier, 60 s | first second | 10 | 1 | 17 | mean 0.33 ms | 1.0 ms a second | 0.61 ms |
| | after | 579 | 0.10 | 1.7 | mean 0.03 ms | **0.06 ms a second** | 0.43 ms |

- A walk reads the carrier's `stat`, its `task` directory and one `children` file per thread, then the same `task` and `children` reads for each descendant. A Node process has about 7 threads.
- After the first second, the variant costs about a tenth of B: 2.4 against 21 ms CPU a second with 12 carriers, and 0.06 against 0.42 with one.
- The first second of a carrier costs what B does. A run whose 12 workers start together pays about 3 ms CPU a look for that second.
- The p95 of 2.7 ms after the first second is the look where all 12 carriers, lowered together, come due at once.

## For the landing

`KEY_FORMAT_VERSION` 11 is re-pinned in place in 2a03213f, after 1612062b for B (no tag carries 11). The bundles need `npm run build`; this row did not run it.

Proposed D11 Priority sentence, after "lowered with what it has started by then (task 001-393).":

> A child a worker was forking when the worker was lowered kept the worker's priority from before and is listed only once made, so a lowered worker's descendants are walked again on every look for its first second and then once a second while it lives: a child forked late is lowered within a second of being listed. With 12 workers the walks cost about 3 ms CPU a look in their first second, then about 2.5 ms CPU a second (task 001-437).
