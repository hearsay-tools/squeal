# 009-31: where a fresh Pi delivery worker spends its first call

Wave 20 W3 of spec 011, worker a6a03320, from main 56c542f86 (0.1.272). Shape: survey, then repair. Spec 009 D4: "Wave 0 measures the worker's round trip per tool call against 002's 80 ms p95."

## Answer

The cause is the worker's start, made worse by two things this host and the test add. The load guard explains the large miss (144.5 ms), not the small ones (80.9 ms).

A fresh worker's first call is CPU work. It is 60 to 65 ms of CPU on a quiet host, with 1 to 2 ms of waiting. So the 80 ms bound left 15 to 20 ms for everything else. The phases, from the median of 60 quiet runs:

- Node's start of a worker thread: 22 ms of CPU on its own (a bare `new Worker`, `threadCpuUsage`).
- `NODE_USE_ENV_PROXY=1`: 20 ms of CPU more in every worker's start. This host's agent environment sets it, and the test gave its worker the full `process.env`. A worker without it starts in 22 to 24 ms instead of 43 to 45 ms. About 3 to 6 ms of it comes back in the bundle's load, which then loads modules that the proxy setup had already loaded. A whole `node -e 0` costs 20 to 30 ms more with it as well. 001's and 002's latency tests run their hooks with only `PATH` and `HOME`, so they never paid it.
- The bundle's load and evaluation (`dist/worker.mjs`, 343 KB): 9 to 11 ms with the proxy set, 12 ms without it (15 to 18 ms beside the suite).
- The first `boundary` handler: 8 to 9 ms, against 5 to 6 ms for the same worker's second call (lazy loading and cold code).
- The delivery host, the message to the worker and the answer's way back: under 1 ms together. Nothing in `src/harness/pi/host.ts` is a phase worth removing, so it is unchanged.

Two things put the slowest of 10 fresh workers, which was the p95, over 80 ms:

1. **The test kept every fresh worker alive.** In a process that holds live workers with the bundle loaded, the start of the 7th worker (run 5, the latency test's 6th fresh worker) and of the 20th waited off the CPU: a median of 11.9 and 12.5 ms (wall time minus CPU time, 21 runs each; 5 to 34 ms over the 42), against 0.8 ms for the other 378 runs. This happened in every round, quiet and loaded. With one worker at a time, as Pi holds it (`discard` terminates the old worker before the next call starts a new one), runs 5 and 18 waited 0.8 ms, as the rest (220 runs). Bare workers kept alive (no bundle) did not show it in two quiet rounds of 22. The kernel or allocator event behind it is not pinned. It is the test's, not Pi's.
2. **The host under a full suite.** Beside a locked full suite, the threads wait for a CPU (wait p95 8 to 18 ms, up to 42 ms), and the same work also takes more CPU time: the boot took up to 85 ms of CPU against 43 ms quiet. This host is a 24-vCPU KVM guest on a 16-core Ryzen 9 5950X, so busy vCPUs share physical cores. Other coordinators' work kept the load at 5 to 17 for most of the first suite and took it to 43 in the second.

The load guard read the one-minute load once, after the runs. Two kinds of miss follow:

- At a load the guard rightly calls calm, the misses are the start's cost plus items 1 and 2. The 80.9 ms miss (load 3 to 5 in 011-122's suite) and my reproduction (86.1 ms, load 2.2) are of this kind; at load 4 or less, 3 of 40 fresh workers beside the suite took 80 ms or more.
- At a higher load, the unchanged test's fresh-worker p95 was 74 to 156 ms in 22 runs at loads 5.3 to 15.2 (16 of them at or over 80 ms), with medians up to 124 ms. The 144.5 ms miss (Squeal's run at the clean candidate's revision 0, its baseline) is of this size, so the load during those runs was well above 4 and the guard, read after them, still said calm. That is the guard's gap: a one-minute average lags a burst, such as a baseline's start, by up to a minute. That miss itself is not reproduced.

## Phases and their times

Times in ms per fresh worker. "Boot" is from `new Worker` returning to the wrapper's first line (Node's start of the thread); "bundle" is from there to the end of `import("./worker.mjs")`; "handle" is the first `boundary` handler; "waited" is the round trip minus the worker thread's CPU time. "Live" is how many workers the process holds: "all" as the old test, "one" as Pi and the repaired test.

| Where | Env | Live | Workers | Load (1 min) | Total p50 / p95 / max | Boot p50 (its CPU) | Bundle p50 | Handle p50 | Waited p95 | At or over 80 |
|---|---|---|---|---|---|---|---|---|---|---|
| No suite (quiet) | full | all | 60 | 2.2 to 2.7 | 64.2 / 69.4 / 78.3 | 44.9 (43.3) | 10.4 | 8.5 | 8.9 | 0 |
| Beside the suite | full | all | 40 | 1.8 to 3.2 | 70.2 / 83.8 / 88.6 | 49.5 (47.5) | 11.6 | 9.2 | 16.3 | 3 |
| Beside the suite | full | all | 170 | 5.2 to 15.3 | 75 / 111.2 / 156.5 | 52.2 (50.5) | 11.9 | 9.7 | 16.2 | 59 |
| Beside the suite | full | one | 110 | 7.1 to 12.9 | 66 / 97.8 / 136.4 | 44.4 (44) | 11.3 | 9.2 | 8.6 | 23 |
| Beside the suite | min | all | 150 | 5.2 to 15.3 | 59.6 / 92.7 / 113.3 | 29.4 (28.6) | 18 | 11.4 | 18 | 23 |
| Beside the suite | min | one | 110 | 7.1 to 12.9 | 49.8 / 77.9 / 105.2 | 24.5 (23.9) | 15 | 9.9 | 8 | 5 |
| No suite (quiet), after | full | one | 10 | 3.2 | 54.3 / 69.6 / 69.6 | 37 (35.9) | 9.1 | 7.8 | 2.1 | 0 |
| No suite (quiet), after | min | one | 10 | 3.2 | 42.1 / 45.9 / 45.9 | 20.7 (20) | 12.4 | 8.2 | 1.6 | 0 |

"Env" full is the old test's `process.env`, min is `PATH` and `HOME` only. In 760 fresh workers beside the suite (480 with every worker alive, the environment alternating from round 5; 280 one at a time, alternating throughout; every 4th round plain, below), each condition's two environments ran in the same rounds, so they share the load. The minimal environment saves 15 to 16 ms at the median (the boot 20 to 23 ms less, the bundle 4 to 6 ms more), and one worker at a time saves the 7th and 20th worker's wait. Together, at similar loads, the median falls from 75 to 50 ms and the share at or over 80 ms from 35% to 5%. Beside the suite, the condition the repaired test uses (min, one) has no rows at load 4 or less: the host stayed above 4 from round 5 on, so its rows at 7 to 13 are the upper end of what the test reports without asserting. The two quiet rows "after" are one round at 05:08Z, once both suites had ended and the load fell to 3.2.

The plain rounds start the real `worker.mjs` with no wrapper: 120 workers in the full environment, p50 69.5 ms; 80 in the minimal one, p50 54.2 ms; in the range of the wrapped rows above. So the wrapper adds nothing visible at this resolution.

The latency test itself, unchanged, once per probe round beside the same suite (`data/latency-before-repair.log`): 24 runs, fresh-worker p95 74.4 to 155.6 ms, 17 of them at or over 80 ms. The guard let 2 assert: 86.1 ms at load 2.2 (failed) and 77.8 ms at load 3.2 (passed).

## Repair (commit 45f62ac15)

Test-side only, in `test/harness/pi/latency.test.ts`:

1. The worker gets the minimal environment 001's and 002's hooks get in their latency tests: `PATH`, `HOME`, and the test's own `XDG_RUNTIME_DIR` and `SQUEAL_CLI`. This removes the proxy setup, about 15 ms net.
2. Each fresh worker exits (`terminate()` awaited) before the next starts, as Pi holds one at a time. This removes the stall at the 7th and 20th live worker.
3. `COLD_RUNS` is 20, so the p95 is the 19th of 20 runs, as the 20 cold runs of 001's and 002's tests, and no longer the slowest of 10.
4. The load guard is read before and after the runs, as 001's and 002's tests do; the bound is asserted only when both are calm. The one-minute average moves every 5 s, so for a 3 s test this is all a load average can say about "through the runs".
5. The fresh call delivers (a transition before each run) and checks the text. Before, its answer was not checked, and a worker that dies also answers `null`, so a broken minimal environment could have passed fast.

The bound stays 80 ms: D4's promise is per tool call, and a fresh worker's call is the first tool call after a missed deadline. Repaired, its fresh p95 was 47.7 to 66.2 ms in 20 asserted runs at calm load, and 53.6 to 65.7 ms beside a full suite at load 8.2 or less outside a burst (below). No D4 sentence changes.

## Verification

- First locked full suite, `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` in this worktree at 56c542f86, 04:28:14Z to 04:47:35Z, 1,160 s: 940 files passed, 2 skipped, 0 failed. The probe ran beside it (the phases above). I committed the repair at 04:36Z, so `latency.test.ts` may have run in either form in this suite.
- Second locked full suite, the same command at 45f62ac15 (the repair), 04:47:53Z to 05:07:27Z, 1,173 s: 940 files passed, 2 skipped, 0 failed (7,927 tests passed, 10 skipped).
- Beside the second suite, 20 rounds (`probe/verify-loop.sh`, `data/verify-beside-suite.txt`), each one run of the repaired `latency.test.ts` in this worktree and one of `latency-lifted.test.ts` in the copy (the same test with `MAX_LOAD` lifted, so it asserts at any load):
  - The repaired test: 20 of 20 passed. The host's load was 3.4 to 41 in these rounds (median 9.6 over the suite), mostly from other coordinators' work, so its guard asserted in 1 round (load 3.5, fresh p95 57.0 ms) and reported in 19.
  - The lifted copy: 13 of 20 passed. At a load of 8.2 or less (8 rounds, 3.4 to 8.1) its fresh p95 was 53.6 to 65.7 ms, all passing, but for one round in a burst that took the load from 5.2 to 9.2 within the run (100.5 ms). Above that, 5 rounds at 9.5 to 31.4 passed (54.5 to 67.9 ms) and 6 at 12.2 to 41.4 failed (87.9 to 130 ms). The guard keeps the real test from asserting in each failing round, the burst included, since its load after the runs was above 4.
- After both suites, with no suite running and the load at 1.2 to 3.2 (05:08Z to 05:12Z, `data/verify-calm.txt`), the same 20 rounds: the repaired test passed 20 of 20, all asserted, fresh p95 47.7 to 66.2 ms (median 51.1); the lifted copy 20 of 20, 47.6 to 63.1 ms.
- `npm run lint`: "Checked 1816 files in 479ms. No fixes applied." `npm run typecheck` (`tsc --noEmit`): no output, exit 0.
- `squeal run --all --wait` at revision 27 (45f62ac15 plus these notes): "Checkpoint fb0c49c0 completed at revision 27: no known failures; 922 test files, 922 already current, 0 run now". Squeal's own result for `latency.test.ts` is a PASS at revision 12, the repaired test.

## For the next row

- Pi runs that inherit `NODE_USE_ENV_PROXY=1` pay about 15 ms more per fresh worker: once per session and once per missed deadline. Dropping the variable from the worker's `env` would drop it from the daemon the worker spawns (`ensure` passes `process.env`), and so from the test runs; restoring it inside the worker after its start would need `entries/extension.ts` and `entries/worker.ts`. Not proposed for 15 ms once per session.
- The bundle's load (9 to 18 ms of CPU) is the next phase by size. Node's compile cache (`module.enableCompileCache()`, in the worker entry) might cut it; not measured.
- The load guard still lags a burst by up to a minute. If the 144.5 ms miss recurs in a Squeal baseline, a guard on the CPU pressure (`/proc/pressure/cpu`, `some avg10`), or on the worker's own CPU time (`worker.cpuUsage()`, Node 24 only) against its wall time, would see it; 001's and 002's tests share the same guard, so it would be one change for all three.

## The probe, to run it again

`probe/` holds the tools. `data/` holds one CSV row per fresh worker (`quiet.csv`, `quiet-one-live.csv`, `beside-suite-all-live.csv`, `beside-suite-one-live.csv`; plain runs last, total only), the unchanged test's runs (`latency-before-repair.log`), the verification runs (`verify-beside-suite.*`, `verify-calm.*`) and the load samples (`load.log`, one per second, 04:27Z to 05:12Z, `full=1` while a flocked full suite runs). The raw JSON lines stay in this worker's scratch directory, `.ai/cezar/t/a6a03320/results/`, until the review passes.

1. A copy of the tree, not a worktree: `git archive <commit> | tar -x -C <copy>`, then `ln -s <worktree>/node_modules <copy>/node_modules`. The copy is never watched, so the probe never reaches a branch or a Squeal daemon.
2. `cp probe/fresh-probe.test.ts <copy>/test/harness/pi/`. It builds the Pi bundles, writes a wrapper entry `probe-worker.cjs` beside `worker.mjs`, seeds the latency test's store, and times `PROBE_N` fresh workers (default 20). Each JSON line has the main thread's marks (`call`, `ctor0`, `ctor1`, `online`, `done`), the worker's (`js`, `evaluated`, `received`, `answered`, each with the thread's CPU time) and the load before and after. Odd runs use the minimal environment, even runs the full one; `PROBE_STOP=1` stops each worker and awaits its exit before the next; `PROBE_PLAIN=1` starts `worker.mjs` with no wrapper.
3. `OUT=<dir>/load.log probe/load-sampler.sh &`, then `COPY=<copy> RESULTS=<dir> [LATENCY=1] [PROBE_STOP=1] probe/probe-loop.sh <label> <rounds> [gap s]` beside a locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. `LATENCY=1` also runs the copy's `latency.test.ts` once per round.
4. `node probe/analyze.mjs <dir>/<label>.jsonl... [--rows | --csv]` prints each phase's p50, p95 and max per condition and lists the runs at or over 80 ms.
5. `TREE=<worktree> COPY=<copy> RESULTS=<dir> probe/verify-loop.sh <label> <rounds> [gap s]` runs the repaired test in the worktree and `latency-lifted.test.ts` in the copy (the repaired test with `MAX_LOAD` lifted, so it asserts at any load); `node probe/verify-summary.mjs <dir>/<label>.log` counts them.
