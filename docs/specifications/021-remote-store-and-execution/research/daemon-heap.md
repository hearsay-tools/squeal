# 021-27: what fills an idle daemon, and whether a runner host grows per run

Researcher, 2026-11-12, 21:03Z to 21:58Z. Brief: `../tasks/wave-6.md`, section 021-27. Extends `../../011-core/research/daemon-memory.md` (011-53). Host: 24 vCPUs, Linux 6.8.0-147, Node v26.13.0. Squeal: this worktree's committed Claude Code bundle at `5cc5624e2` (0.1.459), copied. Repositories: shallow clones of cezar at `cc3cead4b` (Vitest 4.1.10, Vite 8.1.4) and of Squeal at `5cc5624e2` (Vitest 5.0.3), each under `$TMPDIR` with its own `HOME`, `XDG_*` and `TMPDIR`, installed offline from the host's pnpm store. Pool capped at 4 slots (1 slot for the busy runs), slow lane off. Live daemons of other worktrees were read only through `/proc/<pid>/smaps` and `squeal ps`; none was attached to or signalled. Probes and logs: `probes/daemon-heap/` (throwaway). The one-minute load is given beside every number. The load was 15 to 50 during the session, from other coordinators; every timing kept was taken below 24.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Heap and native memory of a daemon with no Vite, by retainer | **Settled:** 355 to 375 MiB private after its own idle GC (cezar). The live JS heap is 281 MiB (Squeal: 292). **53% of it is one field:** `RunnerClosure.imports` in `WorktreeKeys.#runnerClosures`, 150 MiB (Squeal: 156), 351,077 per-module records for 1,916 test files. Native: glibc 54 to 68 MiB, web-tree-sitter's WebAssembly heap 32 MiB. **Busy** (a queue of 1,200 files, as the live daemons have): 902 to 1,466 MiB. A full GC took the heap from 705 to 298 MiB; a last-resort GC took private memory from 1,181 to 722 MiB. The rest is dead heap that V8 keeps while the daemon allocates 47 MiB/s, and 0.25 GB of native memory. | verified by experiment |
| 2 | A Vitest host over 30 edits of Squeal | **No growth per run.** Live heap after a full GC: 93 MiB after edit 1, 96 to 97 MiB from edit 3 to edit 30. Private memory after the GC: 500 to 562 MiB, no trend. Before the GC it moved between 614 and 790 MiB with no trend. Rolldown's mimalloc stayed at 299 MiB. The daemon of the same run: live heap 263 MiB from edit 9 to edit 30. | verified by experiment |
| 3 | D20's cold start on cezar | **A cold host makes the first edit 23 to 25 s slower on cezar.** Cold edit 30.4 to 31.5 s against warm 6.0 to 8.0 s (load 15 to 19). Process and instance: 0.65 to 0.86 s; the rest is the first `affected` call, which walks every test file's imports: 29.8 to 30.8 s. On Squeal: cold 8.6 to 13.9 s against warm 0.44 to 0.89 s. D20.6's "about 1 s for a small project" and "12.6 to 15.6 s" are too low for both. A host holds 90 to 192 MiB after start and 0.7 GB (Squeal) or 1.4 to 2.1 GB (cezar) after its first walk. | verified by experiment |
| 4 | Cheapest change per cause | (a) Do not keep `imports` in `#runnerClosures`: −150 MiB live per daemon. (b) Stop rebuilding the CRAP loaders' path map from every closure on each pass while a queue drains: 41% of a busy daemon's allocation. (c) A last-resort GC when a busy daemon's heap passes about twice its last live size: −459 MiB measured once. (d) web-tree-sitter in a worker that ends: −32 MiB. Glibc arenas and one 132 MiB mapping: not determined. | savings of (a) and (c) verified by experiment; (a)'s safety read in source code; (b) and (d) inferred |

## 1. What a daemon holds

**Settled, cezar run 1** (`logs/settled-gc.tsv`, `logs/cezar-run1-split.tsv`). The daemon had listed and keyed 1,916 test files, counted complexity and linted 3,348 files. It had run no test (`lookup-only`, empty store). *Verified by experiment.*

| Point (load) | Private | heapTotal | heapUsed | Pause |
|---|---|---|---|---|
| Settled (21.3) | 450 | 324 | 264 | – |
| After a full GC (21.3) | 448 | 255 | 235 | 76 ms |
| After a last-resort GC (21.0) | 375 | 250 | 235 | 210 ms |
| The daemon's own idle GC, runs 1 and 2 | 512 → 374; 497 → 355 | – | – | 195; 270 ms |

After the last-resort GC: V8's 256 KiB pages 253 MiB, anonymous mappings of 1 MiB or more 48, glibc `[heap]` 68; file pages are not private. No native `.node` module is loaded: Rolldown, mimalloc and Vite live only in the host (D8).

**By retainer.** A heap snapshot after the GC (`logs/cezar-settled-dominators.txt`; `dominators.mjs` computes the dominator tree as DevTools does) retains 281 MiB:

| Retainer | MiB |
|---|---|
| `WorktreeKeys.#runnerClosures` (`src/core/scheduler/keying.ts:92`), a `RunnerClosure` per test file | 153 |
| of which through `imports` (`FileImports`: `path`, `sha1`, `static[]`, `dynamic[]` for every module of the closure) | 150 |
| of which `paths` | 2.8 |
| `WorktreeKeys.index` (`KeyIndex`): `reverse.byPath` 26, `keyed` 6 | 39 |
| web-tree-sitter's Emscripten heap (`Int8Array` over a 32 MiB `ArrayBuffer`), the complexity counter's grammar runtime | 32 |
| The code pass's `StepCache` (CRAP loaders, `byPath`) | 8.6 |
| The bundle's own source text | 7.8 |
| Everything else | ~40 |

The Squeal clone gives the same shape: 292 MiB, `#runnerClosures` 160 MiB, `imports` 156 MiB (421,724 records for 1,740 test files), `KeyIndex` 25 MiB, tree-sitter 32 MiB (`logs/squeal-settled-dominators.txt`).

**Why `imports` is large.** Each test file's closure carries one record per module it loads, about 183 on cezar, and the records of different test files are separate objects. The 1.96 million strings in the heap hold 71,032 distinct values. Held once each they would take 16 MiB; the copies take 95 MiB (`logs/cezar-settled-strings.txt`). One path, `packages/cezar/src/home/display.ts`, is held 35,490 times. The 40-hex `sha1` values: 356,526 strings for 8,545 distinct values, 19 MiB. *Verified by experiment.*

**Who reads it.** `keying.ts` never reads `imports`. The import-graph writer (`recordImportGraph`, `src/core/store/import-edges.ts`) reads it from fetched parts (`revision.ts:382`, `import-rewalk.ts:113`) and stores the edges in the store. After that, the copy in `#runnerClosures` is read by nothing found. *Read in source code at `5cc5624e2`.*

**Busy, the state of the live daemons.** `squeal ps` at 21:31Z: idle cezar daemons at 553 to 590 MiB; busy ones, with 466 to 1,563 files pending, at 0.9 to 1.1 GB. In the 21:06Z `/proc` read (`logs/live-split-1.tsv`), three cezar daemons held 0.96 to 1.40 GB private, 0.66 to 0.98 GB of it V8 pages. My cezar daemon reproduced this. An edit to `packages/contract/src/waits.ts`, which most closures name, queued 1,330 files at one slot (`logs/cezar-busy-run2-daemon.tsv`):

| Time after the edit (load) | Private | heapTotal | heapUsed | Large objects |
|---|---|---|---|---|
| 0 s (17.1) | 448 | 330 | 267 | 3 |
| 20 s (19.2) | 1,466 | 944 | 866 | 209 |
| 35 s (21.7) | 1,278 | 1,073 | 1,017 | 215 |
| 1 to 3 min (21 to 31) | 854 | 620 | 363 to 388 | 22 |
| 3 to 6 min (13 to 22) | 551 to 611 | 354 to 393 | 266 to 301 | 3 to 4 |

A heap snapshot 10 s after a second such edit retained 414 MiB (`logs/cezar-wide-edit-dominators.txt`): the peak is short-lived garbage. In run 3, a restart picked up the same queue (1,206 files). After 9 minutes busy, the daemon stood at 1,181 MiB private with 705 MiB of heap in use. A full GC left 298 MiB live and 1,006 MiB private (80 ms). A last-resort GC left 722 MiB private (186 ms). The rest was native: glibc `[heap]` 134 MiB, anonymous mappings of 1 MiB or more 171 MiB: one 132 MiB mapping and four mappings of 43 to 49 MiB, the size of glibc's per-thread arenas (`logs/cezar-busy-run3-split-end.tsv`). *Verified by experiment.* That the four are glibc arenas is *inferred* from their size; what the 132 MiB mapping is was not determined.

**What allocates while busy.** V8's sampling heap profiler, run for 2 minutes through an in-process inspector session with collected objects counted, sampled 5.7 GB of allocation: 47 MiB/s (`logs/cezar-busy-allocations.txt`, load 15 to 24):

| Source (bundle line → source) | GB in 2 min | Share |
|---|---|---|
| CRAP loaders: `#read` (`src/core/code/crap/loaders.ts`) builds `byPath` from every test file's closure paths on each `advance`; `condition` and the flatMaps in `crap/file.ts` and `crap/walk.ts` | 2.3 | 41% |
| Runner-host line reader: `LineReader.push` (`src/core/runner-host/protocol.ts`) joins the chunks of each line and `JSON.parse`s it; Node's `string_decoder` | 1.8 | 31% |
| Store reads in `state/sink.ts` `begin`, CRAP `judgedFiles`, `escaped.ts` orphan scan, `readMoves`, coverage summaries | about 0.5 | about 9% |

The CRAP pass runs again whenever a coverage record is stored (`onStored`, row 015-12), so a draining queue rebuilds the map many times. *The share is verified by experiment; the cause read in source code.* That this churn keeps V8's heap at two to three times the live set is *inferred*: V8 grows its old generation as a factor of the live size while the allocation rate is high, and the memory reducer and the daemon's idle GC (spec 011 C9) act only when the daemon is idle.

## 2. A Vitest host over 30 edits

`run-edits.sh` on the Squeal clone: 10 small test files edited in turn, 30 edits, a verdict awaited for each, then one full GC in the host and in the daemon. Coverage on, as the repository sets it; config not changed (`logs/squeal-30-edits-host.tsv`, `-daemon.tsv`, `-split.tsv`). Load 32 to 50 from other coordinators; no timing is used from this run. *Verified by experiment.*

| Edit | Host private | Host live heap after GC | Host private after GC | Daemon live heap after GC |
|---|---|---|---|---|
| 0 | 485 | 106 | 485 | 242 |
| 1 | 650 | 93 | 546 | – |
| 10 | 788 | 97 | 559 | 263 |
| 20 | 758 | 97 | 529 | 263 |
| 30 | 676 | 97 | 562 | 263 |

Before the GC, the host held 614 to 790 MiB and heapTotal moved between 235 and 410 MiB; no trend over the 30 edits. glibc `[heap]` grew from 12 to 45 MiB over the first three runs, then 45 to 52. The host's test workers are separate processes and are not counted here.

What makes a host large is its first `affected` walk, not its runs. In the drives of question 3, the cezar host went from 173 to 192 MiB at start to 1.38 to 1.77 GB after its first walk, and moved between 1.4 and 2.1 GB over the next warm edits with no GC forced. A Squeal host goes from 90 to 100 MiB to 680 to 716 MiB. Over hours, after the slow lane or recreates (`daemon-memory.md` 3), not measured.

## 3. D20's cold start

`drive-host.mts` starts the copied bundle's `runner-host` through Squeal's own proxy (source at `5cc5624e2`), on a copy of the clone so that no daemon saw the edits. Each cycle does what a daemon asks of a host for one edit of a test file: `invalidate`, `affected` (the daemon calls it on every revision, `refinement.ts:159`), `closure` and `run`. It repeats that twice warm, then closes the host, so the process exits as under D20.2. 3 cycles each, 4 workers, no coverage, no exclusions, so the lists include the end-to-end files the daemons leave out (`logs/cold-start-*.jsonl`). *Verified by experiment.*

| | cezar, 1,765 files listed, load 15 to 19 | Squeal, 1,765 files listed, load 15 to 20 |
|---|---|---|
| Process, instance and `start` | 0.65 to 0.86 s | 0.43 to 0.60 s |
| List | 27 to 36 ms | 29 to 60 ms |
| Cold edit (`affected` share) | 30.4 to 31.5 s (29.8 to 30.8) | 8.6 to 13.9 s (8.0 to 13.2) |
| Warm edit (`affected` share) | 6.0 to 8.0 s (5.5 to 7.4) | 0.44 to 0.89 s (0.09 to 0.19) |
| Close | 0.32 to 0.38 s | 0.16 to 0.24 s |

The cold walk transforms every test file's imports, as in 011-53 3. It costs about twice 011-53's 12.6 to 15.6 s because cezar has 1,765 Vitest files now against 771 then. On cezar the warm `affected` still takes 5.5 to 7.4 s per edit; that is outside this topic.

## Recommendation for Squeal

1. **Drop `imports` from the closure the daemon keeps.** In `setClosure` (`keying.ts`), keep the `RunnerClosure` without `imports` once the import graph is recorded. Saving: 150 to 156 MiB of live heap per daemon on cezar and Squeal, 53% of a settled daemon. Under load the saving is larger, as V8 sizes the busy heap from the live set; 300 to 375 MiB at the factor of 2 to 2.5 seen in run 3 is *inferred*. A worker must confirm that no other reader of `#runnerClosures` needs `imports`. Sending `imports` once per module rather than once per test file, or not at all when the graph has that module at that `sha1`, would also shrink the host's replies, the second churn source. Interning the path strings on receipt is the fallback if `imports` must stay: 95 MiB of copies.
2. **Make the CRAP loaders incremental, or defer the CRAP pass while a queue drains.** They rebuild a map over every closure path at each pass and produce 41% of a busy daemon's allocation. Saving: transient memory and CPU, not measured apart.
3. **A last-resort GC for a busy daemon too.** Today's idle GC needs 60 s with no tier; a daemon with 1,000 files queued never has it. One GC took a busy daemon from 1,181 to 722 MiB in 186 ms. A trigger such as "a tier ended and the heap is over twice the last live size, at most once a minute" bounds that. How fast the heap grows back was not measured.
4. **Keep D20.** The host is where a cezar worktree's 0.7 to 2.1 GB sits, and it does not grow with runs, so closing it gives all of that back. Correct D20.6: the first edit after a close costs 8 to 13 s on Squeal and 23 to 25 s on cezar, not about 1 s. The daemon already holds every test file's closure paths in its reverse index; answering the first `affected` after a reopen from that index, rather than from Vitest's walk, would remove most of the cold cost. That is *inferred* and untested.
5. **Lower priority:** web-tree-sitter's 32 MiB stays for the daemon's life; a counter in a worker thread that ends saves it.

## Open questions

- The 132 MiB anonymous mapping of the busy daemon, and whether `MALLOC_ARENA_MAX=2` or `malloc_trim` after a tier returns the glibc arenas (about 130 MiB busy). Not tested.
- Memory of a daemon that inherits results from a large shared store: my clones had empty stores. Not measured.
- A host over hours with recreates and the slow lane; macOS. Not examined.
- Diagnostics: a heap snapshot left about 1 GB of native memory in the daemon that no GC returned (`logs/cezar-after-snapshot-split.tsv`, glibc 677 MiB). A product heap dump would need its own process, or an exit afterwards.
- On cezar a warm edit's `affected` takes 5.5 to 7.4 s; on Squeal 0.1 to 0.2 s. The cause was not examined.

## Sources

- Squeal source at `5cc5624e2`: `src/core/scheduler/keying.ts` (`#runnerClosures`, `setClosure`), `src/core/types/runner.ts` (`RunnerClosure`, `FileImports`), `src/core/store/import-edges.ts`, `src/core/scheduler/revision.ts`, `import-rewalk.ts`, `refinement.ts`, `src/core/code/crap/loaders.ts`, `cache.ts`, `file.ts`, `walk.ts`, `step.ts`, `src/core/runner-host/protocol.ts`, `channel.ts`, `proxy.ts`, `vitest-host.ts`, `src/core/daemon/idle-gc.ts`, `src/core/code/count/parser.ts`; the bundle `plugins/claude-code/dist/cli/squeal.mjs` for the profiler's line numbers.
- Research: `../../011-core/research/daemon-memory.md` (011-53); spec 021 D8 and D20; `../status.md`, 2026-11-12.
- Probes: `probes/daemon-heap/` (README lists each script and log). cezar at `cc3cead4b`.
