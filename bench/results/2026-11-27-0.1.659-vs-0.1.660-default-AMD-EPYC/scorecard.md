# Squeal performance scorecard

Squeal 0.1.659 vs 0.1.660 · Node v24.22.1 · Vitest 5.0.3 · Vite 8.4.0 · coverage-v8 5.0.3 · AMD EPYC · 4 vCPU · 7.8 GiB · SHA-256 2581 MiB/s · 2026-11-27T20:12:05.720Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 81 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 66 | 96 | 89 | 83 | 71 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.659-r1 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| ref@0.1.659-r2 | 500 | 1 | 0% | 0 | ✅ | 87 | 63 | 88 | 100 | 83 | 100 |
| ref@0.1.659-r3 | 500 | 1 | 0% | 0 | ✅ | 89 | 75 | 88 | 100 | 83 | 100 |
| ref@0.1.660-r1 | 500 | 1 | 0% | 0 | ✅ | 84 | 63 | 100 | 100 | 83 | 75 |
| ref@0.1.660-r2 | 500 | 1 | 0% | 0 | ✅ | 87 | 63 | 88 | 100 | 83 | 100 |
| ref@0.1.660-r3 | 500 | 1 | 0% | 0 | ✅ | 89 | 88 | 100 | 100 | 83 | 75 |
| wt-3@0.1.659-r1 | 500 | 3 | 0% | 0 | ✅ | 84 | 63 | 100 | 100 | 83 | 75 |
| wt-3@0.1.659-r2 | 500 | 3 | 0% | 0 | ✅ | 84 | 63 | 100 | 100 | 83 | 75 |
| wt-3@0.1.659-r3 | 500 | 3 | 0% | 0 | ✅ | 87 | 75 | 100 | 100 | 83 | 75 |
| wt-3@0.1.660-r1 | 500 | 3 | 0% | 0 | ✅ | 92 | 75 | 100 | 100 | 83 | 100 |
| wt-3@0.1.660-r2 | 500 | 3 | 0% | 0 | ✅ | 82 | 75 | 100 | 100 | 83 | 50 |
| wt-3@0.1.660-r3 | 500 | 3 | 0% | 0 | ✅ | 75 | 50 | 100 | 90 | 83 | 50 |
| stress@0.1.659-r1 | 500 | 6 | 100% | 0 | ✅ | 73 | 63 | 100 | 70 | 83 | 50 |
| stress@0.1.659-r2 | 500 | 6 | 100% | 0 | ✅ | 66 | 50 | 75 | 70 | 83 | 50 |
| stress@0.1.659-r3 | 500 | 6 | 100% | 0 | ✅ | 73 | 63 | 100 | 70 | 83 | 50 |
| stress@0.1.660-r1 | 500 | 6 | 100% | 0 | ✅ | 78 | 63 | 100 | 70 | 83 | 75 |
| stress@0.1.660-r2 | 500 | 6 | 100% | 0 | ✅ | 73 | 63 | 100 | 70 | 83 | 50 |
| stress@0.1.660-r3 | 500 | 6 | 100% | 0 | ✅ | 73 | 63 | 100 | 70 | 83 | 50 |

## 0.1.659 compared with 0.1.660 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.659 | 3 | ✅ | 87 (84–89) |  |  |  |  |  |  |
| ref | 0.1.660 | 3 | ✅ | 87 (84–89) | +0 noise | +0 | +8 | +0 | +0 | -8 |
| wt-3 | 0.1.659 | 3 | ✅ | 85 (84–87) |  |  |  |  |  |  |
| wt-3 | 0.1.660 | 3 | ✅ | 83 (75–92) | -2 noise | +0 | +0 | -3 | +0 | -8 |
| stress | 0.1.659 | 3 | ✅ | 71 (66–73) |  |  |  |  |  |  |
| stress | 0.1.660 | 3 | ✅ | 75 (73–78) | +4 noise | +4 | +8 | +0 | +0 | +8 |

Raw numbers, mean per cell and version with the range across runs (min–max) when repeated. Δ% is against the first version; **noise** marks a change whose range overlaps the first version's.

| Cell | Metric | 0.1.659 | 0.1.660 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (median) | 42 ms (38–43) | 36 ms (34–39) | -13% noise |
| ref | Hook before each tool call (slowest 5%) | 103 ms (71–122) | 96 ms (76–112) | -6% noise |
| ref | Hook after each batch of tool calls (median) | 52 ms (50–54) | 45 ms (42–48) | -14% |
| ref | Hook after each batch of tool calls (slowest 5%) | 298 ms (134–418) | 282 ms (98–426) | -5% noise |
| ref | Hook before each tool call (slowest 1%) | 116 ms (97–128) | 121 ms (82–156) | +4% noise |
| ref | Hook after each batch of tool calls (slowest 1%) | 589 ms (334–836) | 516 ms (389–644) | -12% noise |
| ref | Hook write wait for the daemon main thread (longest) | 591 ms (337–859) | 509 ms (423–651) | -14% noise |
| ref | Hook writes that waited over 250 ms for the daemon main thread | 1.7 (1–2) | 2 (1–3) | +20% noise |
| ref | Hook at session start (slowest) | 211 ms (179–261) | 180 ms (104–264) | -15% noise |
| ref | `squeal status` (slowest 5%) | 106 ms (94–118) | 98 ms (89–113) | -8% noise |
| ref | Edit that breaks a test until the agent is told (median) | 1301 ms (1174–1412) | 1289 ms (1137–1448) | -1% noise |
| ref | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.3 % core | 0.2 % core (0.1–0.3) | -19% noise |
| ref | CPU per edit: daemons with their test runs, plus the store process | 0.8 s (0.7–0.8) | 0.7 s | -13% noise |
| ref | Daemon memory, peak | 380 MiB (363–391) | 380 MiB (359–409) | -0% noise |
| ref | Daemon with its test runs, memory per worktree, peak | 1038 MiB (1023–1059) | 1044 MiB (1006–1076) | +1% noise |
| ref | Store process memory, peak | 149 MiB (145–152) | 147 MiB (146–148) | -2% noise |
| ref | Store writes that held the lock over 250 ms | 0.7 (0–2) | 0.7 (0–1) | +0% noise |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 353 ms | 359 ms (336–382) | +2% |
| ref | Logged lock holds, total | 0.2 s (0–0.7) | 0.2 s (0–0.4) | +9% noise |
| ref | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | -7% noise |
| ref | `squeal impact` memory, peak | 126 MiB (114–145) | 110 MiB (100–118) | -13% noise |
| wt-3 | Hook before each tool call (median) | 35 ms (34–35) | 39 ms (36–43) | +14% |
| wt-3 | Hook before each tool call (slowest 5%) | 90 ms (69–103) | 170 ms (82–326) | +89% noise |
| wt-3 | Hook after each batch of tool calls (median) | 43 ms (43–44) | 56 ms (51–59) | +29% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 362 ms (287–509) | 419 ms (128–992) | +16% noise |
| wt-3 | Hook before each tool call (slowest 1%) | 160 ms (111–220) | 311 ms (174–574) | +94% noise |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 679 ms (498–960) | 726 ms (384–1156) | +7% noise |
| wt-3 | Hook write wait for the daemon main thread (longest) | 777 ms (508–939) | 1503 ms (308–3540) | +94% noise |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | 4.3 (3–6) | 3 (2–5) | -31% noise |
| wt-3 | Hook at session start (slowest) | 218 ms (153–269) | 166 ms (126–222) | -24% noise |
| wt-3 | `squeal status` (slowest 5%) | 107 ms (97–114) | 131 ms (128–133) | +22% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1275 ms (1183–1428) | 1213 ms (1124–1366) | -5% noise |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 0.3 % core (0.2–0.3) | 0.3 % core | +18% noise |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 1.8 s (0.2–4.5) | 0.3 s | -84% noise |
| wt-3 | Daemon memory, peak | 374 MiB (342–392) | 393 MiB (376–408) | +5% noise |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 706 MiB (690–727) | 706 MiB (696–716) | -0% noise |
| wt-3 | Store process memory, peak | 213 MiB (210–217) | 218 MiB (211–224) | +2% noise |
| wt-3 | Store writes that held the lock over 250 ms | 1.7 (1–3) | 19 (0–53) | +1040% noise |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 287 ms (252–334) | 1126 ms (587–1665) | +292% |
| wt-3 | Logged lock holds, total | 0.5 s (0.3–0.9) | 10 s (0–29) | +1974% noise |
| wt-3 | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | +6% noise |
| wt-3 | `squeal impact` memory, peak | 117 MiB (111–120) | 108 MiB (93–120) | -8% noise |
| stress | Hook before each tool call (median) | 92 ms (87–100) | 89 ms (84–92) | -3% noise |
| stress | Hook before each tool call (slowest 5%) | 196 ms (184–219) | 166 ms (158–176) | -15% |
| stress | Hook after each batch of tool calls (median) | 125 ms (111–141) | 120 ms (116–125) | -4% noise |
| stress | Hook after each batch of tool calls (slowest 5%) | 286 ms (226–404) | 219 ms (215–223) | -23% |
| stress | Hook before each tool call (slowest 1%) | 320 ms (255–373) | 220 ms (188–256) | -31% noise |
| stress | Hook after each batch of tool calls (slowest 1%) | 494 ms (309–860) | 345 ms (298–379) | -30% noise |
| stress | Hook write wait for the daemon main thread (longest) | 681 ms (315–1342) | 279 ms (231–313) | -59% |
| stress | Hook writes that waited over 250 ms for the daemon main thread | 3.3 (1–8) | 0.7 (0–1) | -80% noise |
| stress | Hook at session start (slowest) | 266 ms (229–320) | 257 ms (191–318) | -3% noise |
| stress | `squeal status` (slowest 5%) | 285 ms (258–324) | 273 ms (262–288) | -4% noise |
| stress | Edit that breaks a test until the agent is told (median) | 2507 ms (2380–2757) | 2387 ms (2340–2426) | -5% noise |
| stress | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| stress | CPU with no edits: the busiest daemon, plus the store process | 0.3 % core (0.2–0.3) | 0.3 % core | +4% noise |
| stress | CPU per edit: daemons with their test runs, plus the store process | 0.6 s (0.5–0.9) | 0.6 s (0.5–0.8) | -5% noise |
| stress | Daemon memory, peak | 347 MiB (344–350) | 352 MiB (348–355) | +1% noise |
| stress | Daemon with its test runs, memory per worktree, peak | 689 MiB (659–712) | 722 MiB (681–788) | +5% noise |
| stress | Store process memory, peak | 229 MiB (208–260) | 240 MiB (225–249) | +5% noise |
| stress | Store writes that held the lock over 250 ms | 9.3 (4–16) | 6 (3–8) | -36% noise |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | 426 ms (386–472) | 372 ms (279–472) | -13% noise |
| stress | Logged lock holds, total | 3.0 s (1.3–5.4) | 1.8 s (0.8–2.5) | -40% noise |
| stress | `squeal impact` (reads every stored module list) | 0.4 s (0.3–0.4) | 0.3 s (0.3–0.4) | -8% noise |
| stress | `squeal impact` memory, peak | 123 MiB (119–128) | 128 MiB (113–138) | +4% noise |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 15 of 18 cells: ref@0.1.659-r1 122 ms ⚠️, ref@0.1.659-r2 114 ms ⚠️, ref@0.1.660-r1 101 ms ⚠️, ref@0.1.660-r2 112 ms ⚠️, wt-3@0.1.659-r1 98 ms ⚠️, wt-3@0.1.659-r2 103 ms ⚠️, wt-3@0.1.660-r1 82 ms ⚠️, wt-3@0.1.660-r2 104 ms ⚠️, wt-3@0.1.660-r3 326 ms ❌, stress@0.1.659-r1 184 ms ⚠️, stress@0.1.659-r2 219 ms ❌, stress@0.1.659-r3 186 ms ⚠️, stress@0.1.660-r1 164 ms ⚠️, stress@0.1.660-r2 158 ms ⚠️, stress@0.1.660-r3 176 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 18 of 18 cells: ref@0.1.659-r1 134 ms ⚠️, ref@0.1.659-r2 341 ms ❌, ref@0.1.659-r3 418 ms ❌, ref@0.1.660-r1 323 ms ❌, ref@0.1.660-r2 426 ms ❌, ref@0.1.660-r3 98 ms ⚠️, wt-3@0.1.659-r1 509 ms ❌, wt-3@0.1.659-r2 287 ms ❌, wt-3@0.1.659-r3 289 ms ❌, wt-3@0.1.660-r1 137 ms ⚠️, wt-3@0.1.660-r2 128 ms ⚠️, wt-3@0.1.660-r3 992 ms ❌, stress@0.1.659-r1 227 ms ❌, stress@0.1.659-r2 404 ms ❌, stress@0.1.659-r3 226 ms ❌, stress@0.1.660-r1 215 ms ❌, stress@0.1.660-r2 219 ms ❌, stress@0.1.660-r3 223 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 1 of 18 cells: stress@0.1.659-r2 324 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 18 cells: stress@0.1.659-r2 304 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 4 of 18 cells: ref@0.1.659-r1 1.48 x ⚠️, ref@0.1.659-r2 1.32 x ⚠️, ref@0.1.659-r3 1.34 x ⚠️, ref@0.1.660-r2 1.30 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 7 of 18 cells: wt-3@0.1.660-r3 19657 ms ⚠️, stress@0.1.659-r1 15941 ms ⚠️, stress@0.1.659-r2 18910 ms ⚠️, stress@0.1.659-r3 16874 ms ⚠️, stress@0.1.660-r1 19913 ms ⚠️, stress@0.1.660-r2 16779 ms ⚠️, stress@0.1.660-r3 15042 ms ⚠️
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 18 cells: stress@0.1.659-r1 late ❌, stress@0.1.659-r2 late ❌, stress@0.1.659-r3 late ❌, stress@0.1.660-r1 late ❌, stress@0.1.660-r2 late ❌, stress@0.1.660-r3 late ❌
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 18 of 18 cells: ref@0.1.659-r1 391 MiB ⚠️, ref@0.1.659-r2 387 MiB ⚠️, ref@0.1.659-r3 363 MiB ⚠️, ref@0.1.660-r1 359 MiB ⚠️, ref@0.1.660-r2 409 MiB ⚠️, ref@0.1.660-r3 370 MiB ⚠️, wt-3@0.1.659-r1 342 MiB ⚠️, wt-3@0.1.659-r2 392 MiB ⚠️, wt-3@0.1.659-r3 389 MiB ⚠️, wt-3@0.1.660-r1 408 MiB ⚠️, wt-3@0.1.660-r2 394 MiB ⚠️, wt-3@0.1.660-r3 376 MiB ⚠️, stress@0.1.659-r1 350 MiB ⚠️, stress@0.1.659-r2 344 MiB ⚠️, stress@0.1.659-r3 348 MiB ⚠️, stress@0.1.660-r1 354 MiB ⚠️, stress@0.1.660-r2 348 MiB ⚠️, stress@0.1.660-r3 355 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 14 of 18 cells: ref@0.1.659-r1 2 ⚠️, ref@0.1.660-r1 1 ⚠️, ref@0.1.660-r3 1 ⚠️, wt-3@0.1.659-r1 1 ⚠️, wt-3@0.1.659-r2 3 ⚠️, wt-3@0.1.659-r3 1 ⚠️, wt-3@0.1.660-r2 4 ❌, wt-3@0.1.660-r3 53 ❌, stress@0.1.659-r1 4 ❌, stress@0.1.659-r2 16 ❌, stress@0.1.659-r3 8 ❌, stress@0.1.660-r1 3 ⚠️, stress@0.1.660-r2 7 ❌, stress@0.1.660-r3 8 ❌

## Before the idle minute

Every cell's baselines and store process settled before its idle minute.

## Machine speed per cell

Single-thread SHA-256 before→after the cell, and the CPU time the hypervisor took (steal) during it.

- ref@0.1.659-r1: SHA-256 2577→2575 MiB/s, steal 0.0%
- ref@0.1.659-r2: SHA-256 2552→2427 MiB/s, steal 0.0%
- ref@0.1.659-r3: SHA-256 2428→2578 MiB/s, steal 0.0%
- ref@0.1.660-r1: SHA-256 2541→2576 MiB/s, steal 0.0%
- ref@0.1.660-r2: SHA-256 2543→2527 MiB/s, steal 0.0%
- ref@0.1.660-r3: SHA-256 2578→2538 MiB/s, steal 0.0%
- wt-3@0.1.659-r1: SHA-256 2558→2574 MiB/s, steal 0.0%
- wt-3@0.1.659-r2: SHA-256 2583→2571 MiB/s, steal 0.0%
- wt-3@0.1.659-r3: SHA-256 2574→2545 MiB/s, steal 0.0%
- wt-3@0.1.660-r1: SHA-256 2534→2572 MiB/s, steal 0.0%
- wt-3@0.1.660-r2: SHA-256 2575→2555 MiB/s, steal 0.0%
- wt-3@0.1.660-r3: SHA-256 2524→2564 MiB/s, steal 0.1%
- stress@0.1.659-r1: SHA-256 2532→2574 MiB/s, steal 0.0%
- stress@0.1.659-r2: SHA-256 2557→2540 MiB/s, steal 0.0%
- stress@0.1.659-r3: SHA-256 2550→2541 MiB/s, steal 0.0%
- stress@0.1.660-r1: SHA-256 2583→2579 MiB/s, steal 0.0%
- stress@0.1.660-r2: SHA-256 2579→2576 MiB/s, steal 0.0%
- stress@0.1.660-r3: SHA-256 2549→2578 MiB/s, steal 0.0%

## Every metric

| Metric | Healthy | Warn | ref@0.1.659-r1 | ref@0.1.659-r2 | ref@0.1.659-r3 | ref@0.1.660-r1 | ref@0.1.660-r2 | ref@0.1.660-r3 | wt-3@0.1.659-r1 | wt-3@0.1.659-r2 | wt-3@0.1.659-r3 | wt-3@0.1.660-r1 | wt-3@0.1.660-r2 | wt-3@0.1.660-r3 | stress@0.1.659-r1 | stress@0.1.659-r2 | stress@0.1.659-r3 | stress@0.1.660-r1 | stress@0.1.660-r2 | stress@0.1.660-r3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Hook before each tool call (median) (`hook.preToolUse.p50`) | report |  | 43 ms | 43 ms | 38 ms | 34 ms | 36 ms | 39 ms | 34 ms | 35 ms | 34 ms | 40 ms | 36 ms | 43 ms | 87 ms | 100 ms | 90 ms | 92 ms | 91 ms | 84 ms |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 122 ms ⚠️ | 114 ms ⚠️ | 71 ms ✅ | 101 ms ⚠️ | 112 ms ⚠️ | 76 ms ✅ | 98 ms ⚠️ | 103 ms ⚠️ | 69 ms ✅ | 82 ms ⚠️ | 104 ms ⚠️ | 326 ms ❌ | 184 ms ⚠️ | 219 ms ❌ | 186 ms ⚠️ | 164 ms ⚠️ | 158 ms ⚠️ | 176 ms ⚠️ |
| Hook after each batch of tool calls (median) (`hook.postToolBatch.p50`) | report |  | 54 ms | 53 ms | 50 ms | 42 ms | 44 ms | 48 ms | 44 ms | 44 ms | 43 ms | 58 ms | 51 ms | 59 ms | 111 ms | 141 ms | 123 ms | 125 ms | 120 ms | 116 ms |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 134 ms ⚠️ | 341 ms ❌ | 418 ms ❌ | 323 ms ❌ | 426 ms ❌ | 98 ms ⚠️ | 509 ms ❌ | 287 ms ❌ | 289 ms ❌ | 137 ms ⚠️ | 128 ms ⚠️ | 992 ms ❌ | 227 ms ❌ | 404 ms ❌ | 226 ms ❌ | 215 ms ❌ | 219 ms ❌ | 223 ms ❌ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 122 ms | 128 ms | 97 ms | 125 ms | 156 ms | 82 ms | 150 ms | 220 ms | 111 ms | 174 ms | 185 ms | 574 ms | 373 ms | 255 ms | 330 ms | 188 ms | 216 ms | 256 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 122 ms | 132 ms | 104 ms | 131 ms | 167 ms | 83 ms | 161 ms | 340 ms | 123 ms | 188 ms | 199 ms | 575 ms | 411 ms | 345 ms | 461 ms | 263 ms | 289 ms | 320 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 334 ms | 598 ms | 836 ms | 644 ms | 516 ms | 389 ms | 960 ms | 579 ms | 498 ms | 384 ms | 639 ms | 1156 ms | 312 ms | 860 ms | 309 ms | 357 ms | 298 ms | 379 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 400 ms | 650 ms | 956 ms | 719 ms | 535 ms | 491 ms | 1015 ms | 964 ms | 599 ms | 400 ms | 739 ms | 1496 ms | 533 ms | 1189 ms | 443 ms | 499 ms | 430 ms | 431 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | 337 ms | 576 ms | 859 ms | 651 ms | 452 ms | 423 ms | 939 ms | 883 ms | 508 ms | 308 ms | 662 ms | 3540 ms | 386 ms | 1342 ms | 315 ms | 293 ms | 313 ms | 231 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | 337 ms | 576 ms | 859 ms | 651 ms | 452 ms | 423 ms | 939 ms | 883 ms | 508 ms | 308 ms | 662 ms | 3540 ms | 386 ms | 1342 ms | 315 ms | 293 ms | 313 ms | 231 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | 1 | 2 | 2 | 2 | 3 | 1 | 6 | 3 | 4 | 2 | 2 | 5 | 1 | 8 | 1 | 1 | 1 | 0 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 179 ms ✅ | 194 ms ✅ | 261 ms ✅ | 264 ms ✅ | 104 ms ✅ | 172 ms ✅ | 153 ms ✅ | 231 ms ✅ | 269 ms ✅ | 222 ms ✅ | 126 ms ✅ | 150 ms ✅ | 320 ms ✅ | 229 ms ✅ | 250 ms ✅ | 262 ms ✅ | 191 ms ✅ | 318 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 70 ms ✅ | 87 ms ✅ | 73 ms ✅ | 72 ms ✅ | 92 ms ✅ | 87 ms ✅ | 95 ms ✅ | 137 ms ✅ | 121 ms ✅ | 152 ms ✅ | 176 ms ✅ | 207 ms ✅ | 148 ms ✅ | 365 ms ✅ | 236 ms ✅ | 187 ms ✅ | 217 ms ✅ | 184 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 118 ms ✅ | 106 ms ✅ | 94 ms ✅ | 89 ms ✅ | 91 ms ✅ | 113 ms ✅ | 111 ms ✅ | 114 ms ✅ | 97 ms ✅ | 133 ms ✅ | 128 ms ✅ | 132 ms ✅ | 258 ms ✅ | 324 ms ⚠️ | 272 ms ✅ | 288 ms ✅ | 268 ms ✅ | 262 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 112 ms ✅ | 115 ms ✅ | 89 ms ✅ | 105 ms ✅ | 92 ms ✅ | 124 ms ✅ | 98 ms ✅ | 118 ms ✅ | 83 ms ✅ | 130 ms ✅ | 105 ms ✅ | 131 ms ✅ | 226 ms ✅ | 304 ms ⚠️ | 286 ms ✅ | 281 ms ✅ | 253 ms ✅ | 254 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 579 ms ✅ | 727 ms ✅ | 907 ms ✅ | 551 ms ✅ | 707 ms ✅ | 679 ms ✅ | 1180 ms ✅ | 1335 ms ✅ | 524 ms ✅ | 663 ms ✅ | 1197 ms ✅ | 564 ms ✅ | 1009 ms ✅ | 1466 ms ✅ | 1039 ms ✅ | 715 ms ✅ | 1026 ms ✅ | 1784 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a | n/a | n/a | 185 ms ✅ | 189 ms ✅ | 192 ms ✅ | 273 ms ✅ | 192 ms ✅ | 201 ms ✅ | 638 ms ✅ | 399 ms ✅ | 435 ms ✅ | 496 ms ✅ | 537 ms ✅ | 477 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.48 x ⚠️ | 1.32 x ⚠️ | 1.34 x ⚠️ | 1.29 x ✅ | 1.30 x ⚠️ | 1.28 x ✅ | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 41 s | 38 s | 39 s | 35 s | 36 s | 35 s | 38 s | 37 s | 37 s | 40 s | 39 s | 37 s | 178 s | 147 s | 167 s | 143 s | 150 s | 177 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1174 ms ✅ | 1317 ms ✅ | 1412 ms ✅ | 1283 ms ✅ | 1448 ms ✅ | 1137 ms ✅ | 1428 ms ✅ | 1215 ms ✅ | 1183 ms ✅ | 1148 ms ✅ | 1124 ms ✅ | 1366 ms ✅ | 2380 ms ✅ | 2757 ms ✅ | 2383 ms ✅ | 2426 ms ✅ | 2393 ms ✅ | 2340 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1485 ms ✅ | 1938 ms ✅ | 1416 ms ✅ | 1418 ms ✅ | 1431 ms ✅ | 1918 ms ✅ | 432 ms ✅ | 411 ms ✅ | 432 ms ✅ | 1413 ms ✅ | 917 ms ✅ | 1436 ms ✅ | 1680 ms ✅ | 2741 ms ✅ | 1716 ms ✅ | 1812 ms ✅ | 1817 ms ✅ | 1695 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 6581 ms ✅ | 8603 ms ✅ | 6452 ms ✅ | 6547 ms ✅ | 7544 ms ✅ | 5435 ms ✅ | 8449 ms ✅ | 6978 ms ✅ | 6424 ms ✅ | 7045 ms ✅ | 6460 ms ✅ | 19657 ms ⚠️ | 15941 ms ⚠️ | 18910 ms ⚠️ | 16874 ms ⚠️ | 19913 ms ⚠️ | 16779 ms ⚠️ | 15042 ms ⚠️ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 34 s ✅ | 38 s ✅ | 35 s ✅ | 34 s ✅ | 35 s ✅ | 37 s ✅ | 97 s ✅ | 107 s ✅ | 103 s ✅ | 103 s ✅ | 112 s ✅ | 98 s ✅ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.1 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.2 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.2 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 391 MiB ⚠️ | 387 MiB ⚠️ | 363 MiB ⚠️ | 359 MiB ⚠️ | 409 MiB ⚠️ | 370 MiB ⚠️ | 342 MiB ⚠️ | 392 MiB ⚠️ | 389 MiB ⚠️ | 408 MiB ⚠️ | 394 MiB ⚠️ | 376 MiB ⚠️ | 350 MiB ⚠️ | 344 MiB ⚠️ | 348 MiB ⚠️ | 354 MiB ⚠️ | 348 MiB ⚠️ | 355 MiB ⚠️ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 1059 MiB ✅ | 1031 MiB ✅ | 1023 MiB ✅ | 1006 MiB ✅ | 1076 MiB ✅ | 1051 MiB ✅ | 700 MiB ✅ | 727 MiB ✅ | 690 MiB ✅ | 705 MiB ✅ | 716 MiB ✅ | 696 MiB ✅ | 712 MiB ✅ | 659 MiB ✅ | 697 MiB ✅ | 788 MiB ✅ | 681 MiB ✅ | 696 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.8 s | 0.8 s | 0.7 s | 0.7 s | 0.7 s | 0.7 s | 0.2 s | 4.5 s | 0.7 s | 0.3 s | 0.3 s | 0.3 s | 0.5 s | 0.9 s | 0.5 s | 0.8 s | 0.5 s | 0.5 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.8 s | 0.8 s | 0.7 s | 0.6 s | 0.6 s | 0.7 s | 1.4 s | 1.4 s | 1.4 s | 1.8 s | 1.5 s | 2.1 s | 2.3 s | 2.9 s | 2.5 s | 2.6 s | 2.4 s | 2.3 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 145 MiB | 149 MiB | 152 MiB | 147 MiB | 146 MiB | 148 MiB | 212 MiB | 217 MiB | 210 MiB | 219 MiB | 224 MiB | 211 MiB | 208 MiB | 260 MiB | 220 MiB | 225 MiB | 249 MiB | 246 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 0 ✅ | 0 ✅ | 1 ⚠️ | 0 ✅ | 1 ⚠️ | 1 ⚠️ | 3 ⚠️ | 1 ⚠️ | 0 ✅ | 4 ❌ | 53 ❌ | 4 ❌ | 16 ❌ | 8 ❌ | 3 ⚠️ | 7 ❌ | 8 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 19 MiB | 17 MiB | 18 MiB | 17 MiB | 19 MiB | 18 MiB | 38 MiB | 37 MiB | 39 MiB | 40 MiB | 40 MiB | 41 MiB | 55 MiB | 55 MiB | 55 MiB | 47 MiB | 56 MiB | 54 MiB |
| Result rows in the store (`store.results`) | report |  | 8190 | 8190 | 8190 | 8190 | 8190 | 8190 | 17038 | 17038 | 17038 | 17038 | 17038 | 17038 | 11970 | 10360 | 11270 | 10451 | 11242 | 11172 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 246 ms | 123 ms | 118 ms | 322 ms | 161 ms | 7343 ms | 446 ms | 2782 ms | 412 ms | 265 ms | 200 ms | 491 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 12 s | 14 s | 11 s | 10 s | 9.9 s | 11 s | 32 s | 24 s | 19 s | 32 s | 25 s | 110 s | 40 s | 75 s | 60 s | 44 s | 41 s | 54 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.3 s | 0.4 s | 0.4 s | 0.4 s | 0.3 s | 0.3 s |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 118 MiB | 145 MiB | 114 MiB | 118 MiB | 111 MiB | 100 MiB | 120 MiB | 119 MiB | 111 MiB | 112 MiB | 120 MiB | 93 MiB | 119 MiB | 128 MiB | 123 MiB | 133 MiB | 138 MiB | 113 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 353 ms | n/a | n/a | 382 ms | n/a | 336 ms | 276 ms | 334 ms | 252 ms | n/a | 587 ms | 1665 ms | 419 ms | 472 ms | 386 ms | 279 ms | 364 ms | 472 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.7 s | 0 s | 0 s | 0.4 s | 0 s | 0.3 s | 0.3 s | 0.9 s | 0.3 s | 0 s | 1.5 s | 29 s | 1.3 s | 5.4 s | 2.3 s | 0.8 s | 2.2 s | 2.5 s |
