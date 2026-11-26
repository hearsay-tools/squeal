# Squeal performance scorecard

Squeal 0.1.636 vs 0.1.638 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2547 MiB/s · 2026-11-26T10:27:38.870Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 80 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 70 | 98 | 90 | 79 | 63 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| wt-3@0.1.636 | 500 | 3 | 0% | 0 | ✅ | 92 | 75 | 100 | 100 | 83 | 100 |
| wt-3@0.1.638 | 500 | 3 | 0% | 0 | ✅ | 94 | 88 | 100 | 100 | 83 | 100 |
| wt-6@0.1.636 | 500 | 6 | 0% | 0 | ✅ | 80 | 75 | 100 | 90 | 83 | 50 |
| wt-6@0.1.638 | 500 | 6 | 0% | 0 | ✅ | 80 | 75 | 100 | 90 | 83 | 50 |
| stress@0.1.636 | 500 | 6 | 100% | 0 | ✅ | 76 | 75 | 100 | 70 | 83 | 50 |
| stress@0.1.638 | 500 | 6 | 100% | 0 | ✅ | 73 | 63 | 100 | 70 | 83 | 50 |
| store-7g-wt3@0.1.636 | 500 | 3 | 0% | 326 | ✅ | 71 | 50 | 88 | 100 | 67 | 50 |
| store-7g-wt3@0.1.638 | 500 | 3 | 0% | 326 | ✅ | 76 | 63 | 100 | 100 | 67 | 50 |

## 0.1.636 compared with 0.1.638 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| wt-3 | 0.1.636 | 1 | ✅ | 92 |  |  |  |  |  |  |
| wt-3 | 0.1.638 | 1 | ✅ | 94 | +3 | +13 | +0 | +0 | +0 | +0 |
| wt-6 | 0.1.636 | 1 | ✅ | 80 |  |  |  |  |  |  |
| wt-6 | 0.1.638 | 1 | ✅ | 80 | +0 | +0 | +0 | +0 | +0 | +0 |
| stress | 0.1.636 | 1 | ✅ | 76 |  |  |  |  |  |  |
| stress | 0.1.638 | 1 | ✅ | 73 | -3 | -13 | +0 | +0 | +0 | +0 |
| store-7g-wt3 | 0.1.636 | 1 | ✅ | 71 |  |  |  |  |  |  |
| store-7g-wt3 | 0.1.638 | 1 | ✅ | 76 | +5 | +13 | +13 | +0 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.636 | 0.1.638 | Δ% |
|---|---|---:|---:|---:|
| wt-3 | Hook before each tool call (slowest 5%) | 97 ms | 75 ms | -23% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 123 ms | 83 ms | -32% |
| wt-3 | Hook before each tool call (slowest 1%) | 119 ms | 89 ms | -25% |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 155 ms | 140 ms | -10% |
| wt-3 | Hook write wait for the daemon main thread (longest) | 30 ms | 167 ms | +457% |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| wt-3 | Hook at session start (slowest) | 297 ms | 116 ms | -61% |
| wt-3 | `squeal status` (slowest 5%) | 140 ms | 117 ms | -17% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1166 ms | 1133 ms | -3% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 0.4 % core | 0.3 % core | -35% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.2 s | -13% |
| wt-3 | Daemon memory, peak | 433 MiB | 360 MiB | -17% |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 702 MiB | 674 MiB | -4% |
| wt-3 | Store process memory, peak | 211 MiB | 198 MiB | -6% |
| wt-3 | Store writes that held the lock over 250 ms | 0 | 0 |  |
| wt-3 | Logged lock holds, total | 0 s | 0 s |  |
| wt-3 | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | -15% |
| wt-3 | `squeal impact` memory, peak | 98 MiB | 114 MiB | +16% |
| wt-6 | Hook before each tool call (slowest 5%) | 80 ms | 101 ms | +27% |
| wt-6 | Hook after each batch of tool calls (slowest 5%) | 123 ms | 158 ms | +29% |
| wt-6 | Hook before each tool call (slowest 1%) | 119 ms | 205 ms | +73% |
| wt-6 | Hook after each batch of tool calls (slowest 1%) | 196 ms | 191 ms | -3% |
| wt-6 | Hook write wait for the daemon main thread (longest) | 273 ms | 33 ms | -88% |
| wt-6 | Hook writes that waited over 250 ms for the daemon main thread | 1 | 0 | -100% |
| wt-6 | Hook at session start (slowest) | 105 ms | 123 ms | +17% |
| wt-6 | `squeal status` (slowest 5%) | 151 ms | 223 ms | +48% |
| wt-6 | Edit that breaks a test until the agent is told (median) | 1129 ms | 1172 ms | +4% |
| wt-6 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| wt-6 | CPU with no edits: the busiest daemon, plus the store process | 0.4 % core | 0.4 % core | -0% |
| wt-6 | CPU per edit: daemons with their test runs, plus the store process | 0.2 s | 0.2 s | -37% |
| wt-6 | Daemon memory, peak | 390 MiB | 394 MiB | +1% |
| wt-6 | Daemon with its test runs, memory per worktree, peak | 655 MiB | 646 MiB | -1% |
| wt-6 | Store process memory, peak | 265 MiB | 282 MiB | +6% |
| wt-6 | Store writes that held the lock over 250 ms | 5 | 10 | +100% |
| wt-6 | Longest logged lock hold (only holds over 250 ms are logged) | 275 ms | 420 ms | +53% |
| wt-6 | Logged lock holds, total | 1.3 s | 3.0 s | +127% |
| wt-6 | `squeal impact` (reads every stored module list) | 0.2 s | 0.3 s | +49% |
| wt-6 | `squeal impact` memory, peak | 116 MiB | 128 MiB | +10% |
| stress | Hook before each tool call (slowest 5%) | 147 ms | 185 ms | +25% |
| stress | Hook after each batch of tool calls (slowest 5%) | 197 ms | 220 ms | +12% |
| stress | Hook before each tool call (slowest 1%) | 194 ms | 364 ms | +88% |
| stress | Hook after each batch of tool calls (slowest 1%) | 279 ms | 417 ms | +50% |
| stress | Hook write wait for the daemon main thread (longest) | 181 ms | 230 ms | +27% |
| stress | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| stress | Hook at session start (slowest) | 193 ms | 177 ms | -8% |
| stress | `squeal status` (slowest 5%) | 267 ms | 269 ms | +1% |
| stress | Edit that breaks a test until the agent is told (median) | 2383 ms | 2409 ms | +1% |
| stress | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| stress | CPU with no edits: the busiest daemon, plus the store process | 0.3 % core | 0.3 % core | -0% |
| stress | CPU per edit: daemons with their test runs, plus the store process | 0.9 s | 0.8 s | -15% |
| stress | Daemon memory, peak | 359 MiB | 354 MiB | -2% |
| stress | Daemon with its test runs, memory per worktree, peak | 741 MiB | 697 MiB | -6% |
| stress | Store process memory, peak | 228 MiB | 248 MiB | +9% |
| stress | Store writes that held the lock over 250 ms | 4 | 13 | +225% |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | 393 ms | 1528 ms | +289% |
| stress | Logged lock holds, total | 1.2 s | 6.5 s | +447% |
| stress | `squeal impact` (reads every stored module list) | 0.3 s | 0.3 s | +1% |
| stress | `squeal impact` memory, peak | 116 MiB | 117 MiB | +0% |
| store-7g-wt3 | Hook before each tool call (slowest 5%) | 206 ms | 169 ms | -18% |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 5%) | 324 ms | 255 ms | -21% |
| store-7g-wt3 | Hook before each tool call (slowest 1%) | 243 ms | 256 ms | +6% |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 1%) | 870 ms | 396 ms | -55% |
| store-7g-wt3 | Hook write wait for the daemon main thread (longest) | 794 ms | 362 ms | -54% |
| store-7g-wt3 | Hook writes that waited over 250 ms for the daemon main thread | 3 | 1 | -67% |
| store-7g-wt3 | Hook at session start (slowest) | 241 ms | 199 ms | -17% |
| store-7g-wt3 | `squeal status` (slowest 5%) | 264 ms | 212 ms | -20% |
| store-7g-wt3 | Edit that breaks a test until the agent is told (median) | 1349 ms | 1191 ms | -12% |
| store-7g-wt3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| store-7g-wt3 | CPU with no edits: the busiest daemon, plus the store process | 1.9 % core | 1.9 % core | +0% |
| store-7g-wt3 | CPU per edit: daemons with their test runs, plus the store process | 0.8 s | 0.7 s | -13% |
| store-7g-wt3 | Daemon memory, peak | 393 MiB | 387 MiB | -1% |
| store-7g-wt3 | Daemon with its test runs, memory per worktree, peak | 735 MiB | 690 MiB | -6% |
| store-7g-wt3 | Store process memory, peak | 206 MiB | 193 MiB | -6% |
| store-7g-wt3 | Store writes that held the lock over 250 ms | 25 | 19 | -24% |
| store-7g-wt3 | Longest logged lock hold (only holds over 250 ms are logged) | 2073 ms | 4038 ms | +95% |
| store-7g-wt3 | Logged lock holds, total | 15 s | 15 s | -3% |
| store-7g-wt3 | `squeal impact` (reads every stored module list) | 0.2 s | 0.5 s | +150% |
| store-7g-wt3 | `squeal impact` memory, peak | 165 MiB | 147 MiB | -11% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 7 of 8 cells: wt-3@0.1.636 97 ms ⚠️, wt-6@0.1.636 80 ms ⚠️, wt-6@0.1.638 101 ms ⚠️, stress@0.1.636 147 ms ⚠️, stress@0.1.638 185 ms ⚠️, store-7g-wt3@0.1.636 206 ms ❌, store-7g-wt3@0.1.638 169 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: wt-3@0.1.636 123 ms ⚠️, wt-3@0.1.638 83 ms ⚠️, wt-6@0.1.636 123 ms ⚠️, wt-6@0.1.638 158 ms ⚠️, stress@0.1.636 197 ms ⚠️, stress@0.1.638 220 ms ❌, store-7g-wt3@0.1.636 324 ms ❌, store-7g-wt3@0.1.638 255 ms ❌
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 8 cells: store-7g-wt3@0.1.636 327 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 2 of 8 cells: stress@0.1.636 15780 ms ⚠️, stress@0.1.638 15036 ms ⚠️
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 4 of 8 cells: wt-6@0.1.636 208 s ⚠️, wt-6@0.1.638 223 s ⚠️, stress@0.1.636 late ❌, stress@0.1.638 late ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 8 cells: store-7g-wt3@0.1.636 1.9 % core ⚠️, store-7g-wt3@0.1.638 1.9 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 8 of 8 cells: wt-3@0.1.636 433 MiB ⚠️, wt-3@0.1.638 360 MiB ⚠️, wt-6@0.1.636 390 MiB ⚠️, wt-6@0.1.638 394 MiB ⚠️, stress@0.1.636 359 MiB ⚠️, stress@0.1.638 354 MiB ⚠️, store-7g-wt3@0.1.636 393 MiB ⚠️, store-7g-wt3@0.1.638 387 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 6 of 8 cells: wt-6@0.1.636 5 ❌, wt-6@0.1.638 10 ❌, stress@0.1.636 4 ❌, stress@0.1.638 13 ❌, store-7g-wt3@0.1.636 25 ❌, store-7g-wt3@0.1.638 19 ❌

## Before the idle minute

Every cell's baselines and store process settled before its idle minute.

## Every metric

| Metric | Healthy | Warn | wt-3@0.1.636 | wt-3@0.1.638 | wt-6@0.1.636 | wt-6@0.1.638 | stress@0.1.636 | stress@0.1.638 | store-7g-wt3@0.1.636 | store-7g-wt3@0.1.638 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 97 ms ⚠️ | 75 ms ✅ | 80 ms ⚠️ | 101 ms ⚠️ | 147 ms ⚠️ | 185 ms ⚠️ | 206 ms ❌ | 169 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 123 ms ⚠️ | 83 ms ⚠️ | 123 ms ⚠️ | 158 ms ⚠️ | 197 ms ⚠️ | 220 ms ❌ | 324 ms ❌ | 255 ms ❌ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 119 ms | 89 ms | 119 ms | 205 ms | 194 ms | 364 ms | 243 ms | 256 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 122 ms | 100 ms | 165 ms | 284 ms | 196 ms | 454 ms | 244 ms | 282 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 155 ms | 140 ms | 196 ms | 191 ms | 279 ms | 417 ms | 870 ms | 396 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 159 ms | 244 ms | 341 ms | 273 ms | 399 ms | 1213 ms | 944 ms | 471 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | 30 ms | 167 ms | 273 ms | 33 ms | 181 ms | 230 ms | 794 ms | 362 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | 30 ms | 167 ms | 273 ms | 33 ms | 181 ms | 230 ms | 794 ms | 362 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | 0 | 0 | 1 | 0 | 0 | 0 | 3 | 1 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 297 ms ✅ | 116 ms ✅ | 105 ms ✅ | 123 ms ✅ | 193 ms ✅ | 177 ms ✅ | 241 ms ✅ | 199 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 159 ms ✅ | 122 ms ✅ | 100 ms ✅ | 158 ms ✅ | 180 ms ✅ | 206 ms ✅ | 359 ms ✅ | 273 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 140 ms ✅ | 117 ms ✅ | 151 ms ✅ | 223 ms ✅ | 267 ms ✅ | 269 ms ✅ | 264 ms ✅ | 212 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 148 ms ✅ | 117 ms ✅ | 138 ms ✅ | 178 ms ✅ | 247 ms ✅ | 270 ms ✅ | 327 ms ⚠️ | 258 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 535 ms ✅ | 567 ms ✅ | 660 ms ✅ | 517 ms ✅ | 841 ms ✅ | 613 ms ✅ | 475 ms ✅ | 751 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | 267 ms ✅ | 201 ms ✅ | 437 ms ✅ | 364 ms ✅ | 539 ms ✅ | 674 ms ✅ | 394 ms ✅ | 632 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 40 s | 42 s | 43 s | 38 s | 200 s | 164 s | 45 s | 36 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1166 ms ✅ | 1133 ms ✅ | 1129 ms ✅ | 1172 ms ✅ | 2383 ms ✅ | 2409 ms ✅ | 1349 ms ✅ | 1191 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1450 ms ✅ | 1412 ms ✅ | 1418 ms ✅ | 1493 ms ✅ | 1683 ms ✅ | 1769 ms ✅ | 1675 ms ✅ | 1522 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 5534 ms ✅ | 5011 ms ✅ | 5473 ms ✅ | 5615 ms ✅ | 15780 ms ⚠️ | 15036 ms ⚠️ | 8166 ms ✅ | 5628 ms ✅ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 120 s ✅ | 107 s ✅ | 208 s ⚠️ | 223 s ⚠️ | late ❌ | late ❌ | 155 s ✅ | 149 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.4 % core ✅ | 0.3 % core ✅ | 0.4 % core ✅ | 0.4 % core ✅ | 0.3 % core ✅ | 0.3 % core ✅ | 1.9 % core ⚠️ | 1.9 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 433 MiB ⚠️ | 360 MiB ⚠️ | 390 MiB ⚠️ | 394 MiB ⚠️ | 359 MiB ⚠️ | 354 MiB ⚠️ | 393 MiB ⚠️ | 387 MiB ⚠️ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 702 MiB ✅ | 674 MiB ✅ | 655 MiB ✅ | 646 MiB ✅ | 741 MiB ✅ | 697 MiB ✅ | 735 MiB ✅ | 690 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.3 s | 0.2 s | 0.2 s | 0.2 s | 0.9 s | 0.8 s | 0.8 s | 0.7 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 2.2 s | 1.7 s | 3.0 s | 3.4 s | 2.4 s | 2.5 s | 3.4 s | 2.8 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 211 MiB | 198 MiB | 265 MiB | 282 MiB | 228 MiB | 248 MiB | 206 MiB | 193 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 5 ❌ | 10 ❌ | 4 ❌ | 13 ❌ | 25 ❌ | 19 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 53 MiB | 36 MiB | 68 MiB | 65 MiB | 53 MiB | 56 MiB | 10582 MiB | 10661 MiB |
| Result rows in the store (`store.results`) | report |  | 17038 | 17038 | 29414 | 29414 | 10871 | 10213 | 1157198 | 1157254 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 201 ms | 36 ms | 384 ms | 265 ms | 196 ms | 5371 ms | 1131 ms | 221 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 18 s | 12 s | 21 s | 25 s | 22 s | 38 s | 35 s | 16 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.2 s | 0.2 s | 0.3 s | 0.3 s | 0.3 s | 0.2 s | 0.5 s |
| **Resources** | | |  |  |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 98 MiB | 114 MiB | 116 MiB | 128 MiB | 116 MiB | 117 MiB | 165 MiB | 147 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | n/a | 275 ms | 420 ms | 393 ms | 1528 ms | 2073 ms | 4038 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0 s | 1.3 s | 3.0 s | 1.2 s | 6.5 s | 15 s | 15 s |
