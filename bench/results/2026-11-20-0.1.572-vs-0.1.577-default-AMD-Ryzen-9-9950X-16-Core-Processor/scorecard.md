# Squeal performance scorecard

Squeal 0.1.572 vs 0.1.577 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2365 MiB/s · 2026-11-20T13:48:49.938Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 52 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 55 | 73 | 37 | 38 | 59 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.572 | 500 | 1 | 0% | 0 | ✅ | 66 | 63 | 75 | 40 | 50 | 100 |
| ref@0.1.577 | 500 | 1 | 0% | 0 | ✅ | 66 | 75 | 88 | 40 | 50 | 75 |
| wt-3@0.1.572 | 500 | 3 | 0% | 0 | ✅ | 53 | 63 | 75 | 50 | 25 | 50 |
| wt-3@0.1.577 | 500 | 3 | 0% | 0 | ✅ | 60 | 75 | 100 | 50 | 25 | 50 |
| wt-6@0.1.572 | 500 | 6 | 0% | 0 | ✅ | 50 | 50 | 75 | 50 | 25 | 50 |
| wt-6@0.1.577 | 500 | 6 | 0% | 0 | ✅ | 48 | 50 | 75 | 40 | 25 | 50 |
| stress@0.1.572 | 500 | 6 | 100% | 0 | ✅ | 44 | 50 | 50 | 20 | 50 | 50 |
| stress@0.1.577 | 500 | 6 | 100% | 0 | ✅ | 44 | 50 | 75 | 20 | 25 | 50 |
| store-7g@0.1.572 | 500 | 1 | 0% | 326 | ✅ | 43 | 50 | 63 | 30 | 25 | 50 |
| store-7g@0.1.577 | 500 | 1 | 0% | 326 | ✅ | 46 | 38 | 63 | 30 | 50 | 50 |
| churn@0.1.572 | 500 | 1 | 0% | 326 churn | ✅ | 52 | 50 | 63 | 30 | 50 | 67 |
| churn@0.1.577 | 500 | 1 | 0% | 326 churn | ✅ | 56 | 50 | 75 | 40 | 50 | 67 |

## 0.1.572 compared with 0.1.577 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.572 | 1 | ✅ | 66 |  |  |  |  |  |  |
| ref | 0.1.577 | 1 | ✅ | 66 | +0 | +13 | +13 | +0 | +0 | -25 |
| wt-3 | 0.1.572 | 1 | ✅ | 53 |  |  |  |  |  |  |
| wt-3 | 0.1.577 | 1 | ✅ | 60 | +8 | +13 | +25 | +0 | +0 | +0 |
| wt-6 | 0.1.572 | 1 | ✅ | 50 |  |  |  |  |  |  |
| wt-6 | 0.1.577 | 1 | ✅ | 48 | -2 | +0 | +0 | -10 | +0 | +0 |
| stress | 0.1.572 | 1 | ✅ | 44 |  |  |  |  |  |  |
| stress | 0.1.577 | 1 | ✅ | 44 | +0 | +0 | +25 | +0 | -25 | +0 |
| store-7g | 0.1.572 | 1 | ✅ | 43 |  |  |  |  |  |  |
| store-7g | 0.1.577 | 1 | ✅ | 46 | +3 | -13 | +0 | +0 | +25 | +0 |
| churn | 0.1.572 | 1 | ✅ | 52 |  |  |  |  |  |  |
| churn | 0.1.577 | 1 | ✅ | 56 | +4 | +0 | +13 | +10 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.572 | 0.1.577 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 148 ms | 102 ms | -31% |
| ref | Hook after each batch of tool calls (slowest 5%) | 229 ms | 126 ms | -45% |
| ref | Hook at session start (slowest) | 171 ms | 97 ms | -44% |
| ref | `squeal status` (slowest 5%) | 317 ms | 178 ms | -44% |
| ref | Edit that breaks a test until the agent is told (median) | 1226 ms | 1188 ms | -3% |
| ref | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 1.5 % core | 1.8 % core | +19% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.2 s | 1.2 s | +1% |
| ref | Daemon memory, peak | 434 MiB | 497 MiB | +14% |
| ref | Store process memory, peak | n/a | 152 MiB |  |
| ref | Store writes that held the lock over 250 ms | 0 | 1 |  |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | n/a | 308 ms |  |
| ref | Logged lock holds, total | 0 s | 0.3 s |  |
| wt-3 | Hook before each tool call (slowest 5%) | 190 ms | 169 ms | -11% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 268 ms | 176 ms | -34% |
| wt-3 | Hook at session start (slowest) | 123 ms | 250 ms | +103% |
| wt-3 | `squeal status` (slowest 5%) | 381 ms | 264 ms | -31% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1403 ms | 1191 ms | -15% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 5.2 % core | 5.6 % core | +9% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.7 s | 0.6 s | -14% |
| wt-3 | Daemon memory, peak | 396 MiB | 459 MiB | +16% |
| wt-3 | Store process memory, peak | n/a | 193 MiB |  |
| wt-3 | Store writes that held the lock over 250 ms | 11 | 5 | -55% |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 516 ms | 447 ms | -13% |
| wt-3 | Logged lock holds, total | 3.9 s | 1.7 s | -56% |
| wt-6 | Hook before each tool call (slowest 5%) | 240 ms | 237 ms | -1% |
| wt-6 | Hook after each batch of tool calls (slowest 5%) | 360 ms | 377 ms | +5% |
| wt-6 | Hook at session start (slowest) | 261 ms | 300 ms | +15% |
| wt-6 | `squeal status` (slowest 5%) | 415 ms | 480 ms | +16% |
| wt-6 | Edit that breaks a test until the agent is told (median) | 1469 ms | 1420 ms | -3% |
| wt-6 | Edits with a verdict within the 60 s agents wait | 72 % | 71 % | -1% |
| wt-6 | CPU with no edits: the busiest daemon, plus the store process | 5.9 % core | 8.2 % core | +39% |
| wt-6 | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.7 s | +135% |
| wt-6 | Daemon memory, peak | 395 MiB | 460 MiB | +17% |
| wt-6 | Store process memory, peak | n/a | 233 MiB |  |
| wt-6 | Store writes that held the lock over 250 ms | 20 | 17 | -15% |
| wt-6 | Longest logged lock hold (only holds over 250 ms are logged) | 866 ms | 791 ms | -9% |
| wt-6 | Logged lock holds, total | 8.9 s | 7.5 s | -15% |
| stress | Hook before each tool call (slowest 5%) | 675 ms | 330 ms | -51% |
| stress | Hook after each batch of tool calls (slowest 5%) | 980 ms | 444 ms | -55% |
| stress | Hook at session start (slowest) | 258 ms | 216 ms | -16% |
| stress | `squeal status` (slowest 5%) | 1449 ms | 646 ms | -55% |
| stress | Edit that breaks a test until the agent is told (median) | 7037 ms | 3723 ms | -47% |
| stress | Edits with a verdict within the 60 s agents wait | 71 % | 71 % | +0% |
| stress | CPU with no edits: the busiest daemon, plus the store process | 3.4 % core | 5.8 % core | +71% |
| stress | CPU per edit: daemons with their test runs, plus the store process | 2.2 s | 1.9 s | -14% |
| stress | Daemon memory, peak | 407 MiB | 496 MiB | +22% |
| stress | Store process memory, peak | n/a | 196 MiB |  |
| stress | Store writes that held the lock over 250 ms | 39 | 20 | -49% |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | 1177 ms | 1274 ms | +8% |
| stress | Logged lock holds, total | 18 s | 11 s | -36% |
| store-7g | Hook before each tool call (slowest 5%) | 1395 ms | 441 ms | -68% |
| store-7g | Hook after each batch of tool calls (slowest 5%) | 624 ms | 577 ms | -8% |
| store-7g | Hook at session start (slowest) | 386 ms | 1072 ms | +178% |
| store-7g | `squeal status` (slowest 5%) | 497 ms | 384 ms | -23% |
| store-7g | Edit that breaks a test until the agent is told (median) | 1384 ms | 1933 ms | +40% |
| store-7g | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| store-7g | CPU with no edits: the busiest daemon, plus the store process | 5.4 % core | 2.1 % core | -61% |
| store-7g | CPU per edit: daemons with their test runs, plus the store process | 2.6 s | 2.5 s | -4% |
| store-7g | Daemon memory, peak | 414 MiB | 510 MiB | +23% |
| store-7g | Store process memory, peak | n/a | 146 MiB |  |
| store-7g | Store writes that held the lock over 250 ms | 17 | 5 | -71% |
| store-7g | Longest logged lock hold (only holds over 250 ms are logged) | 2160 ms | 3158 ms | +46% |
| store-7g | Logged lock holds, total | 12 s | 7.8 s | -37% |
| churn | Hook before each tool call (slowest 5%) | 193 ms | 181 ms | -6% |
| churn | Hook after each batch of tool calls (slowest 5%) | 336 ms | 227 ms | -32% |
| churn | Hook at session start (slowest) | 1070 ms | 1010 ms | -6% |
| churn | `squeal status` (slowest 5%) | 309 ms | 580 ms | +88% |
| churn | Edit that breaks a test until the agent is told (median) | 2118 ms | 1271 ms | -40% |
| churn | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| churn | CPU with no edits: the busiest daemon, plus the store process | 3.6 % core | 2.9 % core | -20% |
| churn | CPU per edit: daemons with their test runs, plus the store process | 6.9 s | 5.2 s | -24% |
| churn | Daemon memory, peak | 416 MiB | 522 MiB | +25% |
| churn | Store process memory, peak | n/a | 149 MiB |  |
| churn | Store writes that held the lock over 250 ms | 41 | 25 | -39% |
| churn | Longest logged lock hold (only holds over 250 ms are logged) | 3899 ms | 5188 ms | +33% |
| churn | Logged lock holds, total | 23 s | 15 s | -35% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 12 of 12 cells: ref@0.1.572 148 ms ⚠️, ref@0.1.577 102 ms ⚠️, wt-3@0.1.572 190 ms ⚠️, wt-3@0.1.577 169 ms ⚠️, wt-6@0.1.572 240 ms ❌, wt-6@0.1.577 237 ms ❌, stress@0.1.572 675 ms ❌, stress@0.1.577 330 ms ❌, store-7g@0.1.572 1395 ms ❌, store-7g@0.1.577 441 ms ❌, churn@0.1.572 193 ms ⚠️, churn@0.1.577 181 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 12 of 12 cells: ref@0.1.572 229 ms ❌, ref@0.1.577 126 ms ⚠️, wt-3@0.1.572 268 ms ❌, wt-3@0.1.577 176 ms ⚠️, wt-6@0.1.572 360 ms ❌, wt-6@0.1.577 377 ms ❌, stress@0.1.572 980 ms ❌, stress@0.1.577 444 ms ❌, store-7g@0.1.572 624 ms ❌, store-7g@0.1.577 577 ms ❌, churn@0.1.572 336 ms ❌, churn@0.1.577 227 ms ❌
- **Hooks · Hook at session start (slowest)** (healthy ≤ 750 ms): 3 of 12 cells: store-7g@0.1.577 1072 ms ⚠️, churn@0.1.572 1070 ms ⚠️, churn@0.1.577 1010 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 10 of 12 cells: ref@0.1.572 317 ms ⚠️, wt-3@0.1.572 381 ms ⚠️, wt-6@0.1.572 415 ms ⚠️, wt-6@0.1.577 480 ms ⚠️, stress@0.1.572 1449 ms ❌, stress@0.1.577 646 ms ⚠️, store-7g@0.1.572 497 ms ⚠️, store-7g@0.1.577 384 ms ⚠️, churn@0.1.572 309 ms ⚠️, churn@0.1.577 580 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 8 of 12 cells: wt-3@0.1.572 379 ms ⚠️, wt-6@0.1.572 363 ms ⚠️, wt-6@0.1.577 453 ms ⚠️, stress@0.1.572 1225 ms ❌, stress@0.1.577 682 ms ⚠️, store-7g@0.1.572 615 ms ⚠️, store-7g@0.1.577 517 ms ⚠️, churn@0.1.572 362 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 6 of 12 cells: ref@0.1.572 1.47 x ⚠️, ref@0.1.577 1.38 x ⚠️, store-7g@0.1.572 1.31 x ⚠️, store-7g@0.1.577 1.38 x ⚠️, churn@0.1.572 1.42 x ⚠️, churn@0.1.577 1.79 x ⚠️
- **Verdicts · Edit that breaks a test until the agent is told (median)** (healthy ≤ 3000 ms): 2 of 12 cells: stress@0.1.572 7037 ms ⚠️, stress@0.1.577 3723 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 8 of 12 cells: ref@0.1.572 late ❌, ref@0.1.577 late ❌, stress@0.1.572 7085 ms ⚠️, stress@0.1.577 3523 ms ⚠️, store-7g@0.1.572 late ❌, store-7g@0.1.577 late ❌, churn@0.1.572 late ❌, churn@0.1.577 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 12 of 12 cells: ref@0.1.572 late ❌, ref@0.1.577 late ❌, wt-3@0.1.572 late ❌, wt-3@0.1.577 late ❌, wt-6@0.1.572 late ❌, wt-6@0.1.577 late ❌, stress@0.1.572 late ❌, stress@0.1.577 late ❌, store-7g@0.1.572 late ❌, store-7g@0.1.577 late ❌, churn@0.1.572 late ❌, churn@0.1.577 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 12 of 12 cells: ref@0.1.572 50 % ❌, ref@0.1.577 50 % ❌, wt-3@0.1.572 69 % ❌, wt-3@0.1.577 69 % ❌, wt-6@0.1.572 72 % ❌, wt-6@0.1.577 71 % ❌, stress@0.1.572 71 % ❌, stress@0.1.577 71 % ❌, store-7g@0.1.572 50 % ❌, store-7g@0.1.577 50 % ❌, churn@0.1.572 50 % ❌, churn@0.1.577 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 9 of 12 cells: wt-3@0.1.572 214 s ⚠️, wt-3@0.1.577 187 s ⚠️, wt-6@0.1.572 280 s ⚠️, wt-6@0.1.577 late ❌, stress@0.1.572 late ❌, stress@0.1.577 late ❌, store-7g@0.1.572 187 s ⚠️, store-7g@0.1.577 206 s ⚠️, churn@0.1.572 182 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 12 of 12 cells: ref@0.1.572 1.5 % core ⚠️, ref@0.1.577 1.8 % core ⚠️, wt-3@0.1.572 5.2 % core ❌, wt-3@0.1.577 5.6 % core ❌, wt-6@0.1.572 5.9 % core ❌, wt-6@0.1.577 8.2 % core ❌, stress@0.1.572 3.4 % core ⚠️, stress@0.1.577 5.8 % core ❌, store-7g@0.1.572 5.4 % core ❌, store-7g@0.1.577 2.1 % core ⚠️, churn@0.1.572 3.6 % core ⚠️, churn@0.1.577 2.9 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 12 of 12 cells: ref@0.1.572 434 MiB ⚠️, ref@0.1.577 497 MiB ⚠️, wt-3@0.1.572 396 MiB ⚠️, wt-3@0.1.577 459 MiB ⚠️, wt-6@0.1.572 395 MiB ⚠️, wt-6@0.1.577 460 MiB ⚠️, stress@0.1.572 407 MiB ⚠️, stress@0.1.577 496 MiB ⚠️, store-7g@0.1.572 414 MiB ⚠️, store-7g@0.1.577 510 MiB ⚠️, churn@0.1.572 416 MiB ⚠️, churn@0.1.577 522 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 11 of 12 cells: ref@0.1.577 1 ⚠️, wt-3@0.1.572 11 ❌, wt-3@0.1.577 5 ❌, wt-6@0.1.572 20 ❌, wt-6@0.1.577 17 ❌, stress@0.1.572 39 ❌, stress@0.1.577 20 ❌, store-7g@0.1.572 17 ❌, store-7g@0.1.577 5 ❌, churn@0.1.572 41 ❌, churn@0.1.577 25 ❌

## Every metric

| Metric | Healthy | Warn | ref@0.1.572 | ref@0.1.577 | wt-3@0.1.572 | wt-3@0.1.577 | wt-6@0.1.572 | wt-6@0.1.577 | stress@0.1.572 | stress@0.1.577 | store-7g@0.1.572 | store-7g@0.1.577 | churn@0.1.572 | churn@0.1.577 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 148 ms ⚠️ | 102 ms ⚠️ | 190 ms ⚠️ | 169 ms ⚠️ | 240 ms ❌ | 237 ms ❌ | 675 ms ❌ | 330 ms ❌ | 1395 ms ❌ | 441 ms ❌ | 193 ms ⚠️ | 181 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 229 ms ❌ | 126 ms ⚠️ | 268 ms ❌ | 176 ms ⚠️ | 360 ms ❌ | 377 ms ❌ | 980 ms ❌ | 444 ms ❌ | 624 ms ❌ | 577 ms ❌ | 336 ms ❌ | 227 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 171 ms ✅ | 97 ms ✅ | 123 ms ✅ | 250 ms ✅ | 261 ms ✅ | 300 ms ✅ | 258 ms ✅ | 216 ms ✅ | 386 ms ✅ | 1072 ms ⚠️ | 1070 ms ⚠️ | 1010 ms ⚠️ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 82 ms ✅ | 128 ms ✅ | 297 ms ✅ | 153 ms ✅ | 190 ms ✅ | 191 ms ✅ | 522 ms ✅ | 677 ms ✅ | 136 ms ✅ | 169 ms ✅ | 174 ms ✅ | 122 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 317 ms ⚠️ | 178 ms ✅ | 381 ms ⚠️ | 264 ms ✅ | 415 ms ⚠️ | 480 ms ⚠️ | 1449 ms ❌ | 646 ms ⚠️ | 497 ms ⚠️ | 384 ms ⚠️ | 309 ms ⚠️ | 580 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 295 ms ✅ | 161 ms ✅ | 379 ms ⚠️ | 284 ms ✅ | 363 ms ⚠️ | 453 ms ⚠️ | 1225 ms ❌ | 682 ms ⚠️ | 615 ms ⚠️ | 517 ms ⚠️ | 362 ms ⚠️ | 272 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 386 ms ✅ | 278 ms ✅ | 520 ms ✅ | 380 ms ✅ | 736 ms ✅ | 832 ms ✅ | 1057 ms ✅ | 831 ms ✅ | 1050 ms ✅ | 527 ms ✅ | 703 ms ✅ | 474 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 447 ms ✅ | 388 ms ✅ | 799 ms ✅ | 532 ms ✅ | 959 ms ✅ | 1042 ms ✅ | n/a | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.47 x ⚠️ | 1.38 x ⚠️ | n/a | n/a | n/a | n/a | n/a | n/a | 1.31 x ⚠️ | 1.38 x ⚠️ | 1.42 x ⚠️ | 1.79 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 56 s | 42 s | 59 s | 52 s | 75 s | 63 s | 210 s | 192 s | 42 s | 46 s | 58 s | 65 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1226 ms ✅ | 1188 ms ✅ | 1403 ms ✅ | 1191 ms ✅ | 1469 ms ✅ | 1420 ms ✅ | 7037 ms ⚠️ | 3723 ms ⚠️ | 1384 ms ✅ | 1933 ms ✅ | 2118 ms ✅ | 1271 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | 2008 ms ✅ | 1763 ms ✅ | 2105 ms ✅ | 1949 ms ✅ | 7085 ms ⚠️ | 3523 ms ⚠️ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 69 % ❌ | 69 % ❌ | 72 % ❌ | 71 % ❌ | 71 % ❌ | 71 % ❌ | 50 % ❌ | 50 % ❌ | 50 % ❌ | 50 % ❌ |
| **Correctness** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 157 s ✅ | 166 s ✅ | 214 s ⚠️ | 187 s ⚠️ | 280 s ⚠️ | late ❌ | late ❌ | late ❌ | 187 s ⚠️ | 206 s ⚠️ | 182 s ⚠️ | 164 s ✅ |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.5 % core ⚠️ | 1.8 % core ⚠️ | 5.2 % core ❌ | 5.6 % core ❌ | 5.9 % core ❌ | 8.2 % core ❌ | 3.4 % core ⚠️ | 5.8 % core ❌ | 5.4 % core ❌ | 2.1 % core ⚠️ | 3.6 % core ⚠️ | 2.9 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 434 MiB ⚠️ | 497 MiB ⚠️ | 396 MiB ⚠️ | 459 MiB ⚠️ | 395 MiB ⚠️ | 460 MiB ⚠️ | 407 MiB ⚠️ | 496 MiB ⚠️ | 414 MiB ⚠️ | 510 MiB ⚠️ | 416 MiB ⚠️ | 522 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.2 s | 1.2 s | 0.7 s | 0.6 s | 0.3 s | 0.7 s | 2.2 s | 1.9 s | 2.6 s | 2.5 s | 6.9 s | 5.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | 1.4 s | n/a | 4.2 s | n/a | 11 s | n/a | 3.7 s | n/a | 2.8 s | n/a | 1.6 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | 152 MiB | n/a | 193 MiB | n/a | 233 MiB | n/a | 196 MiB | n/a | 146 MiB | n/a | 149 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 1 ⚠️ | 11 ❌ | 5 ❌ | 20 ❌ | 17 ❌ | 39 ❌ | 20 ❌ | 17 ❌ | 5 ❌ | 41 ❌ | 25 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 20 MiB | 37 MiB | 35 MiB | 60 MiB | 60 MiB | 46 MiB | 47 MiB | 10633 MiB | 10518 MiB | 9419 MiB | 9214 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 7728 | 15890 | 15890 | 27580 | 27552 | 10500 | 9856 | 1147552 | 1147944 | 1005508 | 1003464 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 1.8 min ✅ | 1.9 min ✅ |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 45 s | 50 s |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 129 s | 104 s |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | n/a | 0 ms | n/a | 83 ms | n/a | 121 ms | n/a | 265 ms | n/a | 2 ms | n/a | 4 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | n/a | 2.7 s | n/a | 5.6 s | n/a | 15 s | n/a | 12 s | n/a | 4.2 s | n/a | 3.6 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | n/a | 1 | n/a | 1 | n/a | 1 | n/a | 1 | n/a | 2 | n/a | 3 |
| Store process: times it stopped (`store.process.stops`) | report |  | n/a | 0 | n/a | 0 | n/a | 0 | n/a | 0 | n/a | 1 | n/a | 1 |
| **Commands** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Store** | | |  |  |  |  |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | 308 ms | 516 ms | 447 ms | 866 ms | 791 ms | 1177 ms | 1274 ms | 2160 ms | 3158 ms | 3899 ms | 5188 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0.3 s | 3.9 s | 1.7 s | 8.9 s | 7.5 s | 18 s | 11 s | 12 s | 7.8 s | 23 s | 15 s |
