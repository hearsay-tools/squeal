# 001-393: Vitest fork workers lowered at start, not on the 1 s poll

Worker notes, 2026-10-15. Spec 001 D11 Priority (and Fidelity: the recorder is untouched). Done with 001-400 in the same files. Node 24.21.0, a 24-CPU host at load 55 to 95 while these were taken.

## What changed

- `EscapedChildren.carriers(lane, since)` (`src/core/daemon/escaped.ts`) now reads only the daemon's own children, every thread's, from `/proc/<daemon>/task/<tid>/children` (`childrenOf` in `terminate.ts`). It used to scan all of `/proc` and take the daemon's descendants and its group's orphans.
  - Vitest runs inside the daemon, so its fork workers are the daemon's direct children. A thread worker's child is a child of a daemon thread, so it is listed too.
  - Each child's mark is read once, by identity (pid and start time), and kept while the child lives (`#childMarks`). A child younger than 100 ms is read again on the next look: between its fork and its exec a child shows the daemon's environ, which has no mark.
- `lowerWhile` (`src/core/daemon/low-priority.ts`) looks every 100 ms from the run's start. It used to take a first look at 250 ms and then one every second. A fresh carrier is lowered together with every descendant it has at that moment (`below`). Whatever a lowered process starts later inherits `nice` 10, and `ionice -c 3` on a slow lane too.
- **Not lowered any more:** a carrier that has left the daemon's children before the first look, such as a fork's child whose fork exited within 100 ms. The old scan's group-orphan branch found those, but only on a 1 s look, so they ran unlowered for most of that second anyway. The stop after the run still finds them (D12).

## The test

`test/daemon/low-priority.test.ts`. The test process stands in for the daemon. A child carrying lane `fast`'s mark is started 450 ms into the run, past the old poll's first look at 250 ms. It spawns a grandchild at once, and both print their own priority 400 ms later.

- Before (the HEAD copy, `npx vitest run`, at nice 0): **red**, `expected { own: 0, child: 0 } to deeply equal { own: 10, child: 10 }`.
- After: green. A second test checks that a child of another lane keeps the daemon's priority.
- Like `process-priority.test.ts`, it holds trivially under a daemon that already runs at `nice` 10, which is how Squeal runs it. It discriminates under `npx vitest run` and in CI.

## Cost of the look

Measured by `bench.mjs` in this folder: an esbuild bundle of `src`, with 8 marked and 2 unmarked Node children, at load 55 to 75. The before copy's `carriers` is timed beside it.

| look | wall per look | CPU per look | per second while a run is in flight |
|---|---|---|---|
| full `/proc` scan, before (536 processes) | 17 to 42 ms | 18 to 23 ms | about 20 ms CPU (1 look/s) |
| subtree, each mark read on every look (first version) | 1.5 to 4.2 ms | 1.8 to 1.9 ms | about 18 ms CPU (10 looks/s) |
| subtree, marks read once (committed) | 0.53 ms | 0.56 ms | **about 5.6 ms CPU** (10 looks/s) |

- The async environ reads were most of the first version's cost: 1.0 ms CPU for 10 reads through the thread pool, against 0.3 ms read synchronously. Reading each mark once removed them from the steady state.
- They stay async. Reading `/proc/<pid>/environ` takes the target's mmap lock, and a fork that is freeing a large heap would block the daemon's event loop on a synchronous read.
- What is left per look: one `readdir` of the daemon's `task`, one read of each thread's `children` file (11 threads here), and one `stat` read per child.

## Proposed D11 wording

Priority, replacing its third sentence:

> A Vitest fork worker, a child of the daemon carrying its lane's mark, is found among the daemon's children (`/proc/<daemon>/task/*/children`) every 100 ms and lowered with what it has started, so it runs at `nice` 10 from its first 100 ms (task 001-393).
