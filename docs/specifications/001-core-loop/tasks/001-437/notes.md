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

The coordinator chose option B: every lowered carrier is walked on every look for as long as it lives, and what is new among its descendants is lowered (`ionice` too on a slow lane). A carrier is dropped once its pid and start time no longer match (`statOf`), so the old `lowered` set of every carrier ever seen is gone with it. Each walk is compared with the carrier's previous one, so a descendant is lowered once, not on every look.

Under the probe, `ROUNDS=60` (720 forks) under `taskset -c 0`:

| version | hogs on CPU 0 | forks with the child at nice 0 |
|---|---|---|
| before (2c3d0121) | 1, then 2 | 5 of 720, each time |
| one walk more (8cf65404) | 2 | 1 of 720, its `spawn()` 249 ms |
| walked for 1 s after the last new descendant (27f80282) | 2 | 0 of 720 |
| B, every look while it lives (f5f294b2) | 1 | 0 of 720 |

The 1 s window still missed a clone in flight for longer than that, and `spawn()` took up to 278 ms under this load, about a quarter of the window. B has no such bound.

`walk` is an optional fifth parameter of `lowerWhile`, `below` by default, so that a test can stand in for a clone that is listed late. The test `lowers a child still being forked when its fork was lowered (001-437)` lists its child on the 16th walk, more than 1.5 s after the fork was lowered. Both the one-walk and the 1 s window versions fail it with `{ fork: 10, late: 0 }`.

## Cost

Measured by `bench.test.ts.txt` in this folder; copy it to `test/daemon/bench437.test.ts` to run it, and delete it afterwards. It drives the real `lowerWhile` with a `walk` that does what `below` and `childrenOf` do, with counters, at nice 0, unpinned, load about 7 on 24 CPUs. Each carrier is a Node process with one Node child, as in the test. Steady looks only, the first 5 dropped.

| | walks per look | reads per look | walk wall per look | walk CPU per look | liveness `stat` per look | `carriers()` per look |
|---|---|---|---|---|---|---|
| 12 carriers, 10 s (85 looks) | 12 | 204 | p50 2.15 ms, p95 3.23 ms | p50 2.0 ms, p95 3.0 ms | 0.26 ms | 0.70 ms |
| 1 carrier, 60 s (583 looks) | 1 | 17 | p50 0.20 ms, p95 0.29 ms | 25 ms over its 60 s | 0.02 ms | 0.37 ms |

- A walk reads one `task` directory and one `children` file per thread, for the carrier and for each descendant. A Node process has about 7 threads, so a carrier with one child costs 17 reads.
- With 12 carriers, B adds about 2.4 ms to each look, against 0.70 ms for the look without it (0.53 ms in 001-393's bench). That is about 24 ms CPU a second per active lane, against D11's "about 5 ms". As a share of the host it is about 2.4% of one core, 0.1% of 24 CPUs.
- The cost grows with carriers times their threads and descendants, every 100 ms, for as long as they live. A long-lived Vitest fork worker pays it for its whole life.
- A cheaper variant, not built: walk a carrier on every look for its first second after being lowered, then once a second while it lives. That cuts steady cost about tenfold and still catches any clone, at most a second late.

## For the landing

`KEY_FORMAT_VERSION` 11 is re-pinned in place in 1612062b (no tag carries 11). The bundles need `npm run build`; this row did not run it.

Proposed D11 Priority sentence, after "lowered with what it has started by then (task 001-393).":

> A child a worker was forking when the worker was lowered kept the worker's priority from before and is listed only once made, so every lowered worker's descendants are walked again on every look while the worker lives, and what is new is lowered (task 001-437).

The cost sentence would then read "A look costs about 3 ms CPU with 12 marked children, about 30 ms CPU a second per active lane", from the bench above.
