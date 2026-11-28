# Squeal performance scorecard

Squeal 0.1.665 vs 0.1.666 · Node v24.22.1 · Vitest 5.0.3 · Vite 8.4.0 · coverage-v8 5.0.3 · AMD EPYC · 4 vCPU · 7.8 GiB · SHA-256 1372 MiB/s · 2026-11-27T23:59:14.987Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 77 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 66 | 82 | 97 | 76 | 63 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.665-r1 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| ref@0.1.665-r2 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| ref@0.1.665-r3 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| ref@0.1.666-r1 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| ref@0.1.666-r2 | 500 | 1 | 0% | 0 | ✅ | 87 | 75 | 100 | 100 | 83 | 75 |
| ref@0.1.666-r3 | 500 | 1 | 0% | 0 | ✅ | 84 | 75 | 88 | 100 | 83 | 75 |
| size-l@0.1.665-r1 | 2000 | 1 | 0% | 0 | ✅ | 68 | 63 | 88 | 90 | 50 | 50 |
| size-l@0.1.665-r2 | 2000 | 1 | 0% | 0 | ✅ | 66 | 63 | 63 | 90 | 67 | 50 |
| size-l@0.1.665-r3 | 2000 | 1 | 0% | 0 | ✅ | 60 | 63 | 63 | 90 | 33 | 50 |
| size-l@0.1.666-r1 | 2000 | 1 | 0% | 0 | ✅ | 63 | 63 | 63 | 90 | 50 | 50 |
| size-l@0.1.666-r2 | 2000 | 1 | 0% | 0 | ✅ | 66 | 63 | 75 | 90 | 50 | 50 |
| size-l@0.1.666-r3 | 2000 | 1 | 0% | 0 | ✅ | 64 | 63 | 63 | 80 | 67 | 50 |
| wt-3@0.1.665-r1 | 500 | 3 | 0% | 0 | ✅ | 79 | 63 | 100 | 100 | 83 | 50 |
| wt-3@0.1.665-r2 | 500 | 3 | 0% | 0 | ✅ | 77 | 63 | 88 | 100 | 83 | 50 |
| wt-3@0.1.665-r3 | 500 | 3 | 0% | 0 | ✅ | 74 | 63 | 75 | 100 | 83 | 50 |
| wt-3@0.1.666-r1 | 500 | 3 | 0% | 0 | ✅ | 79 | 63 | 100 | 100 | 83 | 50 |
| wt-3@0.1.666-r2 | 500 | 3 | 0% | 0 | ✅ | 74 | 63 | 75 | 100 | 83 | 50 |
| wt-3@0.1.666-r3 | 500 | 3 | 0% | 0 | ✅ | 80 | 75 | 100 | 90 | 83 | 50 |
| load-50@0.1.665-r1 | 500 | 1 | 50% | 0 | ✅ | 82 | 63 | 88 | 100 | 83 | 75 |
| load-50@0.1.665-r2 | 500 | 1 | 50% | 0 | ✅ | 82 | 63 | 88 | 100 | 83 | 75 |
| load-50@0.1.665-r3 | 500 | 1 | 50% | 0 | ✅ | 82 | 63 | 88 | 100 | 83 | 75 |
| load-50@0.1.666-r1 | 500 | 1 | 50% | 0 | ✅ | 77 | 63 | 63 | 100 | 83 | 75 |
| load-50@0.1.666-r2 | 500 | 1 | 50% | 0 | ✅ | 82 | 63 | 88 | 100 | 83 | 75 |
| load-50@0.1.666-r3 | 500 | 1 | 50% | 0 | ✅ | 79 | 63 | 75 | 100 | 83 | 75 |

## 0.1.665 compared with 0.1.666 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.665 | 3 | ✅ | 84 (84–84) |  |  |  |  |  |  |
| ref | 0.1.666 | 3 | ✅ | 85 (84–87) | +1 noise | +0 | +4 | +0 | +0 | +0 |
| size-l | 0.1.665 | 3 | ✅ | 65 (60–68) |  |  |  |  |  |  |
| size-l | 0.1.666 | 3 | ✅ | 64 (63–66) | -0 noise | +0 | -4 | -3 | +6 | +0 |
| wt-3 | 0.1.665 | 3 | ✅ | 77 (74–79) |  |  |  |  |  |  |
| wt-3 | 0.1.666 | 3 | ✅ | 78 (74–80) | +1 noise | +4 | +4 | -3 | +0 | +0 |
| load-50 | 0.1.665 | 3 | ✅ | 82 (82–82) |  |  |  |  |  |  |
| load-50 | 0.1.666 | 3 | ✅ | 79 (77–82) | -3 noise | +0 | -13 | +0 | +0 | +0 |

Raw numbers, mean per cell and version with the range across runs (min–max) when repeated. Δ% is against the first version; **noise** marks a change whose range overlaps the first version's.

| Cell | Metric | 0.1.665 | 0.1.666 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (median) | 103 ms (102–104) | 102 ms (99–104) | -2% noise |
| ref | Hook before each tool call (slowest 5%) | 171 ms (158–189) | 155 ms (144–164) | -10% noise |
| ref | Hook after each batch of tool calls (median) | 130 ms (124–137) | 126 ms (119–134) | -3% noise |
| ref | Hook after each batch of tool calls (slowest 5%) | 188 ms (174–196) | 191 ms (186–198) | +1% noise |
| ref | Hook before each tool call (slowest 1%) | 178 ms (163–199) | 167 ms (153–182) | -6% noise |
| ref | Hook after each batch of tool calls (slowest 1%) | 196 ms (176–208) | 203 ms (194–213) | +4% noise |
| ref | Hook write wait for the daemon main thread (longest) | 15 ms (12–22) | 13 ms (9–17) | -15% noise |
| ref | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| ref | Hook at session start (slowest) | 190 ms (176–204) | 173 ms (154–198) | -9% noise |
| ref | `squeal status` (slowest 5%) | 264 ms (245–282) | 238 ms (226–244) | -10% |
| ref | Edit that breaks a test until the agent is told (median) | 1281 ms (1265–1299) | 1272 ms (1269–1276) | -1% noise |
| ref | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.8 % core (0.7–0.8) | 0.8 % core (0.7–0.8) | -1% noise |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.8 s (1.8–1.9) | 1.8 s (1.7–1.8) | -3% noise |
| ref | Daemon memory, peak | 391 MiB (362–447) | 390 MiB (380–397) | -0% noise |
| ref | Daemon with its test runs, memory per worktree, peak | 1046 MiB (1019–1081) | 1027 MiB (996–1047) | -2% noise |
| ref | Store process memory, peak | 151 MiB (149–154) | 144 MiB (138–151) | -5% noise |
| ref | Store writes that held the lock over 250 ms | 2 | 1.7 (1–2) | -17% noise |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 326 ms (308–343) | 317 ms (309–331) | -3% noise |
| ref | Logged lock holds, total | 0.6 s | 0.5 s (0.3–0.6) | -17% noise |
| ref | `squeal impact` (store history read, no daemon; read module lists before 0.1.591) | 0.5 s (0.4–0.5) | 0.5 s | +6% noise |
| ref | `squeal impact` memory, peak | 134 MiB (127–138) | 134 MiB (132–137) | -0% noise |
| size-l | Hook before each tool call (median) | 104 ms (103–105) | 106 ms (101–115) | +2% noise |
| size-l | Hook before each tool call (slowest 5%) | 144 ms (132–165) | 145 ms (121–174) | +1% noise |
| size-l | Hook after each batch of tool calls (median) | 161 ms (146–178) | 176 ms (154–213) | +9% noise |
| size-l | Hook after each batch of tool calls (slowest 5%) | 386 ms (343–469) | 408 ms (323–515) | +6% noise |
| size-l | Hook before each tool call (slowest 1%) | 277 ms (239–314) | 225 ms (123–293) | -19% noise |
| size-l | Hook after each batch of tool calls (slowest 1%) | 399 ms (348–479) | 456 ms (380–571) | +14% noise |
| size-l | Hook write wait for the daemon main thread (longest) | 36 ms (25–42) | 24 ms (15–34) | -33% noise |
| size-l | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| size-l | Hook at session start (slowest) | 390 ms (325–511) | 326 ms (287–352) | -16% noise |
| size-l | `squeal status` (slowest 5%) | 355 ms (288–448) | 384 ms (326–483) | +8% noise |
| size-l | Edit that breaks a test until the agent is told (median) | 1513 ms (1454–1614) | 1549 ms (1478–1630) | +2% noise |
| size-l | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| size-l | CPU with no edits: the busiest daemon, plus the store process | 0.8 % core (0.6–1.0) | 0.7 % core (0.7–0.8) | -4% noise |
| size-l | CPU per edit: daemons with their test runs, plus the store process | 4.1 s (3.9–4.4) | 4.5 s (3.7–5.7) | +9% noise |
| size-l | Daemon memory, peak | 622 MiB (591–673) | 606 MiB (540–647) | -3% noise |
| size-l | Daemon with its test runs, memory per worktree, peak | 1413 MiB (1378–1457) | 1376 MiB (1340–1405) | -3% noise |
| size-l | Store process memory, peak | 230 MiB (196–252) | 234 MiB (214–252) | +2% noise |
| size-l | Store writes that held the lock over 250 ms | 18 (17–19) | 17 | -4% noise |
| size-l | Longest logged lock hold (only holds over 250 ms are logged) | 3068 ms (2962–3131) | 3421 ms (2920–4252) | +11% noise |
| size-l | Logged lock holds, total | 11 s (9.9–12) | 11 s (10–13) | +5% noise |
| size-l | `squeal impact` (store history read, no daemon; read module lists before 0.1.591) | 1.1 s (1.0–1.1) | 1.4 s (1.1–2.0) | +35% |
| size-l | `squeal impact` memory, peak | 237 MiB (231–245) | 235 MiB (228–244) | -1% noise |
| wt-3 | Hook before each tool call (median) | 100 ms (99–101) | 101 ms (98–104) | +1% noise |
| wt-3 | Hook before each tool call (slowest 5%) | 171 ms (160–178) | 167 ms (160–179) | -3% noise |
| wt-3 | Hook after each batch of tool calls (median) | 135 ms (130–141) | 126 ms (124–128) | -7% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 221 ms (209–237) | 231 ms (195–262) | +5% noise |
| wt-3 | Hook before each tool call (slowest 1%) | 196 ms (176–208) | 189 ms (184–197) | -4% noise |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 251 ms (227–267) | 269 ms (213–324) | +7% noise |
| wt-3 | Hook write wait for the daemon main thread (longest) | 45 ms (39–56) | 25 ms (15–45) | -44% noise |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| wt-3 | Hook at session start (slowest) | 179 ms (168–189) | 237 ms (211–259) | +32% |
| wt-3 | `squeal status` (slowest 5%) | 290 ms (271–317) | 277 ms (253–322) | -5% noise |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1315 ms (1310–1323) | 1322 ms (1287–1373) | +1% noise |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 0.8 % core (0.7–0.9) | 0.8 % core (0.6–0.8) | -3% noise |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.5 s (0.4–0.5) | 0.6 s (0.5–0.7) | +17% noise |
| wt-3 | Daemon memory, peak | 372 MiB (352–398) | 384 MiB (354–402) | +3% noise |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 727 MiB (699–774) | 704 MiB (693–719) | -3% noise |
| wt-3 | Store process memory, peak | 188 MiB (172–201) | 189 MiB (176–197) | +0% noise |
| wt-3 | Store writes that held the lock over 250 ms | 8.7 (8–9) | 7 (6–8) | -19% noise |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 485 ms (448–514) | 505 ms (485–546) | +4% noise |
| wt-3 | Logged lock holds, total | 3.3 s (2.9–3.4) | 2.9 s (2.4–3.4) | -10% noise |
| wt-3 | `squeal impact` (store history read, no daemon; read module lists before 0.1.591) | 0.5 s (0.4–0.7) | 0.5 s (0.5–0.7) | -2% noise |
| wt-3 | `squeal impact` memory, peak | 139 MiB (133–147) | 136 MiB (133–138) | -2% noise |
| load-50 | Hook before each tool call (median) | 101 ms (98–104) | 109 ms (103–115) | +8% noise |
| load-50 | Hook before each tool call (slowest 5%) | 156 ms (154–157) | 176 ms (162–189) | +13% |
| load-50 | Hook after each batch of tool calls (median) | 141 ms (132–148) | 154 ms (138–163) | +9% noise |
| load-50 | Hook after each batch of tool calls (slowest 5%) | 275 ms (253–294) | 271 ms (232–313) | -1% noise |
| load-50 | Hook before each tool call (slowest 1%) | 167 ms (161–178) | 187 ms (170–201) | +12% noise |
| load-50 | Hook after each batch of tool calls (slowest 1%) | 330 ms (262–374) | 285 ms (244–325) | -14% noise |
| load-50 | Hook write wait for the daemon main thread (longest) | 75 ms (4–198) | 42 ms (17–73) | -44% noise |
| load-50 | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| load-50 | Hook at session start (slowest) | 194 ms (161–230) | 208 ms (205–212) | +7% noise |
| load-50 | `squeal status` (slowest 5%) | 273 ms (254–283) | 311 ms (281–348) | +14% noise |
| load-50 | Edit that breaks a test until the agent is told (median) | 1353 ms (1333–1382) | 1571 ms (1335–1994) | +16% noise |
| load-50 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% noise |
| load-50 | CPU with no edits: the busiest daemon, plus the store process | 0.5 % core (0.4–0.5) | 0.5 % core (0.4–0.8) | +16% noise |
| load-50 | CPU per edit: daemons with their test runs, plus the store process | 1.7 s | 2.1 s (1.9–2.3) | +22% |
| load-50 | Daemon memory, peak | 363 MiB (352–376) | 353 MiB (342–369) | -3% noise |
| load-50 | Daemon with its test runs, memory per worktree, peak | 1022 MiB (1011–1038) | 1070 MiB (1005–1150) | +5% noise |
| load-50 | Store process memory, peak | 143 MiB (142–146) | 143 MiB (139–147) | -1% noise |
| load-50 | Store writes that held the lock over 250 ms | 2 | 2.7 (2–3) | +33% noise |
| load-50 | Longest logged lock hold (only holds over 250 ms are logged) | 335 ms (319–350) | 400 ms (370–454) | +19% |
| load-50 | Logged lock holds, total | 0.6 s (0.6–0.7) | 1.0 s (0.7–1.2) | +53% |
| load-50 | `squeal impact` (store history read, no daemon; read module lists before 0.1.591) | 0.5 s (0.4–0.5) | 0.6 s (0.5–0.6) | +29% |
| load-50 | `squeal impact` memory, peak | 139 MiB (128–145) | 147 MiB (142–154) | +5% noise |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 24 of 24 cells: ref@0.1.665-r1 158 ms ⚠️, ref@0.1.665-r2 189 ms ⚠️, ref@0.1.665-r3 166 ms ⚠️, ref@0.1.666-r1 144 ms ⚠️, ref@0.1.666-r2 164 ms ⚠️, ref@0.1.666-r3 156 ms ⚠️, size-l@0.1.665-r1 132 ms ⚠️, size-l@0.1.665-r2 134 ms ⚠️, size-l@0.1.665-r3 165 ms ⚠️, size-l@0.1.666-r1 121 ms ⚠️, size-l@0.1.666-r2 139 ms ⚠️, size-l@0.1.666-r3 174 ms ⚠️, wt-3@0.1.665-r1 160 ms ⚠️, wt-3@0.1.665-r2 178 ms ⚠️, wt-3@0.1.665-r3 175 ms ⚠️, wt-3@0.1.666-r1 160 ms ⚠️, wt-3@0.1.666-r2 179 ms ⚠️, wt-3@0.1.666-r3 160 ms ⚠️, load-50@0.1.665-r1 157 ms ⚠️, load-50@0.1.665-r2 156 ms ⚠️, load-50@0.1.665-r3 154 ms ⚠️, load-50@0.1.666-r1 189 ms ⚠️, load-50@0.1.666-r2 162 ms ⚠️, load-50@0.1.666-r3 177 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 24 of 24 cells: ref@0.1.665-r1 174 ms ⚠️, ref@0.1.665-r2 195 ms ⚠️, ref@0.1.665-r3 196 ms ⚠️, ref@0.1.666-r1 186 ms ⚠️, ref@0.1.666-r2 198 ms ⚠️, ref@0.1.666-r3 188 ms ⚠️, size-l@0.1.665-r1 346 ms ❌, size-l@0.1.665-r2 343 ms ❌, size-l@0.1.665-r3 469 ms ❌, size-l@0.1.666-r1 385 ms ❌, size-l@0.1.666-r2 323 ms ❌, size-l@0.1.666-r3 515 ms ❌, wt-3@0.1.665-r1 217 ms ❌, wt-3@0.1.665-r2 209 ms ❌, wt-3@0.1.665-r3 237 ms ❌, wt-3@0.1.666-r1 237 ms ❌, wt-3@0.1.666-r2 262 ms ❌, wt-3@0.1.666-r3 195 ms ⚠️, load-50@0.1.665-r1 278 ms ❌, load-50@0.1.665-r2 253 ms ❌, load-50@0.1.665-r3 294 ms ❌, load-50@0.1.666-r1 313 ms ❌, load-50@0.1.666-r2 232 ms ❌, load-50@0.1.666-r3 270 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 9 of 24 cells: size-l@0.1.665-r2 330 ms ⚠️, size-l@0.1.665-r3 448 ms ⚠️, size-l@0.1.666-r1 344 ms ⚠️, size-l@0.1.666-r2 326 ms ⚠️, size-l@0.1.666-r3 483 ms ⚠️, wt-3@0.1.665-r3 317 ms ⚠️, wt-3@0.1.666-r2 322 ms ⚠️, load-50@0.1.666-r1 348 ms ⚠️, load-50@0.1.666-r3 305 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 8 of 24 cells: size-l@0.1.665-r2 317 ms ⚠️, size-l@0.1.665-r3 384 ms ⚠️, size-l@0.1.666-r1 302 ms ⚠️, size-l@0.1.666-r3 460 ms ⚠️, wt-3@0.1.665-r2 309 ms ⚠️, wt-3@0.1.665-r3 301 ms ⚠️, wt-3@0.1.666-r2 301 ms ⚠️, load-50@0.1.666-r1 404 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 17 of 24 cells: ref@0.1.665-r1 1.30 x ⚠️, ref@0.1.665-r2 1.37 x ⚠️, ref@0.1.665-r3 1.40 x ⚠️, ref@0.1.666-r1 1.44 x ⚠️, ref@0.1.666-r3 1.39 x ⚠️, size-l@0.1.665-r1 1.43 x ⚠️, size-l@0.1.665-r2 1.37 x ⚠️, size-l@0.1.665-r3 1.40 x ⚠️, size-l@0.1.666-r1 1.40 x ⚠️, size-l@0.1.666-r2 1.39 x ⚠️, size-l@0.1.666-r3 1.37 x ⚠️, load-50@0.1.665-r1 1.53 x ⚠️, load-50@0.1.665-r2 1.50 x ⚠️, load-50@0.1.665-r3 1.34 x ⚠️, load-50@0.1.666-r1 1.55 x ⚠️, load-50@0.1.666-r2 1.54 x ⚠️, load-50@0.1.666-r3 1.53 x ⚠️
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 7 of 24 cells: size-l@0.1.665-r1 223 s ⚠️, size-l@0.1.665-r2 223 s ⚠️, size-l@0.1.665-r3 240 s ⚠️, size-l@0.1.666-r1 223 s ⚠️, size-l@0.1.666-r2 221 s ⚠️, size-l@0.1.666-r3 late ❌, wt-3@0.1.666-r3 202 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 1 of 24 cells: size-l@0.1.665-r3 1.0 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 24 of 24 cells: ref@0.1.665-r1 365 MiB ⚠️, ref@0.1.665-r2 447 MiB ⚠️, ref@0.1.665-r3 362 MiB ⚠️, ref@0.1.666-r1 397 MiB ⚠️, ref@0.1.666-r2 392 MiB ⚠️, ref@0.1.666-r3 380 MiB ⚠️, size-l@0.1.665-r1 601 MiB ❌, size-l@0.1.665-r2 591 MiB ⚠️, size-l@0.1.665-r3 673 MiB ❌, size-l@0.1.666-r1 647 MiB ❌, size-l@0.1.666-r2 630 MiB ❌, size-l@0.1.666-r3 540 MiB ⚠️, wt-3@0.1.665-r1 365 MiB ⚠️, wt-3@0.1.665-r2 398 MiB ⚠️, wt-3@0.1.665-r3 352 MiB ⚠️, wt-3@0.1.666-r1 354 MiB ⚠️, wt-3@0.1.666-r2 402 MiB ⚠️, wt-3@0.1.666-r3 397 MiB ⚠️, load-50@0.1.665-r1 352 MiB ⚠️, load-50@0.1.665-r2 376 MiB ⚠️, load-50@0.1.665-r3 362 MiB ⚠️, load-50@0.1.666-r1 369 MiB ⚠️, load-50@0.1.666-r2 347 MiB ⚠️, load-50@0.1.666-r3 342 MiB ⚠️
- **Resources · Daemon with its test runs, memory per worktree, peak** (healthy ≤ 1200 MiB): 6 of 24 cells: size-l@0.1.665-r1 1405 MiB ⚠️, size-l@0.1.665-r2 1378 MiB ⚠️, size-l@0.1.665-r3 1457 MiB ⚠️, size-l@0.1.666-r1 1384 MiB ⚠️, size-l@0.1.666-r2 1340 MiB ⚠️, size-l@0.1.666-r3 1405 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 24 of 24 cells: ref@0.1.665-r1 2 ⚠️, ref@0.1.665-r2 2 ⚠️, ref@0.1.665-r3 2 ⚠️, ref@0.1.666-r1 2 ⚠️, ref@0.1.666-r2 2 ⚠️, ref@0.1.666-r3 1 ⚠️, size-l@0.1.665-r1 17 ❌, size-l@0.1.665-r2 17 ❌, size-l@0.1.665-r3 19 ❌, size-l@0.1.666-r1 17 ❌, size-l@0.1.666-r2 17 ❌, size-l@0.1.666-r3 17 ❌, wt-3@0.1.665-r1 9 ❌, wt-3@0.1.665-r2 9 ❌, wt-3@0.1.665-r3 8 ❌, wt-3@0.1.666-r1 7 ❌, wt-3@0.1.666-r2 6 ❌, wt-3@0.1.666-r3 8 ❌, load-50@0.1.665-r1 2 ⚠️, load-50@0.1.665-r2 2 ⚠️, load-50@0.1.665-r3 2 ⚠️, load-50@0.1.666-r1 3 ⚠️, load-50@0.1.666-r2 3 ⚠️, load-50@0.1.666-r3 2 ⚠️

## Before the idle minute

Every cell's baselines and store process settled before its idle minute.

## Machine speed per cell

Single-thread SHA-256 before→after the cell, and the CPU time the hypervisor took (steal) during it.

- ref@0.1.665-r1: SHA-256 1327→1361 MiB/s, steal 0.0%
- ref@0.1.665-r2: SHA-256 1379→1373 MiB/s, steal 0.0%
- ref@0.1.665-r3: SHA-256 1379→1372 MiB/s, steal 0.0%
- ref@0.1.666-r1: SHA-256 1360→1365 MiB/s, steal 0.0%
- ref@0.1.666-r2: SHA-256 1375→1373 MiB/s, steal 0.0%
- ref@0.1.666-r3: SHA-256 1379→1373 MiB/s, steal 0.0%
- size-l@0.1.665-r1: SHA-256 1380→1377 MiB/s, steal 0.0%
- size-l@0.1.665-r2: SHA-256 1384→1379 MiB/s, steal 0.0%
- size-l@0.1.665-r3: SHA-256 1223→1371 MiB/s, steal 1.0%
- size-l@0.1.666-r1: SHA-256 1377→1375 MiB/s, steal 0.0%
- size-l@0.1.666-r2: SHA-256 1385→1371 MiB/s, steal 0.0%
- size-l@0.1.666-r3: SHA-256 1382→1225 MiB/s, steal 0.5%
- wt-3@0.1.665-r1: SHA-256 1383→1351 MiB/s, steal 0.0%
- wt-3@0.1.665-r2: SHA-256 1375→1361 MiB/s, steal 0.0%
- wt-3@0.1.665-r3: SHA-256 1372→1372 MiB/s, steal 0.0%
- wt-3@0.1.666-r1: SHA-256 1371→1376 MiB/s, steal 0.0%
- wt-3@0.1.666-r2: SHA-256 1381→1360 MiB/s, steal 0.0%
- wt-3@0.1.666-r3: SHA-256 1381→1286 MiB/s, steal 0.2%
- load-50@0.1.665-r1: SHA-256 1364→1378 MiB/s, steal 0.0%
- load-50@0.1.665-r2: SHA-256 1384→1378 MiB/s, steal 0.0%
- load-50@0.1.665-r3: SHA-256 1272→1374 MiB/s, steal 0.0%
- load-50@0.1.666-r1: SHA-256 1298→1355 MiB/s, steal 0.7%
- load-50@0.1.666-r2: SHA-256 1375→1347 MiB/s, steal 0.0%
- load-50@0.1.666-r3: SHA-256 1345→1299 MiB/s, steal 0.1%

## Every metric

| Metric | Healthy | Warn | ref@0.1.665-r1 | ref@0.1.665-r2 | ref@0.1.665-r3 | ref@0.1.666-r1 | ref@0.1.666-r2 | ref@0.1.666-r3 | size-l@0.1.665-r1 | size-l@0.1.665-r2 | size-l@0.1.665-r3 | size-l@0.1.666-r1 | size-l@0.1.666-r2 | size-l@0.1.666-r3 | wt-3@0.1.665-r1 | wt-3@0.1.665-r2 | wt-3@0.1.665-r3 | wt-3@0.1.666-r1 | wt-3@0.1.666-r2 | wt-3@0.1.666-r3 | load-50@0.1.665-r1 | load-50@0.1.665-r2 | load-50@0.1.665-r3 | load-50@0.1.666-r1 | load-50@0.1.666-r2 | load-50@0.1.666-r3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Hook before each tool call (median) (`hook.preToolUse.p50`) | report |  | 102 ms | 103 ms | 104 ms | 99 ms | 101 ms | 104 ms | 103 ms | 103 ms | 105 ms | 102 ms | 101 ms | 115 ms | 101 ms | 99 ms | 99 ms | 104 ms | 101 ms | 98 ms | 98 ms | 104 ms | 100 ms | 115 ms | 103 ms | 110 ms |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 158 ms ⚠️ | 189 ms ⚠️ | 166 ms ⚠️ | 144 ms ⚠️ | 164 ms ⚠️ | 156 ms ⚠️ | 132 ms ⚠️ | 134 ms ⚠️ | 165 ms ⚠️ | 121 ms ⚠️ | 139 ms ⚠️ | 174 ms ⚠️ | 160 ms ⚠️ | 178 ms ⚠️ | 175 ms ⚠️ | 160 ms ⚠️ | 179 ms ⚠️ | 160 ms ⚠️ | 157 ms ⚠️ | 156 ms ⚠️ | 154 ms ⚠️ | 189 ms ⚠️ | 162 ms ⚠️ | 177 ms ⚠️ |
| Hook after each batch of tool calls (median) (`hook.postToolBatch.p50`) | report |  | 129 ms | 137 ms | 124 ms | 125 ms | 119 ms | 134 ms | 160 ms | 146 ms | 178 ms | 162 ms | 154 ms | 213 ms | 134 ms | 130 ms | 141 ms | 124 ms | 127 ms | 128 ms | 148 ms | 132 ms | 143 ms | 163 ms | 138 ms | 161 ms |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 174 ms ⚠️ | 195 ms ⚠️ | 196 ms ⚠️ | 186 ms ⚠️ | 198 ms ⚠️ | 188 ms ⚠️ | 346 ms ❌ | 343 ms ❌ | 469 ms ❌ | 385 ms ❌ | 323 ms ❌ | 515 ms ❌ | 217 ms ❌ | 209 ms ❌ | 237 ms ❌ | 237 ms ❌ | 262 ms ❌ | 195 ms ⚠️ | 278 ms ❌ | 253 ms ❌ | 294 ms ❌ | 313 ms ❌ | 232 ms ❌ | 270 ms ❌ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 163 ms | 199 ms | 173 ms | 153 ms | 182 ms | 167 ms | 239 ms | 277 ms | 314 ms | 123 ms | 260 ms | 293 ms | 176 ms | 205 ms | 208 ms | 184 ms | 187 ms | 197 ms | 178 ms | 161 ms | 161 ms | 190 ms | 170 ms | 201 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 164 ms | 202 ms | 175 ms | 156 ms | 186 ms | 169 ms | 266 ms | 313 ms | 352 ms | 124 ms | 291 ms | 323 ms | 194 ms | 208 ms | 232 ms | 207 ms | 190 ms | 201 ms | 184 ms | 162 ms | 163 ms | 190 ms | 172 ms | 207 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 176 ms | 208 ms | 203 ms | 201 ms | 213 ms | 194 ms | 371 ms | 348 ms | 479 ms | 417 ms | 380 ms | 571 ms | 267 ms | 227 ms | 258 ms | 270 ms | 324 ms | 213 ms | 353 ms | 262 ms | 374 ms | 325 ms | 244 ms | 285 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 176 ms | 212 ms | 203 ms | 206 ms | 215 ms | 196 ms | 377 ms | 349 ms | 480 ms | 427 ms | 397 ms | 585 ms | 291 ms | 254 ms | 266 ms | 305 ms | 330 ms | 226 ms | 378 ms | 263 ms | 402 ms | 329 ms | 248 ms | 289 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | 22 ms | 12 ms | 12 ms | 9 ms | 17 ms | 13 ms | 25 ms | 42 ms | 40 ms | 23 ms | 15 ms | 34 ms | 40 ms | 39 ms | 56 ms | 16 ms | 45 ms | 15 ms | 198 ms | 4 ms | 23 ms | 17 ms | 35 ms | 73 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | 22 ms | 12 ms | 12 ms | 9 ms | 17 ms | 13 ms | 25 ms | 42 ms | 40 ms | 23 ms | 15 ms | 34 ms | 40 ms | 39 ms | 56 ms | 16 ms | 45 ms | 15 ms | 198 ms | 4 ms | 23 ms | 17 ms | 35 ms | 73 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 176 ms ✅ | 204 ms ✅ | 190 ms ✅ | 198 ms ✅ | 154 ms ✅ | 168 ms ✅ | 333 ms ✅ | 325 ms ✅ | 511 ms ✅ | 287 ms ✅ | 337 ms ✅ | 352 ms ✅ | 180 ms ✅ | 168 ms ✅ | 189 ms ✅ | 259 ms ✅ | 211 ms ✅ | 240 ms ✅ | 191 ms ✅ | 161 ms ✅ | 230 ms ✅ | 212 ms ✅ | 205 ms ✅ | 207 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 217 ms ✅ | 164 ms ✅ | 181 ms ✅ | 178 ms ✅ | 191 ms ✅ | 176 ms ✅ | 395 ms ✅ | 346 ms ✅ | 368 ms ✅ | 319 ms ✅ | 376 ms ✅ | 736 ms ✅ | 249 ms ✅ | 239 ms ✅ | 223 ms ✅ | 177 ms ✅ | 183 ms ✅ | 279 ms ✅ | 164 ms ✅ | 169 ms ✅ | 173 ms ✅ | 282 ms ✅ | 351 ms ✅ | 204 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 266 ms ✅ | 245 ms ✅ | 282 ms ✅ | 243 ms ✅ | 226 ms ✅ | 244 ms ✅ | 288 ms ✅ | 330 ms ⚠️ | 448 ms ⚠️ | 344 ms ⚠️ | 326 ms ⚠️ | 483 ms ⚠️ | 284 ms ✅ | 271 ms ✅ | 317 ms ⚠️ | 255 ms ✅ | 322 ms ⚠️ | 253 ms ✅ | 283 ms ✅ | 254 ms ✅ | 283 ms ✅ | 348 ms ⚠️ | 281 ms ✅ | 305 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 248 ms ✅ | 242 ms ✅ | 233 ms ✅ | 215 ms ✅ | 208 ms ✅ | 223 ms ✅ | 296 ms ✅ | 317 ms ⚠️ | 384 ms ⚠️ | 302 ms ⚠️ | 291 ms ✅ | 460 ms ⚠️ | 232 ms ✅ | 309 ms ⚠️ | 301 ms ⚠️ | 276 ms ✅ | 301 ms ⚠️ | 255 ms ✅ | 279 ms ✅ | 233 ms ✅ | 241 ms ✅ | 404 ms ⚠️ | 260 ms ✅ | 293 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 659 ms ✅ | 630 ms ✅ | 635 ms ✅ | 734 ms ✅ | 647 ms ✅ | 614 ms ✅ | 608 ms ✅ | 658 ms ✅ | 724 ms ✅ | 666 ms ✅ | 650 ms ✅ | 628 ms ✅ | 696 ms ✅ | 670 ms ✅ | 674 ms ✅ | 801 ms ✅ | 664 ms ✅ | 680 ms ✅ | 840 ms ✅ | 612 ms ✅ | 782 ms ✅ | 931 ms ✅ | 609 ms ✅ | 789 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 485 ms ✅ | 499 ms ✅ | 524 ms ✅ | 431 ms ✅ | 496 ms ✅ | 495 ms ✅ | n/a | n/a | n/a | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.30 x ⚠️ | 1.37 x ⚠️ | 1.40 x ⚠️ | 1.44 x ⚠️ | 1.29 x ✅ | 1.39 x ⚠️ | 1.43 x ⚠️ | 1.37 x ⚠️ | 1.40 x ⚠️ | 1.40 x ⚠️ | 1.39 x ⚠️ | 1.37 x ⚠️ | n/a | n/a | n/a | n/a | n/a | n/a | 1.53 x ⚠️ | 1.50 x ⚠️ | 1.34 x ⚠️ | 1.55 x ⚠️ | 1.54 x ⚠️ | 1.53 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 60 s | 58 s | 59 s | 64 s | 59 s | 59 s | 238 s | 234 s | 302 s | 244 s | 234 s | 231 s | 58 s | 61 s | 64 s | 62 s | 57 s | 60 s | 97 s | 80 s | 86 s | 112 s | 82 s | 93 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1265 ms ✅ | 1299 ms ✅ | 1280 ms ✅ | 1276 ms ✅ | 1270 ms ✅ | 1269 ms ✅ | 1454 ms ✅ | 1471 ms ✅ | 1614 ms ✅ | 1538 ms ✅ | 1478 ms ✅ | 1630 ms ✅ | 1313 ms ✅ | 1323 ms ✅ | 1310 ms ✅ | 1308 ms ✅ | 1373 ms ✅ | 1287 ms ✅ | 1382 ms ✅ | 1333 ms ✅ | 1344 ms ✅ | 1994 ms ✅ | 1335 ms ✅ | 1384 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1704 ms ✅ | 1676 ms ✅ | 1691 ms ✅ | 1696 ms ✅ | 1651 ms ✅ | 1669 ms ✅ | 2451 ms ✅ | 2445 ms ✅ | 2890 ms ✅ | 2452 ms ✅ | 2400 ms ✅ | 2828 ms ✅ | 1728 ms ✅ | 1718 ms ✅ | 1723 ms ✅ | 1664 ms ✅ | 1719 ms ✅ | 1716 ms ✅ | 1831 ms ✅ | 1766 ms ✅ | 2429 ms ✅ | 2488 ms ✅ | 2304 ms ✅ | 2399 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 5757 ms ✅ | 5749 ms ✅ | 5320 ms ✅ | 5776 ms ✅ | 4763 ms ✅ | 5780 ms ✅ | 6070 ms ✅ | 5994 ms ✅ | 7989 ms ✅ | 6655 ms ✅ | 5974 ms ✅ | 7426 ms ✅ | 5750 ms ✅ | 5848 ms ✅ | 6414 ms ✅ | 5769 ms ✅ | 6383 ms ✅ | 5784 ms ✅ | 6929 ms ✅ | 6365 ms ✅ | 5779 ms ✅ | 9700 ms ✅ | 6895 ms ✅ | 6912 ms ✅ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 57 s ✅ | 53 s ✅ | 57 s ✅ | 53 s ✅ | 51 s ✅ | 52 s ✅ | 223 s ⚠️ | 223 s ⚠️ | 240 s ⚠️ | 223 s ⚠️ | 221 s ⚠️ | late ❌ | 164 s ✅ | 168 s ✅ | 166 s ✅ | 169 s ✅ | 171 s ✅ | 202 s ⚠️ | 159 s ✅ | 79 s ✅ | 82 s ✅ | 104 s ✅ | 92 s ✅ | 148 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.7 % core ✅ | 0.8 % core ✅ | 0.8 % core ✅ | 0.8 % core ✅ | 0.7 % core ✅ | 0.7 % core ✅ | 0.6 % core ✅ | 0.6 % core ✅ | 1.0 % core ⚠️ | 0.7 % core ✅ | 0.8 % core ✅ | 0.7 % core ✅ | 0.9 % core ✅ | 0.7 % core ✅ | 0.8 % core ✅ | 0.6 % core ✅ | 0.8 % core ✅ | 0.8 % core ✅ | 0.4 % core ✅ | 0.5 % core ✅ | 0.4 % core ✅ | 0.4 % core ✅ | 0.8 % core ✅ | 0.4 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 365 MiB ⚠️ | 447 MiB ⚠️ | 362 MiB ⚠️ | 397 MiB ⚠️ | 392 MiB ⚠️ | 380 MiB ⚠️ | 601 MiB ❌ | 591 MiB ⚠️ | 673 MiB ❌ | 647 MiB ❌ | 630 MiB ❌ | 540 MiB ⚠️ | 365 MiB ⚠️ | 398 MiB ⚠️ | 352 MiB ⚠️ | 354 MiB ⚠️ | 402 MiB ⚠️ | 397 MiB ⚠️ | 352 MiB ⚠️ | 376 MiB ⚠️ | 362 MiB ⚠️ | 369 MiB ⚠️ | 347 MiB ⚠️ | 342 MiB ⚠️ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 1019 MiB ✅ | 1081 MiB ✅ | 1038 MiB ✅ | 996 MiB ✅ | 1047 MiB ✅ | 1036 MiB ✅ | 1405 MiB ⚠️ | 1378 MiB ⚠️ | 1457 MiB ⚠️ | 1384 MiB ⚠️ | 1340 MiB ⚠️ | 1405 MiB ⚠️ | 774 MiB ✅ | 710 MiB ✅ | 699 MiB ✅ | 700 MiB ✅ | 693 MiB ✅ | 719 MiB ✅ | 1019 MiB ✅ | 1011 MiB ✅ | 1038 MiB ✅ | 1150 MiB ✅ | 1005 MiB ✅ | 1055 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.8 s | 1.8 s | 1.9 s | 1.7 s | 1.8 s | 1.8 s | 4.0 s | 3.9 s | 4.4 s | 4.1 s | 3.7 s | 5.7 s | 0.5 s | 0.4 s | 0.5 s | 0.5 s | 0.7 s | 0.5 s | 1.7 s | 1.7 s | 1.7 s | 2.3 s | 1.9 s | 2.0 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.4 s | 1.4 s | 1.5 s | 1.3 s | 1.4 s | 1.3 s | 5.1 s | 5.3 s | 6.3 s | 5.5 s | 5.1 s | 8.2 s | 3.4 s | 3.4 s | 3.5 s | 3.7 s | 3.6 s | 3.7 s | 1.3 s | 1.2 s | 1.2 s | 1.8 s | 1.5 s | 1.5 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 149 MiB | 154 MiB | 151 MiB | 142 MiB | 138 MiB | 151 MiB | 240 MiB | 252 MiB | 196 MiB | 237 MiB | 214 MiB | 252 MiB | 172 MiB | 201 MiB | 191 MiB | 197 MiB | 176 MiB | 193 MiB | 143 MiB | 146 MiB | 142 MiB | 139 MiB | 147 MiB | 142 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 2 ⚠️ | 2 ⚠️ | 2 ⚠️ | 2 ⚠️ | 1 ⚠️ | 17 ❌ | 17 ❌ | 19 ❌ | 17 ❌ | 17 ❌ | 17 ❌ | 9 ❌ | 9 ❌ | 8 ❌ | 7 ❌ | 6 ❌ | 8 ❌ | 2 ⚠️ | 2 ⚠️ | 2 ⚠️ | 3 ⚠️ | 3 ⚠️ | 2 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 18 MiB | 20 MiB | 23 MiB | 18 MiB | 19 MiB | 20 MiB | 59 MiB | 56 MiB | 56 MiB | 56 MiB | 56 MiB | 56 MiB | 39 MiB | 39 MiB | 39 MiB | 37 MiB | 39 MiB | 39 MiB | 20 MiB | 18 MiB | 19 MiB | 18 MiB | 17 MiB | 18 MiB |
| Result rows in the store (`store.results`) | report |  | 8190 | 8190 | 8190 | 8190 | 8190 | 8190 | 28994 | 28994 | 28994 | 28994 | 28994 | 27622 | 17038 | 17038 | 17038 | 17038 | 17038 | 17038 | 8190 | 8190 | 8190 | 8190 | 8190 | 8190 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Module lists the aged store held (`store.lists.aged`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Module lists left at the cell's end (`store.lists.left`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 1 ms | 1 ms | 6 ms | 1 ms | 1 ms | 0 ms | 1 ms | 0 ms | 3 ms | 1 ms | 0 ms | 1 ms | 64 ms | 81 ms | 56 ms | 54 ms | 70 ms | 43 ms | 1 ms | 1 ms | 1 ms | 1 ms | 1 ms | 2 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 2.7 s | 2.5 s | 2.8 s | 2.8 s | 2.8 s | 2.8 s | 11 s | 11 s | 17 s | 11 s | 11 s | 14 s | 6.8 s | 6.7 s | 7.0 s | 7.1 s | 7.0 s | 7.0 s | 3.4 s | 3.3 s | 3.4 s | 5.8 s | 4.9 s | 4.0 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal impact` (store history read, no daemon; read module lists before 0.1.591) (`cmd.impact.s`) | report |  | 0.4 s | 0.5 s | 0.4 s | 0.5 s | 0.5 s | 0.5 s | 1.1 s | 1.0 s | 1.0 s | 1.1 s | 1.2 s | 2.0 s | 0.7 s | 0.5 s | 0.4 s | 0.5 s | 0.5 s | 0.7 s | 0.5 s | 0.4 s | 0.4 s | 0.6 s | 0.6 s | 0.5 s |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 138 MiB | 138 MiB | 127 MiB | 137 MiB | 133 MiB | 132 MiB | 235 MiB | 245 MiB | 231 MiB | 228 MiB | 232 MiB | 244 MiB | 133 MiB | 136 MiB | 147 MiB | 138 MiB | 133 MiB | 138 MiB | 144 MiB | 145 MiB | 128 MiB | 142 MiB | 154 MiB | 144 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 343 ms | 308 ms | 327 ms | 331 ms | 309 ms | 311 ms | 3112 ms | 2962 ms | 3131 ms | 3090 ms | 2920 ms | 4252 ms | 514 ms | 494 ms | 448 ms | 485 ms | 485 ms | 546 ms | 319 ms | 337 ms | 350 ms | 454 ms | 375 ms | 370 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.6 s | 0.6 s | 0.6 s | 0.6 s | 0.6 s | 0.3 s | 10 s | 9.9 s | 12 s | 10 s | 10 s | 13 s | 3.4 s | 3.4 s | 2.9 s | 2.9 s | 2.4 s | 3.4 s | 0.6 s | 0.6 s | 0.7 s | 1.2 s | 1.0 s | 0.7 s |
