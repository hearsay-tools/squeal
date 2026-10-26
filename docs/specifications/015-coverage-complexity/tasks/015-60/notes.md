# 015-60 notes: the writer-feed timing bound

Worker 7c66d45b, 2026-10-26. Brief: `tasks/wave-11.md` W1. Shape: repair. Starts from main at `edb138161`. Only `test/code/coverage/writer-feed.test.ts` changed. `test/code/pass/turns.ts` is reused as it is. No `src/` change.

## What changed

The case "reconciles 2000 tracked paths within 3x its time while payloads are stored" bounded the reconciliation pass's wall time beside 12 payloads at 3x its time alone. It is now "reconciles 2000 tracked paths while payloads are stored, with no payload mapped in a main-thread turn". It bounds the main thread's CPU time in its longest turn (`TurnLog.longestWork`, as `chain-load.test.ts` does on CI) from `writer.collected` to `writer.idle`. The bound is half of one payload's map time on the main thread (`TURN_SHARE`), which `heavy()` now measures as thread CPU time beside the wall time. The pass still runs while the writer has payloads in hand (`busy`), and the log line keeps the pass's wall time alone and beside. It adds the payload's thread time, the most work in a turn, the bound, and each long turn's phase, GC pauses and transactions (`TurnLog.summary`). The same bound applies on CI and off CI. The assertion skips above load 8, as before; CI always asserts.

The wall-time ratio is retired, not widened. It is the weaker check: it failed on CI noise, and it does not fail when a payload is mapped on the main thread and paced (below).

## CI values of the old line (`reconciliation pass over 2000`)

Every Node 22 job run of the case on GitHub's runners from its first landing (`cand/0.1.305`, 2026-10-25 03:13Z) to main `d059311a6` (2026-10-26 01:56Z): 89 job runs of 103 run attempts on main and `cand/*`. The other 14 attempts are 7 reruns that did not run this job again (their log repeats the earlier attempt's line, counted once), 6 runs from before the test was on their branch, and 1 cancelled run. Collected with `gh run view <id> --attempt <n> --log`, one line each. Times in ms; "payload map" is `heavy()`'s wall time for one payload on the main thread; load is the value the test read.

- Beside / alone: 0.94x to 3.10x, median 1.62x, 90th percentile 2.25x. One run in 89 at 3x or more (the failure, main CI 40246921578 attempt 1), six at 2.5x or more.
- The pass alone: 44 to 148 ms. Beside: 75 to 288 ms. A payload's map: 260 to 517 ms. Load: 3.2 to 7.6.
- The pass alone took at most 0.34 of one payload's map time (median 0.26).

So a 3x ratio fails about once in 90 runs from noise alone. Its noise is the pass's wait for a CPU while the writer's worker thread maps on the runner's 4 vCPUs, and the pass's own 44 to 148 ms spread from run to run.

| Job time (UTC) | Run | Attempt | Branch | Alone | Beside | Beside / alone | Payload map | Alone / payload | Load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-25 03:13 | 40157003577 | 1 | cand/0.1.305 | 74 | 192 | 2.59 | 294 | 0.25 | 4.3 |
| 2026-10-25 04:18 | 40160870418 | 1 | cand/0.1.305 | 129 | 167 | 1.29 | 481 | 0.27 | 5 |
| 2026-10-25 07:18 | 40171788853 | 1 | cand/0.1.305 | 105 | 152 | 1.45 | 478 | 0.22 | 5.3 |
| 2026-10-25 07:45 | 40173455688 | 1 | cand/0.1.305-on304 | 125 | 175 | 1.40 | 506 | 0.25 | 4.8 |
| 2026-10-25 08:10 | 40175055145 | 1 | main | 95 | 102 | 1.07 | 479 | 0.20 | 5.4 |
| 2026-10-25 08:21 | 40175824479 | 1 | cand/0.1.307 | 88 | 139 | 1.58 | 267 | 0.33 | 4.4 |
| 2026-10-25 08:59 | 40175055145 | 2 | main | 101 | 99 | 0.98 | 466 | 0.22 | 5.8 |
| 2026-10-25 09:02 | 40177237434 | 1 | main | 139 | 244 | 1.76 | 484 | 0.29 | 7.6 |
| 2026-10-25 09:04 | 40178716292 | 1 | cand/0.1.309 | 99 | 194 | 1.96 | 311 | 0.32 | 4.9 |
| 2026-10-25 09:12 | 40179104316 | 1 | main | 145 | 248 | 1.71 | 442 | 0.33 | 6.7 |
| 2026-10-25 09:15 | 40179304129 | 1 | cand/0.1.308 | 105 | 139 | 1.32 | 443 | 0.24 | 4.8 |
| 2026-10-25 09:30 | 40180324150 | 1 | main | 124 | 249 | 2.01 | 444 | 0.28 | 4.4 |
| 2026-10-25 09:30 | 40178716292 | 2 | cand/0.1.309 | 135 | 179 | 1.33 | 451 | 0.30 | 5.3 |
| 2026-10-25 09:32 | 40180478470 | 1 | cand/0.1.309-on308 | 92 | 165 | 1.79 | 482 | 0.19 | 5.3 |
| 2026-10-25 09:57 | 40182240110 | 1 | main | 133 | 205 | 1.54 | 441 | 0.30 | 5.7 |
| 2026-10-25 10:08 | 40182981859 | 1 | cand/016-21 | 140 | 138 | 0.99 | 443 | 0.32 | 5.4 |
| 2026-10-25 10:24 | 40183823488 | 1 | cand/016-21-r2 | 111 | 219 | 1.97 | 448 | 0.25 | 6 |
| 2026-10-25 10:29 | 40184476863 | 1 | main | 104 | 154 | 1.48 | 330 | 0.32 | 4.8 |
| 2026-10-25 10:37 | 40183823488 | 2 | cand/016-21-r2 | 80 | 147 | 1.84 | 517 | 0.15 | 5.2 |
| 2026-10-25 10:47 | 40185777631 | 1 | main | 80 | 75 | 0.94 | 260 | 0.31 | 5.8 |
| 2026-10-25 11:07 | 40186831643 | 1 | cand/0.1.310 | 121 | 171 | 1.41 | 441 | 0.27 | 4.7 |
| 2026-10-25 11:38 | 40188938137 | 1 | cand/0.1.311 | 89 | 189 | 2.12 | 446 | 0.20 | 4.9 |
| 2026-10-25 12:15 | 40191822741 | 1 | cand/0.1.310 | 88 | 254 | 2.89 | 420 | 0.21 | 5.1 |
| 2026-10-25 12:31 | 40192858488 | 1 | cand/0.1.312 | 129 | 203 | 1.57 | 448 | 0.29 | 5.4 |
| 2026-10-25 13:03 | 40195230990 | 1 | cand/0.1.311 | 134 | 260 | 1.94 | 473 | 0.28 | 5.1 |
| 2026-10-25 13:10 | 40195874433 | 1 | cand/0.1.313 | 82 | 109 | 1.33 | 383 | 0.21 | 5.7 |
| 2026-10-25 13:33 | 40197665118 | 1 | cand/w37-tests | 81 | 220 | 2.72 | 312 | 0.26 | 5.1 |
| 2026-10-25 13:45 | 40198496629 | 1 | cand/0.1.313-r2 | 85 | 138 | 1.62 | 492 | 0.17 | 4.6 |
| 2026-10-25 13:45 | 40198595917 | 1 | main | 89 | 151 | 1.70 | 285 | 0.31 | 4.6 |
| 2026-10-25 13:48 | 40198689897 | 1 | cand/w37-tests | 115 | 157 | 1.37 | 418 | 0.28 | 4.7 |
| 2026-10-25 13:55 | 40199245081 | 1 | cand/0.1.313-r3 | 86 | 183 | 2.13 | 387 | 0.22 | 5.8 |
| 2026-10-25 14:00 | 40199562602 | 1 | main | 116 | 154 | 1.33 | 484 | 0.24 | 5.3 |
| 2026-10-25 14:00 | 40199679741 | 1 | main | 74 | 107 | 1.45 | 308 | 0.24 | 5.4 |
| 2026-10-25 14:04 | 40199739209 | 1 | cand/0.1.312 | 97 | 91 | 0.94 | 446 | 0.22 | 4.3 |
| 2026-10-25 14:17 | 40200850173 | 1 | cand/0.1.313-r4 | 129 | 179 | 1.39 | 460 | 0.28 | 5.7 |
| 2026-10-25 14:29 | 40201908054 | 1 | main | 58 | 126 | 2.17 | 324 | 0.18 | 4.9 |
| 2026-10-25 14:39 | 40202581069 | 1 | cand/0.1.313-r5 | 131 | 201 | 1.53 | 484 | 0.27 | 6 |
| 2026-10-25 14:50 | 40203457959 | 1 | cand/0.1.315 | 127 | 244 | 1.92 | 459 | 0.28 | 5.3 |
| 2026-10-25 14:56 | 40203875227 | 1 | main | 121 | 186 | 1.54 | 443 | 0.27 | 5.1 |
| 2026-10-25 15:00 | 40204368686 | 1 | cand/0.1.314 | 83 | 141 | 1.70 | 372 | 0.22 | 5.2 |
| 2026-10-25 15:53 | 40208425790 | 1 | main | 141 | 287 | 2.04 | 438 | 0.32 | 6.2 |
| 2026-10-25 15:58 | 40208652575 | 1 | cand/0.1.316 | 102 | 193 | 1.89 | 297 | 0.34 | 5 |
| 2026-10-25 16:35 | 40211548189 | 1 | cand/0.1.317 | 127 | 229 | 1.80 | 444 | 0.29 | 6.4 |
| 2026-10-25 16:40 | 40212162098 | 1 | main | 78 | 110 | 1.41 | 418 | 0.19 | 4.7 |
| 2026-10-25 16:41 | 40212312386 | 1 | cand/0.1.317-on316 | 93 | 170 | 1.83 | 306 | 0.30 | 4.6 |
| 2026-10-25 16:55 | 40213422421 | 1 | cand/0.1.318 | 81 | 115 | 1.42 | 266 | 0.30 | 4.1 |
| 2026-10-25 17:01 | 40212162098 | 2 | main | 82 | 208 | 2.54 | 271 | 0.30 | 4.2 |
| 2026-10-25 17:12 | 40214708998 | 1 | main | 89 | 177 | 1.99 | 341 | 0.26 | 5.1 |
| 2026-10-25 17:26 | 40215803322 | 1 | cand/0.1.318-on317 | 128 | 288 | 2.25 | 491 | 0.26 | 5.3 |
| 2026-10-25 17:54 | 40218024972 | 1 | main | 148 | 235 | 1.59 | 433 | 0.34 | 5.7 |
| 2026-10-25 17:56 | 40218228860 | 1 | cand/0.1.319 | 116 | 193 | 1.66 | 419 | 0.28 | 5.6 |
| 2026-10-25 17:59 | 40218375556 | 1 | cand/0.1.320 | 100 | 144 | 1.44 | 451 | 0.22 | 6.6 |
| 2026-10-25 18:10 | 40219383049 | 1 | main | 77 | 127 | 1.65 | 357 | 0.22 | 4.9 |
| 2026-10-25 18:13 | 40219557279 | 1 | cand/0.1.321 | 99 | 178 | 1.80 | 428 | 0.23 | 6 |
| 2026-10-25 18:39 | 40221606848 | 1 | main | 124 | 225 | 1.81 | 490 | 0.25 | 4.8 |
| 2026-10-25 18:43 | 40221844086 | 1 | cand/0.1.320-on319 | 134 | 208 | 1.55 | 429 | 0.31 | 6.5 |
| 2026-10-25 19:09 | 40224062037 | 1 | main | 73 | 190 | 2.60 | 281 | 0.26 | 5.2 |
| 2026-10-25 19:11 | 40224266354 | 1 | cand/0.1.321-on320 | 86 | 132 | 1.53 | 388 | 0.22 | 5 |
| 2026-10-25 19:17 | 40224569463 | 1 | main | 99 | 141 | 1.42 | 469 | 0.21 | 5.2 |
| 2026-10-25 19:24 | 40225321737 | 1 | main | 77 | 104 | 1.35 | 320 | 0.24 | 4.4 |
| 2026-10-25 20:01 | 40228149334 | 1 | cand/0.1.322 | 127 | 206 | 1.62 | 482 | 0.26 | 5.1 |
| 2026-10-25 20:08 | 40228793476 | 1 | main | 90 | 189 | 2.10 | 269 | 0.33 | 5.3 |
| 2026-10-25 20:29 | 40230385631 | 1 | cand/0.1.323 | 108 | 226 | 2.09 | 366 | 0.30 | 6.1 |
| 2026-10-25 20:38 | 40230667402 | 1 | cand/0.1.324 | 127 | 139 | 1.09 | 442 | 0.29 | 5.4 |
| 2026-10-25 21:16 | 40233841099 | 1 | main | 133 | 139 | 1.05 | 412 | 0.32 | 4.8 |
| 2026-10-25 21:17 | 40234052493 | 1 | cand/0.1.325 | 133 | 139 | 1.05 | 469 | 0.28 | 6 |
| 2026-10-25 21:33 | 40235485577 | 1 | cand/0.1.324-r2 | 81 | 186 | 2.30 | 279 | 0.29 | 4.4 |
| 2026-10-25 21:57 | 40237273229 | 1 | cand/0.1.326 | 137 | 237 | 1.73 | 469 | 0.29 | 5.1 |
| 2026-10-25 22:13 | 40238478222 | 1 | main | 44 | 98 | 2.23 | 421 | 0.10 | 5.3 |
| 2026-10-25 22:18 | 40238859639 | 1 | cand/0.1.326-015 | 100 | 161 | 1.61 | 444 | 0.23 | 5.7 |
| 2026-10-25 22:18 | 40238718060 | 1 | cand/0.1.326-on325 | 122 | 190 | 1.56 | 439 | 0.28 | 5 |
| 2026-10-25 22:33 | 40240147489 | 1 | main | 101 | 217 | 2.15 | 426 | 0.24 | 5.5 |
| 2026-10-25 22:40 | 40240677277 | 1 | main | 70 | 98 | 1.40 | 346 | 0.20 | 4.4 |
| 2026-10-25 22:51 | 40241273203 | 1 | main | 75 | 148 | 1.97 | 356 | 0.21 | 4 |
| 2026-10-25 22:51 | 40241353406 | 1 | cand/0.1.327-land | 84 | 193 | 2.30 | 419 | 0.20 | 4.5 |
| 2026-10-25 23:07 | 40242542198 | 1 | main | 113 | 177 | 1.57 | 493 | 0.23 | 5.3 |
| 2026-10-25 23:18 | 40243565049 | 1 | cand/0.1.328 | 79 | 148 | 1.87 | 266 | 0.30 | 3.7 |
| 2026-10-25 23:42 | 40245092672 | 1 | cand/0.1.329 | 85 | 169 | 1.99 | 448 | 0.19 | 4.2 |
| 2026-10-25 23:50 | 40245490772 | 1 | cand/0.1.328 | 60 | 118 | 1.97 | 320 | 0.19 | 3.2 |
| 2026-10-26 00:02 | 40246921578 | 1 | main | 78 | 242 | **3.10** (fail) | 368 | 0.21 | 3.9 |
| 2026-10-26 00:09 | 40247275467 | 1 | cand/0.1.329 | 125 | 149 | 1.19 | 510 | 0.25 | 5.5 |
| 2026-10-26 00:17 | 40246921578 | 2 | main | 135 | 161 | 1.19 | 490 | 0.28 | 5.1 |
| 2026-10-26 00:32 | 40249129483 | 1 | main | 126 | 174 | 1.38 | 434 | 0.29 | 5.3 |
| 2026-10-26 00:49 | 40250531932 | 1 | main | 115 | 228 | 1.98 | 433 | 0.27 | 4.8 |
| 2026-10-26 01:13 | 40252500251 | 1 | cand/0.1.330 | 85 | 161 | 1.89 | 383 | 0.22 | 4.7 |
| 2026-10-26 01:36 | 40254284490 | 1 | cand/0.1.330-r2 | 124 | 168 | 1.35 | 438 | 0.28 | 5.2 |
| 2026-10-26 01:48 | 40255393361 | 1 | main | 66 | 138 | 2.09 | 337 | 0.20 | 4.6 |
| 2026-10-26 01:56 | 40255524372 | 1 | cand/0.1.331 | 123 | 170 | 1.38 | 478 | 0.26 | 5.9 |
| 2026-10-26 01:56 | 40255633641 | 1 | main | 136 | 169 | 1.24 | 466 | 0.29 | 5 |

## Red first: a payload mapped on the main thread

Each local run is a Squeal run of the file after an edit; I ran no Vitest directly. I made three edits; Squeal ran the red case a second time to confirm it, so the case ran four times. Load is `uptime`'s one-minute value at the edit; "test" is the load the test read. Other sessions' work raised the host's load to 41.8 before run 4; I made no load of my own.

| Code | Run | Pass alone / beside | Payload map (wall / thread) | Most work in a turn | Bound | Result | Load (uptime / test) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| this branch, worker thread (`TS_WORKER`) | 1 | 66 / 97 ms (1.5x) | 344 / 307 ms | no turn over 50 ms | 153 ms | pass | 2.94 / 3.6 |
| same, `worker: null` (the writer maps each payload on the main thread, paced), not committed | 2 | 80 / 82 ms (1.0x) | 365 / 349 ms | 269 ms (turns of 292, 271, 255 ms wall; 269, 249, 243 ms thread) | 175 ms | **fail**: expected 269 to be less than 174.5 | 4.73 / 5.3 |
| same, Squeal's confirmation of the failure (it runs a new failure again) | 3 | 60 / 78 ms (1.3x) | 311 / 305 ms | 246 ms (turns of 252, 247, 231 ms wall; 246, 237, 226 ms thread) | 152 ms | **fail**: expected 246 to be less than 152.411 | 4.73 / 5.2 |
| this branch, final text (comments only changed from run 1) | 4 | 140 / 133 ms (0.95x) | 421 / 394 ms | no turn over 50 ms | 197 ms | skip: load above 8 | 41.76 / 40.7 |

The `worker: null` run is the writer's own fallback: without a worker script, or after a worker failed, it maps each payload on the main thread and gives the same time back before the next. Each map held one turn of 0.70 to 0.81 of `heavy()`'s thread time, so the bound fails by 1.5x to 1.6x. The old 3x ratio passed both runs (1.0x and 1.3x): the pass fits between two paced maps. The 0.1.301 shape (no pacing, one `setImmediate` between payloads) holds the same one turn per payload, so it fails the bound the same way; the old ratio read 12.4x on main after 0.1.302, before the worker (`tasks/015-42/notes.md`). I did not rebuild that shape in `src/`: the brief allows no `src/` change, and the per-turn work is the same.

## Margin on CI

- **The defect side.** A main-thread map is the same work as `heavy()`'s measured map, on the same thread, measured a moment before. Its longest turn held 0.77 and 0.81 of `heavy()`'s thread time here, so the share depends little on the machine's speed. Thread CPU time does not count the time the thread waits for a CPU, so a busy 4-vCPU runner does not move it much.
- **The good side.** CI does not log thread time yet, so this side is inferred from the old line. On CI the whole pass alone took at most 0.34 of one payload's map wall time (44 to 148 ms against 260 to 517 ms). The bound is half of the map's thread time; here thread time was 0.89 to 0.98 of wall time, so the bound is about 0.45 of the wall time. So the bound holds even if the whole pass were one turn of CPU. It is not one turn: the pass waits for `git status` and the commits' listing in child processes, and here no turn over 50 ms was seen in the whole window. Other main-thread work in the window (the sources posted to the worker, each record's store, GC) also held no turn over 50 ms here, at load 3.6 and at load 40.7.
- **What CI shows next.** The new line names the most work in a turn and each long turn's phase, so the first CI runs give the good side's real values. If one comes near the bound, its phase and transactions name the cause.

## Decisions the brief did not settle

1. **Thread CPU time on and off CI.** `chain-load.test.ts` keeps a wall-time bound off CI and the thread-time bound on CI. Here one bound serves both, because it is relative to the payload's own map time, measured on the same machine a moment before.
2. **The window.** From `collected` to `idle`, not the pass alone. A paced main-thread map can fall between the pass's turns, so a window of the pass alone can miss it; every payload is mapped inside the whole window.
3. **The name.** The case's name no longer says "within 3x its time", so its check is new to Squeal and CI.

## For the next worker

- After the first CI runs, read the line's "most work in a turn" against its bound. Raise nothing unless a long turn's phase shows main-thread work that is not a payload's map.
