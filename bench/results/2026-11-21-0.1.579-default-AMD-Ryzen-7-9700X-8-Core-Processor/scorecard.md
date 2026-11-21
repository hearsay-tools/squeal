# Squeal performance scorecard

Squeal 0.1.579 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2501 MiB/s · 2026-11-20T22:48:09.958Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 59 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 58 | 91 | 45 | 48 | 52 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| store-7g-r1 | 500 | 1 | 0% | 326 | ✅ | 58 | 63 | 88 | 40 | 50 | 50 |
| store-7g-r2 | 500 | 1 | 0% | 326 | ✅ | 59 | 63 | 100 | 30 | 50 | 50 |
| store-7g-r3 | 500 | 1 | 0% | 326 | ✅ | 54 | 38 | 100 | 30 | 50 | 50 |
| store-7g-wt3-r1 | 500 | 3 | 0% | 326 | ✅ | 60 | 50 | 100 | 50 | 50 | 50 |
| store-7g-wt3-r2 | 500 | 3 | 0% | 326 | ✅ | 50 | 50 | 75 | 50 | 25 | 50 |
| store-7g-wt3-r3 | 500 | 3 | 0% | 326 | ✅ | 57 | 50 | 75 | 60 | 50 | 50 |
| store-7g-wt3-nolists-r1 | 500 | 3 | 0% | 326 | ✅ | 65 | 63 | 100 | 60 | 50 | 50 |
| store-7g-wt3-nolists-r2 | 500 | 3 | 0% | 326 | ✅ | 58 | 63 | 75 | 50 | 50 | 50 |
| store-7g-wt3-nolists-r3 | 500 | 3 | 0% | 326 | ✅ | 65 | 63 | 100 | 60 | 50 | 50 |
| store-7g-lists1d-r1 | 500 | 1 | 0% | 326 | ✅ | 59 | 75 | 88 | 30 | 50 | 50 |
| store-7g-lists1d-r2 | 500 | 1 | 0% | 326 | ✅ | 58 | 63 | 88 | 40 | 50 | 50 |
| store-7g-lists1d-r3 | 500 | 1 | 0% | 326 | ✅ | 66 | 63 | 100 | 40 | 50 | 75 |

## Repeats

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| store-7g | 0.1.579 | 3 | ✅ | 57 (54–59) |  |  |  |  |  |  |
| store-7g-wt3 | 0.1.579 | 3 | ✅ | 56 (50–60) |  |  |  |  |  |  |
| store-7g-wt3-nolists | 0.1.579 | 3 | ✅ | 62 (58–65) |  |  |  |  |  |  |
| store-7g-lists1d | 0.1.579 | 3 | ✅ | 61 (58–66) |  |  |  |  |  |  |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.579 |
|---|---|---:|
| store-7g | Hook before each tool call (slowest 5%) | 172 ms |
| store-7g | Hook after each batch of tool calls (slowest 5%) | 250 ms |
| store-7g | Hook at session start (slowest) | 476 ms |
| store-7g | `squeal status` (slowest 5%) | 224 ms |
| store-7g | Edit that breaks a test until the agent is told (median) | 1256 ms |
| store-7g | Edits with a verdict within the 60 s agents wait | 50 % |
| store-7g | CPU with no edits: the busiest daemon, plus the store process | 2.2 % core |
| store-7g | CPU per edit: daemons with their test runs, plus the store process | 1.4 s |
| store-7g | Daemon memory, peak | 494 MiB |
| store-7g | Store process memory, peak | 143 MiB |
| store-7g | Store writes that held the lock over 250 ms | 7.7 |
| store-7g | Longest logged lock hold (only holds over 250 ms are logged) | 2147 ms |
| store-7g | Logged lock holds, total | 6.2 s |
| store-7g | `squeal reach` (reads every stored module list) | 55 s |
| store-7g | `squeal reach` memory, peak | 2200 MiB |
| store-7g-wt3 | Hook before each tool call (slowest 5%) | 176 ms |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 5%) | 436 ms |
| store-7g-wt3 | Hook at session start (slowest) | 1106 ms |
| store-7g-wt3 | `squeal status` (slowest 5%) | 359 ms |
| store-7g-wt3 | Edit that breaks a test until the agent is told (median) | 1447 ms |
| store-7g-wt3 | Edits with a verdict within the 60 s agents wait | 69 % |
| store-7g-wt3 | CPU with no edits: the busiest daemon, plus the store process | 3.9 % core |
| store-7g-wt3 | CPU per edit: daemons with their test runs, plus the store process | 0.5 s |
| store-7g-wt3 | Daemon memory, peak | 484 MiB |
| store-7g-wt3 | Store process memory, peak | 192 MiB |
| store-7g-wt3 | Store writes that held the lock over 250 ms | 18 |
| store-7g-wt3 | Longest logged lock hold (only holds over 250 ms are logged) | 1717 ms |
| store-7g-wt3 | Logged lock holds, total | 13 s |
| store-7g-wt3 | `squeal reach` (reads every stored module list) | 50 s |
| store-7g-wt3 | `squeal reach` memory, peak | 2195 MiB |
| store-7g-wt3-nolists | Hook before each tool call (slowest 5%) | 142 ms |
| store-7g-wt3-nolists | Hook after each batch of tool calls (slowest 5%) | 250 ms |
| store-7g-wt3-nolists | Hook at session start (slowest) | 116 ms |
| store-7g-wt3-nolists | `squeal status` (slowest 5%) | 284 ms |
| store-7g-wt3-nolists | Edit that breaks a test until the agent is told (median) | 1257 ms |
| store-7g-wt3-nolists | Edits with a verdict within the 60 s agents wait | 69 % |
| store-7g-wt3-nolists | CPU with no edits: the busiest daemon, plus the store process | 3.8 % core |
| store-7g-wt3-nolists | CPU per edit: daemons with their test runs, plus the store process | 0.4 s |
| store-7g-wt3-nolists | Daemon memory, peak | 492 MiB |
| store-7g-wt3-nolists | Store process memory, peak | 186 MiB |
| store-7g-wt3-nolists | Store writes that held the lock over 250 ms | 7.3 |
| store-7g-wt3-nolists | Longest logged lock hold (only holds over 250 ms are logged) | 459 ms |
| store-7g-wt3-nolists | Logged lock holds, total | 2.5 s |
| store-7g-wt3-nolists | `squeal reach` (reads every stored module list) | 0.2 s |
| store-7g-wt3-nolists | `squeal reach` memory, peak | 138 MiB |
| store-7g-lists1d | Hook before each tool call (slowest 5%) | 144 ms |
| store-7g-lists1d | Hook after each batch of tool calls (slowest 5%) | 264 ms |
| store-7g-lists1d | Hook at session start (slowest) | 150 ms |
| store-7g-lists1d | `squeal status` (slowest 5%) | 271 ms |
| store-7g-lists1d | Edit that breaks a test until the agent is told (median) | 1331 ms |
| store-7g-lists1d | Edits with a verdict within the 60 s agents wait | 50 % |
| store-7g-lists1d | CPU with no edits: the busiest daemon, plus the store process | 2.4 % core |
| store-7g-lists1d | CPU per edit: daemons with their test runs, plus the store process | 1.5 s |
| store-7g-lists1d | Daemon memory, peak | 491 MiB |
| store-7g-lists1d | Store process memory, peak | 154 MiB |
| store-7g-lists1d | Store writes that held the lock over 250 ms | 4.7 |
| store-7g-lists1d | Longest logged lock hold (only holds over 250 ms are logged) | 655 ms |
| store-7g-lists1d | Logged lock holds, total | 2.3 s |
| store-7g-lists1d | `squeal reach` (reads every stored module list) | 12 s |
| store-7g-lists1d | `squeal reach` memory, peak | 2184 MiB |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 12 of 12 cells: store-7g-r1 120 ms ⚠️, store-7g-r2 126 ms ⚠️, store-7g-r3 269 ms ❌, store-7g-wt3-r1 164 ms ⚠️, store-7g-wt3-r2 184 ms ⚠️, store-7g-wt3-r3 181 ms ⚠️, store-7g-wt3-nolists-r1 115 ms ⚠️, store-7g-wt3-nolists-r2 156 ms ⚠️, store-7g-wt3-nolists-r3 156 ms ⚠️, store-7g-lists1d-r1 135 ms ⚠️, store-7g-lists1d-r2 145 ms ⚠️, store-7g-lists1d-r3 153 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 12 of 12 cells: store-7g-r1 212 ms ❌, store-7g-r2 211 ms ❌, store-7g-r3 326 ms ❌, store-7g-wt3-r1 674 ms ❌, store-7g-wt3-r2 334 ms ❌, store-7g-wt3-r3 300 ms ❌, store-7g-wt3-nolists-r1 261 ms ❌, store-7g-wt3-nolists-r2 207 ms ❌, store-7g-wt3-nolists-r3 283 ms ❌, store-7g-lists1d-r1 177 ms ⚠️, store-7g-lists1d-r2 271 ms ❌, store-7g-lists1d-r3 345 ms ❌
- **Hooks · Hook at session start (slowest)** (healthy ≤ 750 ms): 4 of 12 cells: store-7g-r3 1070 ms ⚠️, store-7g-wt3-r1 1143 ms ⚠️, store-7g-wt3-r2 1095 ms ⚠️, store-7g-wt3-r3 1082 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 4 of 12 cells: store-7g-wt3-r2 430 ms ⚠️, store-7g-wt3-r3 380 ms ⚠️, store-7g-wt3-nolists-r2 347 ms ⚠️, store-7g-lists1d-r1 321 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 3 of 12 cells: store-7g-wt3-r2 334 ms ⚠️, store-7g-wt3-r3 305 ms ⚠️, store-7g-wt3-nolists-r2 323 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 2 of 12 cells: store-7g-r1 1.33 x ⚠️, store-7g-lists1d-r2 1.30 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 6 of 12 cells: store-7g-r1 late ❌, store-7g-r2 late ❌, store-7g-r3 late ❌, store-7g-lists1d-r1 late ❌, store-7g-lists1d-r2 late ❌, store-7g-lists1d-r3 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 12 of 12 cells: store-7g-r1 late ❌, store-7g-r2 late ❌, store-7g-r3 late ❌, store-7g-wt3-r1 late ❌, store-7g-wt3-r2 late ❌, store-7g-wt3-r3 late ❌, store-7g-wt3-nolists-r1 late ❌, store-7g-wt3-nolists-r2 late ❌, store-7g-wt3-nolists-r3 late ❌, store-7g-lists1d-r1 late ❌, store-7g-lists1d-r2 late ❌, store-7g-lists1d-r3 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 12 of 12 cells: store-7g-r1 50 % ❌, store-7g-r2 50 % ❌, store-7g-r3 50 % ❌, store-7g-wt3-r1 69 % ❌, store-7g-wt3-r2 69 % ❌, store-7g-wt3-r3 70 % ❌, store-7g-wt3-nolists-r1 69 % ❌, store-7g-wt3-nolists-r2 69 % ❌, store-7g-wt3-nolists-r3 69 % ❌, store-7g-lists1d-r1 50 % ❌, store-7g-lists1d-r2 50 % ❌, store-7g-lists1d-r3 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 12 cells: store-7g-r2 208 s ⚠️, store-7g-r3 190 s ⚠️, store-7g-wt3-r1 212 s ⚠️, store-7g-wt3-r2 195 s ⚠️, store-7g-wt3-nolists-r2 184 s ⚠️, store-7g-lists1d-r1 192 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 12 of 12 cells: store-7g-r1 2.5 % core ⚠️, store-7g-r2 2.5 % core ⚠️, store-7g-r3 1.7 % core ⚠️, store-7g-wt3-r1 3.3 % core ⚠️, store-7g-wt3-r2 5.1 % core ❌, store-7g-wt3-r3 3.2 % core ⚠️, store-7g-wt3-nolists-r1 3.4 % core ⚠️, store-7g-wt3-nolists-r2 3.5 % core ⚠️, store-7g-wt3-nolists-r3 4.3 % core ⚠️, store-7g-lists1d-r1 2.1 % core ⚠️, store-7g-lists1d-r2 2.3 % core ⚠️, store-7g-lists1d-r3 2.7 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 12 of 12 cells: store-7g-r1 463 MiB ⚠️, store-7g-r2 508 MiB ⚠️, store-7g-r3 512 MiB ⚠️, store-7g-wt3-r1 492 MiB ⚠️, store-7g-wt3-r2 515 MiB ⚠️, store-7g-wt3-r3 444 MiB ⚠️, store-7g-wt3-nolists-r1 490 MiB ⚠️, store-7g-wt3-nolists-r2 494 MiB ⚠️, store-7g-wt3-nolists-r3 493 MiB ⚠️, store-7g-lists1d-r1 503 MiB ⚠️, store-7g-lists1d-r2 508 MiB ⚠️, store-7g-lists1d-r3 462 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 12 of 12 cells: store-7g-r1 4 ❌, store-7g-r2 13 ❌, store-7g-r3 6 ❌, store-7g-wt3-r1 23 ❌, store-7g-wt3-r2 17 ❌, store-7g-wt3-r3 14 ❌, store-7g-wt3-nolists-r1 5 ❌, store-7g-wt3-nolists-r2 9 ❌, store-7g-wt3-nolists-r3 8 ❌, store-7g-lists1d-r1 7 ❌, store-7g-lists1d-r2 4 ❌, store-7g-lists1d-r3 3 ⚠️

## Every metric

| Metric | Healthy | Warn | store-7g-r1 | store-7g-r2 | store-7g-r3 | store-7g-wt3-r1 | store-7g-wt3-r2 | store-7g-wt3-r3 | store-7g-wt3-nolists-r1 | store-7g-wt3-nolists-r2 | store-7g-wt3-nolists-r3 | store-7g-lists1d-r1 | store-7g-lists1d-r2 | store-7g-lists1d-r3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 120 ms ⚠️ | 126 ms ⚠️ | 269 ms ❌ | 164 ms ⚠️ | 184 ms ⚠️ | 181 ms ⚠️ | 115 ms ⚠️ | 156 ms ⚠️ | 156 ms ⚠️ | 135 ms ⚠️ | 145 ms ⚠️ | 153 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 212 ms ❌ | 211 ms ❌ | 326 ms ❌ | 674 ms ❌ | 334 ms ❌ | 300 ms ❌ | 261 ms ❌ | 207 ms ❌ | 283 ms ❌ | 177 ms ⚠️ | 271 ms ❌ | 345 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 140 ms ✅ | 218 ms ✅ | 1070 ms ⚠️ | 1143 ms ⚠️ | 1095 ms ⚠️ | 1082 ms ⚠️ | 97 ms ✅ | 142 ms ✅ | 110 ms ✅ | 204 ms ✅ | 137 ms ✅ | 110 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 159 ms ✅ | 544 ms ✅ | 115 ms ✅ | 218 ms ✅ | 190 ms ✅ | 237 ms ✅ | 109 ms ✅ | 191 ms ✅ | 125 ms ✅ | 136 ms ✅ | 133 ms ✅ | 118 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 207 ms ✅ | 258 ms ✅ | 206 ms ✅ | 266 ms ✅ | 430 ms ⚠️ | 380 ms ⚠️ | 222 ms ✅ | 347 ms ⚠️ | 284 ms ✅ | 321 ms ⚠️ | 265 ms ✅ | 228 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 192 ms ✅ | 205 ms ✅ | 246 ms ✅ | 294 ms ✅ | 334 ms ⚠️ | 305 ms ⚠️ | 273 ms ✅ | 323 ms ⚠️ | 266 ms ✅ | 291 ms ✅ | 242 ms ✅ | 194 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 1234 ms ✅ | 842 ms ✅ | 459 ms ✅ | 445 ms ✅ | 754 ms ✅ | 417 ms ✅ | 435 ms ✅ | 374 ms ✅ | 500 ms ✅ | 450 ms ✅ | 469 ms ✅ | 555 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | 374 ms ✅ | 688 ms ✅ | 434 ms ✅ | 394 ms ✅ | 328 ms ✅ | 407 ms ✅ | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.33 x ⚠️ | 1.08 x ✅ | 1.28 x ✅ | n/a | n/a | n/a | n/a | n/a | n/a | 1.28 x ✅ | 1.30 x ⚠️ | 1.25 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 40 s | 42 s | 38 s | 40 s | 42 s | 41 s | 37 s | 38 s | 46 s | 40 s | 47 s | 48 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1294 ms ✅ | 1217 ms ✅ | 1257 ms ✅ | 1548 ms ✅ | 1415 ms ✅ | 1377 ms ✅ | 1232 ms ✅ | 1219 ms ✅ | 1321 ms ✅ | 1218 ms ✅ | 1354 ms ✅ | 1420 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ | 1674 ms ✅ | 1723 ms ✅ | 1753 ms ✅ | 1589 ms ✅ | 1686 ms ✅ | 1637 ms ✅ | late ❌ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 50 % ❌ | 69 % ❌ | 69 % ❌ | 70 % ❌ | 69 % ❌ | 69 % ❌ | 69 % ❌ | 50 % ❌ | 50 % ❌ | 50 % ❌ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 170 s ✅ | 208 s ⚠️ | 190 s ⚠️ | 212 s ⚠️ | 195 s ⚠️ | 175 s ✅ | 175 s ✅ | 184 s ⚠️ | 175 s ✅ | 192 s ⚠️ | 169 s ✅ | 163 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 2.5 % core ⚠️ | 2.5 % core ⚠️ | 1.7 % core ⚠️ | 3.3 % core ⚠️ | 5.1 % core ❌ | 3.2 % core ⚠️ | 3.4 % core ⚠️ | 3.5 % core ⚠️ | 4.3 % core ⚠️ | 2.1 % core ⚠️ | 2.3 % core ⚠️ | 2.7 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 463 MiB ⚠️ | 508 MiB ⚠️ | 512 MiB ⚠️ | 492 MiB ⚠️ | 515 MiB ⚠️ | 444 MiB ⚠️ | 490 MiB ⚠️ | 494 MiB ⚠️ | 493 MiB ⚠️ | 503 MiB ⚠️ | 508 MiB ⚠️ | 462 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.4 s | 1.5 s | 1.4 s | 0.5 s | 0.5 s | 0.5 s | 0.4 s | 0.5 s | 0.5 s | 1.3 s | 1.7 s | 1.4 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.5 s | 1.5 s | 1.3 s | 3.9 s | 3.7 s | 3.7 s | 2.6 s | 3.7 s | 3.4 s | 1.4 s | 1.7 s | 1.5 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 144 MiB | 142 MiB | 143 MiB | 191 MiB | 199 MiB | 187 MiB | 198 MiB | 181 MiB | 177 MiB | 143 MiB | 165 MiB | 154 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 4 ❌ | 13 ❌ | 6 ❌ | 23 ❌ | 17 ❌ | 14 ❌ | 5 ❌ | 9 ❌ | 8 ❌ | 7 ❌ | 4 ❌ | 3 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 10395 MiB | 10388 MiB | 10496 MiB | 10496 MiB | 10453 MiB | 10538 MiB | 2040 MiB | 2099 MiB | 2147 MiB | 3196 MiB | 3159 MiB | 3074 MiB |
| Result rows in the store (`store.results`) | report |  | 1147860 | 1148168 | 1148224 | 1156218 | 1156267 | 1156162 | 1156498 | 1156477 | 1156442 | 1147944 | 1148336 | 1148392 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 3 ms | 1 ms | 0 ms | 69 ms | 112 ms | 96 ms | 50 ms | 84 ms | 83 ms | 1 ms | 3 ms | 2 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 5.3 s | 9.1 s | 5.3 s | 15 s | 11 s | 11 s | 7.0 s | 8.3 s | 8.4 s | 5.2 s | 3.7 s | 4.0 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 71 | 165 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 45 s | 64 s | 56 s | 54 s | 54 s | 44 s | 0.2 s | 0.3 s | 0.2 s | 15 s | 11 s | 9.5 s |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 2219 MiB | 2211 MiB | 2169 MiB | 2143 MiB | 2252 MiB | 2190 MiB | 149 MiB | 122 MiB | 143 MiB | 2196 MiB | 2184 MiB | 2172 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 1285 ms | 4187 ms | 970 ms | 1776 ms | 1739 ms | 1635 ms | 425 ms | 524 ms | 428 ms | 716 ms | 701 ms | 549 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 3.2 s | 12 s | 3.8 s | 18 s | 12 s | 9.6 s | 1.6 s | 3.3 s | 2.7 s | 3.5 s | 2.1 s | 1.3 s |
