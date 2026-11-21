# Squeal performance scorecard

Squeal 0.1.587 vs 0.1.589 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2535 MiB/s · 2026-11-21T16:45:41.886Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 59 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 60 | 92 | 47 | 45 | 53 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| store-7g@0.1.587-r1 | 500 | 1 | 0% | 326 | ✅ | 61 | 75 | 88 | 40 | 50 | 50 |
| store-7g@0.1.587-r2 | 500 | 1 | 0% | 326 | ✅ | 48 | 38 | 75 | 30 | 50 | 50 |
| store-7g@0.1.589-r1 | 500 | 1 | 0% | 326 | ✅ | 54 | 50 | 88 | 30 | 50 | 50 |
| store-7g@0.1.589-r2 | 500 | 1 | 0% | 326 | ✅ | 56 | 50 | 100 | 30 | 50 | 50 |
| store-7g-wt3@0.1.587-r1 | 500 | 3 | 0% | 326 | ✅ | 60 | 63 | 100 | 60 | 25 | 50 |
| store-7g-wt3@0.1.587-r2 | 500 | 3 | 0% | 326 | ✅ | 55 | 50 | 100 | 50 | 25 | 50 |
| store-7g-wt3@0.1.589-r1 | 500 | 3 | 0% | 326 | ✅ | 60 | 50 | 100 | 50 | 50 | 50 |
| store-7g-wt3@0.1.589-r2 | 500 | 3 | 0% | 326 | ✅ | 57 | 50 | 75 | 60 | 50 | 50 |
| store-7g-wt3-nolists@0.1.587-r1 | 500 | 3 | 0% | 326 | ✅ | 65 | 63 | 100 | 60 | 50 | 50 |
| store-7g-wt3-nolists@0.1.587-r2 | 500 | 3 | 0% | 326 | ✅ | 55 | 50 | 75 | 50 | 50 | 50 |
| store-7g-wt3-nolists@0.1.589-r1 | 500 | 3 | 0% | 326 | ✅ | 60 | 63 | 100 | 60 | 25 | 50 |
| store-7g-wt3-nolists@0.1.589-r2 | 500 | 3 | 0% | 326 | ✅ | 67 | 75 | 100 | 60 | 50 | 50 |
| store-7g-lists1d@0.1.587-r1 | 500 | 1 | 0% | 326 | ✅ | 66 | 75 | 88 | 40 | 50 | 75 |
| store-7g-lists1d@0.1.587-r2 | 500 | 1 | 0% | 326 | ✅ | 63 | 75 | 100 | 40 | 50 | 50 |
| store-7g-lists1d@0.1.589-r1 | 500 | 1 | 0% | 326 | ✅ | 66 | 75 | 88 | 40 | 50 | 75 |

## 0.1.587 compared with 0.1.589 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| store-7g | 0.1.587 | 2 | ✅ | 55 (48–61) |  |  |  |  |  |  |
| store-7g | 0.1.589 | 2 | ✅ | 55 (54–56) | +0 | -6 | +13 | -5 | +0 | +0 |
| store-7g-wt3 | 0.1.587 | 2 | ✅ | 57 (55–60) |  |  |  |  |  |  |
| store-7g-wt3 | 0.1.589 | 2 | ✅ | 59 (57–60) | +1 | -6 | -13 | +0 | +25 | +0 |
| store-7g-wt3-nolists | 0.1.587 | 2 | ✅ | 60 (55–65) |  |  |  |  |  |  |
| store-7g-wt3-nolists | 0.1.589 | 2 | ✅ | 63 (60–67) | +4 | +13 | +13 | +5 | -13 | +0 |
| store-7g-lists1d | 0.1.587 | 2 | ✅ | 64 (63–66) |  |  |  |  |  |  |
| store-7g-lists1d | 0.1.589 | 1 | ✅ | 66 | +1 | +0 | -6 | +0 | +0 | +13 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.587 | 0.1.589 | Δ% |
|---|---|---:|---:|---:|
| store-7g | Hook before each tool call (slowest 5%) | 189 ms | 697 ms | +268% |
| store-7g | Hook after each batch of tool calls (slowest 5%) | 214 ms | 860 ms | +302% |
| store-7g | Hook at session start (slowest) | 599 ms | 185 ms | -69% |
| store-7g | `squeal status` (slowest 5%) | 287 ms | 241 ms | -16% |
| store-7g | Edit that breaks a test until the agent is told (median) | 1276 ms | 1855 ms | +45% |
| store-7g | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| store-7g | CPU with no edits: the busiest daemon, plus the store process | 2.6 % core | 2.0 % core | -22% |
| store-7g | CPU per edit: daemons with their test runs, plus the store process | 1.5 s | 22 s | +1338% |
| store-7g | Daemon memory, peak | 514 MiB | 494 MiB | -4% |
| store-7g | Store process memory, peak | 145 MiB | 149 MiB | +3% |
| store-7g | Store writes that held the lock over 250 ms | 5 | 540 | +10700% |
| store-7g | Longest logged lock hold (only holds over 250 ms are logged) | 1903 ms | 2338 ms | +23% |
| store-7g | Logged lock holds, total | 5.2 s | 386 s | +7391% |
| store-7g | `squeal reach` (reads every stored module list) | 75 s | 0.4 s | -99% |
| store-7g | `squeal reach` memory, peak | 2244 MiB | 117 MiB | -95% |
| store-7g-wt3 | Hook before each tool call (slowest 5%) | 152 ms | 764 ms | +402% |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 5%) | 215 ms | 951 ms | +343% |
| store-7g-wt3 | Hook at session start (slowest) | 1107 ms | 367 ms | -67% |
| store-7g-wt3 | `squeal status` (slowest 5%) | 241 ms | 265 ms | +10% |
| store-7g-wt3 | Edit that breaks a test until the agent is told (median) | 1257 ms | 2288 ms | +82% |
| store-7g-wt3 | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| store-7g-wt3 | CPU with no edits: the busiest daemon, plus the store process | 5.5 % core | 3.9 % core | -29% |
| store-7g-wt3 | CPU per edit: daemons with their test runs, plus the store process | 0.5 s | 6.7 s | +1353% |
| store-7g-wt3 | Daemon memory, peak | 501 MiB | 515 MiB | +3% |
| store-7g-wt3 | Store process memory, peak | 183 MiB | 165 MiB | -10% |
| store-7g-wt3 | Store writes that held the lock over 250 ms | 19 | 593 | +3105% |
| store-7g-wt3 | Longest logged lock hold (only holds over 250 ms are logged) | 2567 ms | 2739 ms | +7% |
| store-7g-wt3 | Logged lock holds, total | 15 s | 371 s | +2372% |
| store-7g-wt3 | `squeal reach` (reads every stored module list) | 46 s | 0.3 s | -99% |
| store-7g-wt3 | `squeal reach` memory, peak | 2159 MiB | 100 MiB | -95% |
| store-7g-wt3-nolists | Hook before each tool call (slowest 5%) | 188 ms | 111 ms | -41% |
| store-7g-wt3-nolists | Hook after each batch of tool calls (slowest 5%) | 277 ms | 186 ms | -33% |
| store-7g-wt3-nolists | Hook at session start (slowest) | 129 ms | 146 ms | +13% |
| store-7g-wt3-nolists | `squeal status` (slowest 5%) | 354 ms | 214 ms | -39% |
| store-7g-wt3-nolists | Edit that breaks a test until the agent is told (median) | 1261 ms | 1188 ms | -6% |
| store-7g-wt3-nolists | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| store-7g-wt3-nolists | CPU with no edits: the busiest daemon, plus the store process | 3.9 % core | 3.8 % core | -1% |
| store-7g-wt3-nolists | CPU per edit: daemons with their test runs, plus the store process | 0.5 s | 0.4 s | -26% |
| store-7g-wt3-nolists | Daemon memory, peak | 497 MiB | 554 MiB | +11% |
| store-7g-wt3-nolists | Store process memory, peak | 203 MiB | 191 MiB | -6% |
| store-7g-wt3-nolists | Store writes that held the lock over 250 ms | 18 | 10 | -44% |
| store-7g-wt3-nolists | Longest logged lock hold (only holds over 250 ms are logged) | 956 ms | 1020 ms | +7% |
| store-7g-wt3-nolists | Logged lock holds, total | 9.0 s | 5.0 s | -45% |
| store-7g-wt3-nolists | `squeal reach` (reads every stored module list) | 0.4 s | 0.2 s | -48% |
| store-7g-wt3-nolists | `squeal reach` memory, peak | 140 MiB | 85 MiB | -39% |
| store-7g-lists1d | Hook before each tool call (slowest 5%) | 123 ms | 171 ms | +38% |
| store-7g-lists1d | Hook after each batch of tool calls (slowest 5%) | 179 ms | 199 ms | +11% |
| store-7g-lists1d | Hook at session start (slowest) | 142 ms | 156 ms | +9% |
| store-7g-lists1d | `squeal status` (slowest 5%) | 179 ms | 319 ms | +78% |
| store-7g-lists1d | Edit that breaks a test until the agent is told (median) | 1194 ms | 1226 ms | +3% |
| store-7g-lists1d | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| store-7g-lists1d | CPU with no edits: the busiest daemon, plus the store process | 2.1 % core | 2.3 % core | +9% |
| store-7g-lists1d | CPU per edit: daemons with their test runs, plus the store process | 1.2 s | 2.5 s | +104% |
| store-7g-lists1d | Daemon memory, peak | 529 MiB | 503 MiB | -5% |
| store-7g-lists1d | Store process memory, peak | 155 MiB | 147 MiB | -5% |
| store-7g-lists1d | Store writes that held the lock over 250 ms | 4 | 2 | -50% |
| store-7g-lists1d | Longest logged lock hold (only holds over 250 ms are logged) | 770 ms | 434 ms | -44% |
| store-7g-lists1d | Logged lock holds, total | 1.9 s | 0.8 s | -57% |
| store-7g-lists1d | `squeal reach` (reads every stored module list) | 9.6 s | 0.2 s | -98% |
| store-7g-lists1d | `squeal reach` memory, peak | 2194 MiB | 88 MiB | -96% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 15 of 15 cells: store-7g@0.1.587-r1 94 ms ⚠️, store-7g@0.1.587-r2 285 ms ❌, store-7g@0.1.589-r1 862 ms ❌, store-7g@0.1.589-r2 531 ms ❌, store-7g-wt3@0.1.587-r1 136 ms ⚠️, store-7g-wt3@0.1.587-r2 169 ms ⚠️, store-7g-wt3@0.1.589-r1 777 ms ❌, store-7g-wt3@0.1.589-r2 751 ms ❌, store-7g-wt3-nolists@0.1.587-r1 164 ms ⚠️, store-7g-wt3-nolists@0.1.587-r2 212 ms ❌, store-7g-wt3-nolists@0.1.589-r1 124 ms ⚠️, store-7g-wt3-nolists@0.1.589-r2 98 ms ⚠️, store-7g-lists1d@0.1.587-r1 137 ms ⚠️, store-7g-lists1d@0.1.587-r2 109 ms ⚠️, store-7g-lists1d@0.1.589-r1 171 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 15 of 15 cells: store-7g@0.1.587-r1 153 ms ⚠️, store-7g@0.1.587-r2 275 ms ❌, store-7g@0.1.589-r1 1063 ms ❌, store-7g@0.1.589-r2 656 ms ❌, store-7g-wt3@0.1.587-r1 189 ms ⚠️, store-7g-wt3@0.1.587-r2 240 ms ❌, store-7g-wt3@0.1.589-r1 771 ms ❌, store-7g-wt3@0.1.589-r2 1130 ms ❌, store-7g-wt3-nolists@0.1.587-r1 237 ms ❌, store-7g-wt3-nolists@0.1.587-r2 317 ms ❌, store-7g-wt3-nolists@0.1.589-r1 225 ms ❌, store-7g-wt3-nolists@0.1.589-r2 146 ms ⚠️, store-7g-lists1d@0.1.587-r1 175 ms ⚠️, store-7g-lists1d@0.1.587-r2 182 ms ⚠️, store-7g-lists1d@0.1.589-r1 199 ms ⚠️
- **Hooks · Hook at session start (slowest)** (healthy ≤ 750 ms): 3 of 15 cells: store-7g@0.1.587-r2 1086 ms ⚠️, store-7g-wt3@0.1.587-r1 1113 ms ⚠️, store-7g-wt3@0.1.587-r2 1102 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 4 of 15 cells: store-7g@0.1.587-r2 381 ms ⚠️, store-7g-wt3@0.1.589-r2 322 ms ⚠️, store-7g-wt3-nolists@0.1.587-r2 408 ms ⚠️, store-7g-lists1d@0.1.589-r1 319 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 4 of 15 cells: store-7g@0.1.587-r2 313 ms ⚠️, store-7g@0.1.589-r1 347 ms ⚠️, store-7g-wt3@0.1.589-r2 308 ms ⚠️, store-7g-wt3-nolists@0.1.587-r2 381 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 2 of 15 cells: store-7g@0.1.587-r1 1.33 x ⚠️, store-7g-lists1d@0.1.587-r1 1.43 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 7 of 15 cells: store-7g@0.1.587-r1 late ❌, store-7g@0.1.587-r2 late ❌, store-7g@0.1.589-r1 late ❌, store-7g@0.1.589-r2 late ❌, store-7g-lists1d@0.1.587-r1 late ❌, store-7g-lists1d@0.1.587-r2 late ❌, store-7g-lists1d@0.1.589-r1 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 15 of 15 cells: store-7g@0.1.587-r1 late ❌, store-7g@0.1.587-r2 late ❌, store-7g@0.1.589-r1 late ❌, store-7g@0.1.589-r2 late ❌, store-7g-wt3@0.1.587-r1 late ❌, store-7g-wt3@0.1.587-r2 late ❌, store-7g-wt3@0.1.589-r1 late ❌, store-7g-wt3@0.1.589-r2 late ❌, store-7g-wt3-nolists@0.1.587-r1 late ❌, store-7g-wt3-nolists@0.1.587-r2 late ❌, store-7g-wt3-nolists@0.1.589-r1 late ❌, store-7g-wt3-nolists@0.1.589-r2 late ❌, store-7g-lists1d@0.1.587-r1 late ❌, store-7g-lists1d@0.1.587-r2 late ❌, store-7g-lists1d@0.1.589-r1 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 15 of 15 cells: store-7g@0.1.587-r1 50 % ❌, store-7g@0.1.587-r2 50 % ❌, store-7g@0.1.589-r1 50 % ❌, store-7g@0.1.589-r2 50 % ❌, store-7g-wt3@0.1.587-r1 69 % ❌, store-7g-wt3@0.1.587-r2 69 % ❌, store-7g-wt3@0.1.589-r1 69 % ❌, store-7g-wt3@0.1.589-r2 69 % ❌, store-7g-wt3-nolists@0.1.587-r1 69 % ❌, store-7g-wt3-nolists@0.1.587-r2 69 % ❌, store-7g-wt3-nolists@0.1.589-r1 69 % ❌, store-7g-wt3-nolists@0.1.589-r2 69 % ❌, store-7g-lists1d@0.1.587-r1 50 % ❌, store-7g-lists1d@0.1.587-r2 50 % ❌, store-7g-lists1d@0.1.589-r1 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 15 cells: store-7g@0.1.587-r2 208 s ⚠️, store-7g@0.1.589-r1 207 s ⚠️, store-7g@0.1.589-r2 205 s ⚠️, store-7g-wt3@0.1.587-r2 183 s ⚠️, store-7g-wt3@0.1.589-r1 185 s ⚠️, store-7g-wt3-nolists@0.1.587-r2 200 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 15 of 15 cells: store-7g@0.1.587-r1 1.7 % core ⚠️, store-7g@0.1.587-r2 3.5 % core ⚠️, store-7g@0.1.589-r1 2.2 % core ⚠️, store-7g@0.1.589-r2 1.9 % core ⚠️, store-7g-wt3@0.1.587-r1 5.8 % core ❌, store-7g-wt3@0.1.587-r2 5.2 % core ❌, store-7g-wt3@0.1.589-r1 3.2 % core ⚠️, store-7g-wt3@0.1.589-r2 4.5 % core ⚠️, store-7g-wt3-nolists@0.1.587-r1 4.5 % core ⚠️, store-7g-wt3-nolists@0.1.587-r2 3.2 % core ⚠️, store-7g-wt3-nolists@0.1.589-r1 4.0 % core ⚠️, store-7g-wt3-nolists@0.1.589-r2 3.7 % core ⚠️, store-7g-lists1d@0.1.587-r1 2.2 % core ⚠️, store-7g-lists1d@0.1.587-r2 2.0 % core ⚠️, store-7g-lists1d@0.1.589-r1 2.3 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 15 of 15 cells: store-7g@0.1.587-r1 513 MiB ⚠️, store-7g@0.1.587-r2 515 MiB ⚠️, store-7g@0.1.589-r1 523 MiB ⚠️, store-7g@0.1.589-r2 464 MiB ⚠️, store-7g-wt3@0.1.587-r1 505 MiB ⚠️, store-7g-wt3@0.1.587-r2 498 MiB ⚠️, store-7g-wt3@0.1.589-r1 505 MiB ⚠️, store-7g-wt3@0.1.589-r2 525 MiB ⚠️, store-7g-wt3-nolists@0.1.587-r1 517 MiB ⚠️, store-7g-wt3-nolists@0.1.587-r2 477 MiB ⚠️, store-7g-wt3-nolists@0.1.589-r1 600 MiB ❌, store-7g-wt3-nolists@0.1.589-r2 507 MiB ⚠️, store-7g-lists1d@0.1.587-r1 557 MiB ⚠️, store-7g-lists1d@0.1.587-r2 501 MiB ⚠️, store-7g-lists1d@0.1.589-r1 503 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 15 of 15 cells: store-7g@0.1.587-r1 5 ❌, store-7g@0.1.587-r2 5 ❌, store-7g@0.1.589-r1 512 ❌, store-7g@0.1.589-r2 568 ❌, store-7g-wt3@0.1.587-r1 18 ❌, store-7g-wt3@0.1.587-r2 19 ❌, store-7g-wt3@0.1.589-r1 615 ❌, store-7g-wt3@0.1.589-r2 571 ❌, store-7g-wt3-nolists@0.1.587-r1 15 ❌, store-7g-wt3-nolists@0.1.587-r2 21 ❌, store-7g-wt3-nolists@0.1.589-r1 10 ❌, store-7g-wt3-nolists@0.1.589-r2 10 ❌, store-7g-lists1d@0.1.587-r1 3 ⚠️, store-7g-lists1d@0.1.587-r2 5 ❌, store-7g-lists1d@0.1.589-r1 2 ⚠️

## Every metric

| Metric | Healthy | Warn | store-7g@0.1.587-r1 | store-7g@0.1.587-r2 | store-7g@0.1.589-r1 | store-7g@0.1.589-r2 | store-7g-wt3@0.1.587-r1 | store-7g-wt3@0.1.587-r2 | store-7g-wt3@0.1.589-r1 | store-7g-wt3@0.1.589-r2 | store-7g-wt3-nolists@0.1.587-r1 | store-7g-wt3-nolists@0.1.587-r2 | store-7g-wt3-nolists@0.1.589-r1 | store-7g-wt3-nolists@0.1.589-r2 | store-7g-lists1d@0.1.587-r1 | store-7g-lists1d@0.1.587-r2 | store-7g-lists1d@0.1.589-r1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 94 ms ⚠️ | 285 ms ❌ | 862 ms ❌ | 531 ms ❌ | 136 ms ⚠️ | 169 ms ⚠️ | 777 ms ❌ | 751 ms ❌ | 164 ms ⚠️ | 212 ms ❌ | 124 ms ⚠️ | 98 ms ⚠️ | 137 ms ⚠️ | 109 ms ⚠️ | 171 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 153 ms ⚠️ | 275 ms ❌ | 1063 ms ❌ | 656 ms ❌ | 189 ms ⚠️ | 240 ms ❌ | 771 ms ❌ | 1130 ms ❌ | 237 ms ❌ | 317 ms ❌ | 225 ms ❌ | 146 ms ⚠️ | 175 ms ⚠️ | 182 ms ⚠️ | 199 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 113 ms ✅ | 1086 ms ⚠️ | 202 ms ✅ | 168 ms ✅ | 1113 ms ⚠️ | 1102 ms ⚠️ | 133 ms ✅ | 601 ms ✅ | 125 ms ✅ | 133 ms ✅ | 133 ms ✅ | 158 ms ✅ | 153 ms ✅ | 132 ms ✅ | 156 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 144 ms ✅ | 160 ms ✅ | 732 ms ✅ | 243 ms ✅ | 101 ms ✅ | 308 ms ✅ | 496 ms ✅ | 990 ms ✅ | 187 ms ✅ | 208 ms ✅ | 120 ms ✅ | 198 ms ✅ | 97 ms ✅ | 128 ms ✅ | 106 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 193 ms ✅ | 381 ms ⚠️ | 249 ms ✅ | 233 ms ✅ | 223 ms ✅ | 258 ms ✅ | 208 ms ✅ | 322 ms ⚠️ | 299 ms ✅ | 408 ms ⚠️ | 239 ms ✅ | 189 ms ✅ | 175 ms ✅ | 184 ms ✅ | 319 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 163 ms ✅ | 313 ms ⚠️ | 347 ms ⚠️ | 228 ms ✅ | 277 ms ✅ | 299 ms ✅ | 249 ms ✅ | 308 ms ⚠️ | 251 ms ✅ | 381 ms ⚠️ | 233 ms ✅ | 195 ms ✅ | 210 ms ✅ | 187 ms ✅ | 205 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 656 ms ✅ | 775 ms ✅ | 509 ms ✅ | 549 ms ✅ | 543 ms ✅ | 549 ms ✅ | 574 ms ✅ | 650 ms ✅ | 486 ms ✅ | 464 ms ✅ | 400 ms ✅ | 411 ms ✅ | 579 ms ✅ | 577 ms ✅ | 456 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a | 311 ms ✅ | 299 ms ✅ | 390 ms ✅ | 543 ms ✅ | 448 ms ✅ | 317 ms ✅ | 376 ms ✅ | 329 ms ✅ | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.33 x ⚠️ | 1.14 x ✅ | 1.17 x ✅ | 1.19 x ✅ | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 1.43 x ⚠️ | 1.26 x ✅ | 1.28 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 42 s | 53 s | 38 s | 44 s | 42 s | 38 s | 59 s | 38 s | 44 s | 38 s | 46 s | 44 s | 47 s | 40 s | 48 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1217 ms ✅ | 1335 ms ✅ | 2096 ms ✅ | 1614 ms ✅ | 1228 ms ✅ | 1285 ms ✅ | 1747 ms ✅ | 2830 ms ✅ | 1251 ms ✅ | 1271 ms ✅ | 1192 ms ✅ | 1184 ms ✅ | 1191 ms ✅ | 1197 ms ✅ | 1226 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ | late ❌ | 1558 ms ✅ | 1762 ms ✅ | 1968 ms ✅ | 1848 ms ✅ | 1699 ms ✅ | 1717 ms ✅ | 1582 ms ✅ | 1561 ms ✅ | late ❌ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 50 % ❌ | 50 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 50 % ❌ | 50 % ❌ | 50 % ❌ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 163 s ✅ | 208 s ⚠️ | 207 s ⚠️ | 205 s ⚠️ | 177 s ✅ | 183 s ⚠️ | 185 s ⚠️ | 178 s ✅ | 173 s ✅ | 200 s ⚠️ | 169 s ✅ | 169 s ✅ | 160 s ✅ | 161 s ✅ | 161 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.7 % core ⚠️ | 3.5 % core ⚠️ | 2.2 % core ⚠️ | 1.9 % core ⚠️ | 5.8 % core ❌ | 5.2 % core ❌ | 3.2 % core ⚠️ | 4.5 % core ⚠️ | 4.5 % core ⚠️ | 3.2 % core ⚠️ | 4.0 % core ⚠️ | 3.7 % core ⚠️ | 2.2 % core ⚠️ | 2.0 % core ⚠️ | 2.3 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 513 MiB ⚠️ | 515 MiB ⚠️ | 523 MiB ⚠️ | 464 MiB ⚠️ | 505 MiB ⚠️ | 498 MiB ⚠️ | 505 MiB ⚠️ | 525 MiB ⚠️ | 517 MiB ⚠️ | 477 MiB ⚠️ | 600 MiB ❌ | 507 MiB ⚠️ | 557 MiB ⚠️ | 501 MiB ⚠️ | 503 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.1 s | 1.9 s | 22 s | 21 s | 0.4 s | 0.5 s | 6.4 s | 6.9 s | 0.5 s | 0.6 s | 0.4 s | 0.4 s | 1.2 s | 1.3 s | 2.5 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.1 s | 2.0 s | 1.8 s | 1.6 s | 3.2 s | 4.0 s | 3.6 s | 4.1 s | 4.1 s | 4.8 s | 3.0 s | 2.9 s | 1.2 s | 1.3 s | 1.4 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 149 MiB | 141 MiB | 141 MiB | 157 MiB | 190 MiB | 177 MiB | 145 MiB | 185 MiB | 193 MiB | 212 MiB | 179 MiB | 202 MiB | 164 MiB | 145 MiB | 147 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 5 ❌ | 5 ❌ | 512 ❌ | 568 ❌ | 18 ❌ | 19 ❌ | 615 ❌ | 571 ❌ | 15 ❌ | 21 ❌ | 10 ❌ | 10 ❌ | 3 ⚠️ | 5 ❌ | 2 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 10480 MiB | 10455 MiB | 9177 MiB | 9068 MiB | 10500 MiB | 10501 MiB | 9008 MiB | 9167 MiB | 2096 MiB | 2072 MiB | 2115 MiB | 2079 MiB | 3195 MiB | 3240 MiB | 2010 MiB |
| Result rows in the store (`store.results`) | report |  | 1148392 | 1148000 | 1147776 | 1148280 | 1156330 | 1156106 | 1156414 | 1156106 | 1156470 | 1156554 | 1156498 | 1156722 | 1148280 | 1148336 | 1148504 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 1 ms | 2 ms | 0 ms | 1 ms | 259 ms | 169 ms | 71 ms | 69 ms | 416 ms | 175 ms | 102 ms | 64 ms | 1 ms | 0 ms | 1 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 5.5 s | 7.3 s | 3.5 s | 4.1 s | 12 s | 14 s | 11 s | 11 s | 13 s | 13 s | 9.1 s | 7.7 s | 4.2 s | 3.6 s | 3.7 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 2 | 59 | 53 | 3 | 2 | 2 | 88 | 3 | 2 | 2 | 3 | 2 | 2 | 2 | 2 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 65 s | 84 s | 0.3 s | 0.5 s | 41 s | 50 s | 0.2 s | 0.4 s | 0.4 s | 0.4 s | 0.2 s | 0.2 s | 9.2 s | 10 s | 0.2 s |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 2235 MiB | 2253 MiB | 126 MiB | 109 MiB | 2181 MiB | 2136 MiB | 85 MiB | 115 MiB | 134 MiB | 147 MiB | 83 MiB | 87 MiB | 2198 MiB | 2191 MiB | 88 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 878 ms | 2928 ms | 2282 ms | 2394 ms | 2150 ms | 2983 ms | 3070 ms | 2408 ms | 975 ms | 937 ms | 1417 ms | 622 ms | 437 ms | 1102 ms | 434 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 3.0 s | 7.3 s | 387 s | 385 s | 14 s | 16 s | 371 s | 372 s | 7.3 s | 11 s | 5.6 s | 4.4 s | 1.1 s | 2.7 s | 0.8 s |
