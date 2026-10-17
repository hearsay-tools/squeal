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

Each carrier is walked again on every look while it is younger than `WALK_MS` (1 s) since its last new descendant, and what is new is lowered (`ionice` too on a slow lane). Under the probe beside two hogs:

- one walk more (8cf65404): 1 bad fork in 720, whose `spawn()` took 249 ms.
- walked for 1 s (27f80282): 0 bad forks in 720.

A clone in flight for longer than `WALK_MS` after its parent was lowered would still be missed.

`walk` is an optional fifth parameter of `lowerWhile`, `below` by default, so that a test can stand in for a clone that is listed late. The test `lowers a child still being forked when its fork was lowered (001-437)` lists its child on the fourth walk, so the one-walk version fails it.

## Cost

There is one extra walk per carrier per look for its first second, and longer while it keeps starting children. A walk reads the carrier's `task` directory and one `children` file per thread, then the same for each descendant. Not measured; 001-393's whole look was 0.53 ms with 8 children.

## For the landing

`low-priority.ts` is a guarded key source. `KEY_FORMAT_VERSION` 11 needs re-pinning (no tag carries 11), and the bundles need `npm run build`. This row did neither.

Proposed D11 Priority addition:

> A child a worker was forking when the worker was lowered is listed only once made: each worker's descendants are walked again on every look for a second after its last new one (task 001-437).
