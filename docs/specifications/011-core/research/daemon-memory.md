# 011-53: give a quiet daemon's memory back

Researcher, 2026-10-21. Brief: `daemon-memory-brief.md`. Host: 24 CPUs, Linux 6.8.0-147, Node v24.21.0 (V8 13.6.233.17-node.53). Installed Squeal 0.1.236 bundle, copied. A shallow clone of cezar at `223da50` in `/tmp/dm-*`: Vitest 4.1.10, Vite 8.1.4, Rolldown 1.1.5, 829 test files (771 Vitest, 58 node:test). Pool capped at 4 slots, slow lane off. My own daemon ran with `HOME`, `XDG_*` and `TMPDIR` under `/tmp`. No live socket or store was opened, and no live process was signalled. Probes and logs: `probes/daemon-memory/` (throwaway, README there). The load is given beside every number.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | A quiet daemon on its own | Yes, in part. About 2 minutes after its last tier, V8's memory reducer shrank the heap mappings from 452 to 188 MiB and private memory from 892 to 625 MiB. It held there: 620, 627 and 629 MiB at 5, 15 and 30 minutes. The next edit took it back to 850 MiB at once. Rolldown's mimalloc (320 MiB), glibc (47 MiB) and the live graph stay. Swap stayed 0. | verified by experiment |
| 2 | A forced full GC | A plain `gc()` frees heap (383 → 191 MiB used) in a 43 to 85 ms pause, but private memory falls by only 0 to 7 MiB. V8 pools the freed pages. `gc({flavor: "last-resort"})` gives them back: 791 → 486 MiB private (−305 MiB, −39%) in 154 to 234 ms. The live heap of one cezar instance is 125 to 200 MiB. Native memory does not move: mimalloc 215 to 320 MiB, glibc 13 to 50 MiB. | verified by experiment |
| 3 | Closing Vitest when quiet | It gives nothing back, and each reopen leaks. After `vitest.close()` and a GC, private memory stays at 741 MiB (bare Node: 45 MiB). Each closed instance stays reachable with its whole module graph, through a global handle Rolldown's native resolver keeps on a Vite callback. Over three close-and-reopen cycles, the live heap grew 154 → 277 → 393 → 508 MiB and private memory 741 → 1,759 MiB. A cold edit took 12.6 to 15.6 s against 1.8 to 2.1 s warm (script). In the daemon, warm edits took 2.7 to 4.6 s; the cold case is not determined there. | verified by experiment; the retainer read in source code |
| 4 | Policy and saving | No close in the process. A last-resort GC once the daemon has been idle for 60 s, not after each tier. For the rest, exit when quiet. No heap cap. On the 2026-10-21 population, the GC saves 0.9 to 2.0 GiB on the 7 quiet daemons and up to 3.7 to 6.8 GiB when every daemon goes idle; an exit after 30 min quiet saves 5.7 GiB. The GC costs the next edit nothing. An exit costs it a restart: 16 to 25 s before the new daemon takes an edit. Under `lookup-only`, an edit made while the daemon starts is not run at all. | inferred from the measurements; the restart verified by experiment |

## 1. A quiet daemon on its own

Run 3 (`logs/run3-*`, 12:42Z on, load 16.7 to 29.4): an empty store, `baseline.onStart: lookup-only` as cezar sets it, then edits of three test files. *Verified by experiment.*

| Point | Load | Private | JS heap mappings | mimalloc | glibc | heapUsed / heapTotal | new space |
|---|---|---|---|---|---|---|---|
| Probe start | 23.4 | 15 | – | – | – | 8 / 12 | 4 |
| Baseline (listed and keyed, nothing run) | 21.4 | 859 | 452 | 313 | 20 | 287 / 447 | 128 |
| T1 server test, 4,983 ms | 21.8 | 884 | 452 | 320 | 37 | 383 / 474 | 128 |
| T2 web (jsdom) test, 3,248 ms | 18.7 | 890 | 452 | 320 | 46 | 320 / 452 | 128 |
| T3 contract test, 4,758 ms | 17.3 | 903 | 452 | 320 | 58 | 191 / 409 | 128 |
| Quiet 1 min | 20.7 | 891 | 452 | 320 | 47 | 203 / 381 | 128 |
| Quiet 2 min (12:46:34Z, the reducer) | 19.9 | 625 | 188 | 320 | 47 | 178 / 222 | 1 |
| Quiet 5 min | 29.4 | 620 | 183 | 320 | 47 | 180 / 209 | 4 |
| Quiet 15 min | 16.9 | 627 | 190 | 320 | 47 | 180 / 210 | 4 |
| Quiet 30 min | 27.8 | 629 | 191 | 320 | 47 | 185 / 211 | 4 |
| First edit after the quiet, 4,562 ms | 27.6 | 850 | 412 | 320 | 47 | 215 / 417 | 128 |

MiB throughout. "JS heap mappings" are the 256 KiB anonymous mappings (014-02 method). The new space holds 128 MiB on this host by default. It is empty after every scavenge, but its pages stay resident until the reducer shrinks it (`v8-ns.cjs`: 128 MiB at heap limit 4,288 MiB; 32 MiB with `--max-semi-space-size=16`).

- **The reducer acts only when the daemon is idle.** In run 1 (`logs/run1-*`), an edit of `model-identity.ts` queued 235 files, and a 200-file tier ran until the 600 s run timeout at load 38 to 80. Through those 20 minutes, the heap mappings stayed at 448 MiB, and the daemon at 720 to 785 MiB. Its test processes held 0.75 to 1.1 GiB more. *Verified by experiment.*
- **In an idle bare process it never acts.** `v8-ns2.cjs` with `--trace-memory-reducer` logged "high alloc, foreground ... waiting for 8000 ms" for 90 s and gave nothing back (206 MiB of mappings resident, heapTotal 139 MiB). The daemon's own timers allocate a little, so its reducer saw a low allocation rate. *Verified by experiment; the reason inferred.*
- **Up to 32 minutes only.** A slow growth over hours, and what the 011-52 daemons held at 800 to 1,237 MiB of heap mappings, are not determined. Section 3 names a likely cause.

## 2. A forced full GC

| Probe | Load | Before | After a regular GC | After a last-resort GC | Pause |
|---|---|---|---|---|---|
| Run 1 daemon after the 200-file tier | 70.5 | 785 MiB, heapUsed 211 | 785, heapUsed 204 | – | 85 ms |
| Run 3 daemon after T1 | 20.1 | 884, heapUsed 383 | 877, heapUsed 191 | – | 43 ms |
| Run 3 daemon, quiet 30 min (after the reducer) | 27.8 | 629, heapUsed 185 | 629, heapUsed 177 | – | 57 ms |
| `last-resort.mjs`: one instance, all 771 files walked, one run | 22.1 | 791, heapUsed 274 | 791, heapUsed 146 | 486, heapUsed 126, mappings 409 → 110 | 36 / 154 ms |
| Same with `MIMALLOC_PURGE_DELAY=0` | 22.4 | 717 | 717 | 398, mappings 430 → 116 | 53 / 234 ms |
| `v8-flavor.cjs`, bare Node | 25.4 | 213 | 170 | 19 | 23 / 85 ms |

*Verified by experiment* (`logs/run1-inside.jsonl`, `run3-inside.jsonl`, `last-resort*.jsonl`, `v8-flavor.txt`, `v8-release.txt`).

- **The live set.** heapUsed after a full GC: 191 to 204 MiB in the daemon, 126 MiB in the script (no daemon state). Old space holds 145 to 155 MiB of it, large objects 37 MiB.
- **A plain GC returns almost nothing to the system.** V8 frees the objects and pools the pages. `--no-decommit-pooled-pages`, `--single-threaded-gc` and a 256 MiB `--max-old-space-size` do not change this. The pages go back with the memory reducer's GC, with `gc({flavor: "last-resort"})` (`CollectAllAvailableGarbage`, *inferred* from its effect), or under `--memory-saver-mode` / `--optimize-for-size`, which keep the heap small throughout at a CPU cost not measured (`v8-release.txt`).
- **The last-resort GC beats the reducer.** It took the mappings to 110 to 116 MiB, against 183 to 188 MiB after the reducer, because it also compacts old space.
- **Native memory.** mimalloc held 179 to 330 MiB across runs (Rolldown 1.1.5 links mimalloc and reads `MIMALLOC_*` options: `strings` on its `.node`). No GC moved it, nor did `close()`. With `MIMALLOC_PURGE_DELAY=0` it peaked at 215 MiB against 308 MiB without. One run each, inside the spread between runs: not determined. glibc `[heap]`: 13 to 58 MiB, not moved.
- **The pause** is 36 to 234 ms at load 20 to 22: under the 3.2 to 5.0 s an edit's tier took.

## 3. Closing the Vitest instance when quiet

`close-reopen.mjs` (`logs/close-reopen.jsonl`, load 18.0 to 20.5) on a copy of the clone: one instance with the adapter's options at 4 workers, the keying walk, warm edits, then close, GC and three cold edits. *Verified by experiment.*

| Step | Private | heapUsed after GC | heap mappings | mimalloc |
|---|---|---|---|---|
| Bare Node, Vitest imported | 45 | 16 | 22 | 4 |
| Instance started, 771 files listed (327 ms) | 116 | 23 | 37 | 57 |
| Keying walk: 82,958 module visits, 17.2 s | 728 | 145 | 397 | 262 |
| After 4 edits (warm) | 740 | 153 | 399 | 261 |
| `close()` + GC, +5 s | 741 | 154 | 399 | 261 |
| Cold edit 1, then `close()` | 1,261 | 277 | 878 | 254 |
| Cold edit 2, then `close()` | 1,630 | 393 | 1,205 | 267 |
| Cold edit 3, then `close()` | 1,759 | 509 | 1,301 | 270 |

- **Why nothing is freed.** `leak-check.mjs` counted the live objects after each close and two GCs: `Vitest` 1 → 2 → 3, `TestProject` 6 → 12 → 18, module nodes 347 → 694 → 1,041 (`logs/leak-check.jsonl`). The process listeners do not grow. A heap snapshot after two closed instances gives each one the same retainer path: GC roots → global handles → `onWarn` → its context `partialEnv` → `_options.plugins` → a plugin's `resolveId` → its context `ctx` = the `Vitest`. *Verified by experiment.* Vite 8.1.4 creates that `onWarn` for Rolldown's native `viteResolvePlugin` (`vite/dist/node/chunks/node.js:32100`). *Read in source code.* That the native side never releases the callback's handle is *inferred* from the path; whether a newer Vite or Rolldown fixes it is not determined.
- **Squeal leaks the same way today.** `#recreate` (`adapter.ts`) closes and starts an instance in the same process on every config or install change and every pending touch of a file it read (013-02). The slow lane closes its instance when it drains (`slow-instance.ts`, 004 D2). Each of these keeps a closed instance alive. I could not measure it in a daemon: the touch that forced run 3's recreate also queued the 235 test files that import the touched file, and I stopped the run. *Inferred* from the script and the source, for recreates and the slow lane alike. This is a likely cause of the 011-52 daemons at 800 to 1,237 MiB of heap mappings, against 452 MiB at most here. Not determined.
- **The cold edit's cost.** In the script, a warm edit took 1.8 to 2.1 s: the related walk (Vitest's `getRelevantTestSpecifications`) 1.5 to 1.7 s, the run 0.26 to 0.39 s. A cold edit took 12.6 to 15.6 s: create, standalone and list 65 to 330 ms, the related walk 12.2 to 15.2 s, the run 0.24 to 0.29 s. The walk transforms every test file's imports again. In the daemon, from the edit to `squeal status --wait` returning, warm edits took 2.7 to 4.6 s at load 25.8 to 27.6 (`logs/run3-edits.tsv`). *Verified by experiment.* A cold edit in the daemon is not determined, for the reason above.

## 3b. What an exit costs the next edit

`exit-cost.sh`, *verified by experiment*:

- **Restart.** The socket was up 324 to 439 ms after the start (load 24.4 to 28.2, `logs/exit-cost-edit-first.txt`). In run 3, the daemon had listed and keyed all 829 files within 16 s of its start (load 21.4; status was polled every 5 s), and its first edit then took 5.0 s.
- **An edit made while the daemon starts is not run.** Three times, the test file was edited right after the start, as when a hook spawns the daemon after an edit. Each time, `squeal status --wait` returned when the baseline settled, 18.8 to 24.8 s after the start (load 24.4 to 28.2), with "1 last passed at other inputs, nothing queued it (the baseline is lookup-only)" (`logs/exit-cost-edit-first-status-*.txt`). That C4's `lookup-only` start takes the edit for part of the baseline is *inferred* from that line.
- **A second repetition with the edit after the baseline was not measured.** The restarted daemon picked up the 230 files that run 3's touch had queued (section 3) and ran them, so its baseline never settled before 13:35Z, the end of the budget.

## 4. Policy and saving

The population is 011-52's 09:28Z snapshot: 19 daemons, 14,670 MiB private and 970 MiB swap, 8,984 MiB in heap mappings. `estimate.py`, `logs/estimate.txt`. *Inferred from the measurements above.*

| Policy | All 19 | The 7 quiet 30+ min | Cost to the next edit |
|---|---|---|---|
| Nothing: V8's reducer after ~2 min idle (mappings → 190) | 5.9 GiB, if every daemon goes idle | 1.7 GiB | none |
| Last-resort GC when idle (mappings → the live heap: 126 / 250 / 400 MiB) | 6.8 / 5.2 / 3.7 GiB | 2.0 / 1.4 / 0.9 GiB | none; a 150 to 230 ms pause in an idle daemon |
| Close Vitest in the process | 0, and it grows | 0 | +10 to 13 s, and up to +520 MiB per cycle |
| Exit after 30 min quiet | – | 5.7 GiB (with swap; test processes on top) | a restart: the socket in 0.3 to 0.4 s, the baseline in 16 to 25 s (load 21 to 28); the edit that brings the daemon back is not run under `lookup-only` |
| Heap cap | 1.3 to 2.9 GiB (011-52) | – | an OOM crash when the leak passes it |

The 250 and 400 MiB rows allow for a second, slow-lane instance and for leaked instances. The 7 quiet daemons of 011-52 still held 303 to 837 MiB of heap mappings after 30 to 148 minutes. They all waited on the slow lane, so they were not idle to V8, or they held leaked instances. Which one is not determined.

## Recommendation for Squeal

1. **Never close and reopen Vitest in the daemon's process as a memory measure.** With Vitest 4.1.10, Vite 8.1.4 and Rolldown 1.1.5, it gives nothing back, it leaks a full instance per cycle, and it costs the next edit 10 to 13 s. The same leak already follows every `#recreate` and every slow-lane drain. It deserves its own row: a recreate-count and heap field in the ping, a report upstream, and a check of a newer Vite and Rolldown.
2. **Run `gc({type: "major", execution: "sync", flavor: "last-resort"})` once when the daemon goes idle**: no tier running and nothing queued for 60 s. Not after each tier: the next tier regrows the space at once, and the reducer acts on its own about 2 minutes later. The daemon needs `--expose-gc` in the hook's spawn, or `v8.setFlagsFromString("--expose-gc")` before the first `gc` lookup. Saving: 0.9 to 2.0 GiB on the 7 quiet daemons, up to 6.8 GiB when all go idle. Over what the reducer already does when it acts, it adds about 75 MiB per daemon (heap mappings 188 → 110), and it does not wait for V8 to judge the daemon idle, which the 7 quiet daemons of 011-52 show it may not do. Cost: one pause of 150 to 230 ms, nothing for the next edit.
3. **For the rest (mimalloc, the live graph, leaked instances: 400 to 500 MiB per daemon), exit when quiet.** The C9 and 004 D2 lifecycle fixes of 011-52 (a) apply. A quiet daemon that exits after 30 minutes saves 5.7 GiB on that population, and the next edit pays a restart: 16 to 25 s on cezar. Under `lookup-only` (cezar's policy), the edit that brings the daemon back is left stale and is not run (3 of 3), so an exit rule needs that edit queued, or it trades memory for a missed verdict. A runner child per worktree would save the same and keep the daemon. Both are larger designs.
4. **No heap cap.** The live heap of one instance is 125 to 200 MiB, so a cap would not save memory. With the recreate leak, a cap turns a slow leak into an OOM crash.

## Open questions

- Whether a newer Vite or Rolldown releases the native resolver's callback; and the leak's size in a live daemon after hours of recreates and slow passes.
- What `--max-semi-space-size=16` (new space 128 → 32 MiB) or `--memory-saver-mode` cost a daemon in CPU and in tier time. Not measured in a daemon.
- Whether mimalloc purge options lower Rolldown's 180 to 330 MiB: one run each, inside the spread.
- Memory past 32 minutes of quiet, and with the slow lane on. macOS: not examined.
- Limits: one host, one cezar commit, 32 minutes of quiet. The load rose above 24 during run 1 (38 to 80), the warm daemon edits (25.8 to 27.6) and the restarts (24.4 to 28.2); the load is stated beside each number.
- The edit's time after a restart with the edit after the baseline, and why a touch of `model-identity.ts` (same bytes) queued its 235 importers, and why that queue survived a restart.

## Sources

- Squeal source at `75eb621b1`: `src/runners/vitest/adapter.ts` (`#start`, `#recreate`, `close`), `related.ts`, `graph.ts`, `src/core/daemon/slow-instance.ts`, `runner.ts`, `scratch.ts`, `paths.ts`, `src/core/slow/slot.ts`, `src/core/capacity/pool.ts`, `src/core/scheduler/refinement.ts`; spec 011 C4, C9, C10.
- Research: `daemon-scope.md` 1 and 3 and `probes/daemon-scope/snapshot-1.json`; `../../014-ps/research/process-measurement.md` 2.
- Vite 8.1.4: `node_modules/.pnpm/vite@8.1.4_…/node_modules/vite/dist/node/chunks/node.js` lines 32035 to 32107 (`viteResolvePlugin`, `onWarn`). Rolldown 1.1.5: `@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node` (mimalloc option names). Vitest 4.1.10: `dist/node.js`.
- Node v24.21.0: `node --v8-options` (memory reducer, pooled pages, semi-space, memory saver flags).
- Probes: `probes/daemon-memory/` (README lists each script and log).
