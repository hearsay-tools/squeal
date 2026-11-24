# Squeal performance scorecard

Squeal 0.1.623 vs 0.1.626 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2460 MiB/s · 2026-11-24T20:15:27.463Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 65 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 56 | 67 | 80 | 61 | 63 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.623 | 500 | 1 | 0% | 0 | ✅ | 87 | 75 | 100 | 100 | 83 | 75 |
| ref@0.1.626 | 500 | 1 | 0% | 0 | ✅ | 78 | 63 | 63 | 100 | 67 | 100 |
| wt-3@0.1.623 | 500 | 3 | 0% | 0 | ✅ | 68 | 50 | 75 | 100 | 67 | 50 |
| wt-3@0.1.626 | 500 | 3 | 0% | 0 | ✅ | 65 | 50 | 75 | 100 | 50 | 50 |
| stress@0.1.623 | 500 | 6 | 100% | 0 | ✅ | 48 | 50 | 50 | 40 | 50 | 50 |
| stress@0.1.626 | 500 | 6 | 100% | 0 | ✅ | 46 | 50 | 38 | 40 | 50 | 50 |

## 0.1.623 compared with 0.1.626 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.623 | 1 | ✅ | 87 |  |  |  |  |  |  |
| ref | 0.1.626 | 1 | ✅ | 78 | -8 | -13 | -38 | +0 | -17 | +25 |
| wt-3 | 0.1.623 | 1 | ✅ | 68 |  |  |  |  |  |  |
| wt-3 | 0.1.626 | 1 | ✅ | 65 | -3 | +0 | +0 | +0 | -17 | +0 |
| stress | 0.1.623 | 1 | ✅ | 48 |  |  |  |  |  |  |
| stress | 0.1.626 | 1 | ✅ | 46 | -3 | +0 | -13 | +0 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.623 | 0.1.626 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 85 ms | 169 ms | +100% |
| ref | Hook after each batch of tool calls (slowest 5%) | 124 ms | 271 ms | +118% |
| ref | Hook before each tool call (slowest 1%) | 96 ms | 207 ms | +115% |
| ref | Hook after each batch of tool calls (slowest 1%) | 128 ms | 298 ms | +132% |
| ref | Hook write wait for the daemon main thread (longest) | n/a | 70 ms |  |
| ref | Hook writes that waited over 250 ms for the daemon main thread | n/a | 0 |  |
| ref | Hook at session start (slowest) | 140 ms | 135 ms | -3% |
| ref | `squeal status` (slowest 5%) | 248 ms | 420 ms | +69% |
| ref | Edit that breaks a test until the agent is told (median) | 1194 ms | 1282 ms | +7% |
| ref | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.8 % core | 2.7 % core | +224% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.4 s | 2.4 s | +73% |
| ref | Daemon memory, peak | 425 MiB | 464 MiB | +9% |
| ref | Daemon with its test runs, memory per worktree, peak | 1106 MiB | 1196 MiB | +8% |
| ref | Store process memory, peak | 157 MiB | 154 MiB | -2% |
| ref | Store writes that held the lock over 250 ms | 1 | 0 | -100% |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 407 ms | n/a |  |
| ref | Logged lock holds, total | 0.4 s | 0 s | -100% |
| ref | `squeal impact` (reads every stored module list) | 0.5 s | 0.4 s | -28% |
| ref | `squeal impact` memory, peak | 154 MiB | 154 MiB | +0% |
| wt-3 | Hook before each tool call (slowest 5%) | 215 ms | 208 ms | -3% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 309 ms | 272 ms | -12% |
| wt-3 | Hook before each tool call (slowest 1%) | 262 ms | 243 ms | -7% |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 455 ms | 313 ms | -31% |
| wt-3 | Hook write wait for the daemon main thread (longest) | n/a | 245 ms |  |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | n/a | 0 |  |
| wt-3 | Hook at session start (slowest) | 163 ms | 316 ms | +94% |
| wt-3 | `squeal status` (slowest 5%) | 437 ms | 558 ms | +28% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1542 ms | 1311 ms | -15% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 4.7 % core | 7.9 % core | +67% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.6 s | 0.8 s | +24% |
| wt-3 | Daemon memory, peak | 446 MiB | 470 MiB | +5% |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 778 MiB | 813 MiB | +5% |
| wt-3 | Store process memory, peak | 193 MiB | 208 MiB | +8% |
| wt-3 | Store writes that held the lock over 250 ms | 6 | 6 | +0% |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 435 ms | 467 ms | +7% |
| wt-3 | Logged lock holds, total | 2.0 s | 1.9 s | -9% |
| wt-3 | `squeal impact` (reads every stored module list) | 0.5 s | 0.3 s | -35% |
| wt-3 | `squeal impact` memory, peak | 158 MiB | 165 MiB | +4% |
| stress | Hook before each tool call (slowest 5%) | 542 ms | 480 ms | -11% |
| stress | Hook after each batch of tool calls (slowest 5%) | 713 ms | 707 ms | -1% |
| stress | Hook before each tool call (slowest 1%) | 858 ms | 579 ms | -33% |
| stress | Hook after each batch of tool calls (slowest 1%) | 882 ms | 1075 ms | +22% |
| stress | Hook write wait for the daemon main thread (longest) | n/a | 827 ms |  |
| stress | Hook writes that waited over 250 ms for the daemon main thread | n/a | 8 |  |
| stress | Hook at session start (slowest) | 515 ms | 533 ms | +3% |
| stress | `squeal status` (slowest 5%) | 1311 ms | 1292 ms | -1% |
| stress | Edit that breaks a test until the agent is told (median) | 6963 ms | 6699 ms | -4% |
| stress | Edits with a verdict within the 60 s agents wait | 96 % | 96 % | +0% |
| stress | CPU with no edits: the busiest daemon, plus the store process | 9.6 % core | 11 % core | +18% |
| stress | CPU per edit: daemons with their test runs, plus the store process | 4.4 s | 2.6 s | -41% |
| stress | Daemon memory, peak | 380 MiB | 416 MiB | +10% |
| stress | Daemon with its test runs, memory per worktree, peak | 800 MiB | 764 MiB | -5% |
| stress | Store process memory, peak | 220 MiB | 232 MiB | +5% |
| stress | Store writes that held the lock over 250 ms | 23 | 34 | +48% |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | 764 ms | 1133 ms | +48% |
| stress | Logged lock holds, total | 9.1 s | 14 s | +57% |
| stress | `squeal impact` (reads every stored module list) | 0.8 s | 0.9 s | +11% |
| stress | `squeal impact` memory, peak | 132 MiB | 131 MiB | -0% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 6 of 6 cells: ref@0.1.623 85 ms ⚠️, ref@0.1.626 169 ms ⚠️, wt-3@0.1.623 215 ms ❌, wt-3@0.1.626 208 ms ❌, stress@0.1.623 542 ms ❌, stress@0.1.626 480 ms ❌
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 6 of 6 cells: ref@0.1.623 124 ms ⚠️, ref@0.1.626 271 ms ❌, wt-3@0.1.623 309 ms ❌, wt-3@0.1.626 272 ms ❌, stress@0.1.623 713 ms ❌, stress@0.1.626 707 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 5 of 6 cells: ref@0.1.626 420 ms ⚠️, wt-3@0.1.623 437 ms ⚠️, wt-3@0.1.626 558 ms ⚠️, stress@0.1.623 1311 ms ❌, stress@0.1.626 1292 ms ❌
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 5 of 6 cells: ref@0.1.626 397 ms ⚠️, wt-3@0.1.623 416 ms ⚠️, wt-3@0.1.626 578 ms ⚠️, stress@0.1.623 1662 ms ❌, stress@0.1.626 1167 ms ❌
- **Commands · `squeal start` in another worktree on the shared store** (healthy ≤ 2000 ms): 1 of 6 cells: stress@0.1.626 2450 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 6 cells: ref@0.1.626 1.41 x ⚠️
- **Verdicts · Edit that breaks a test until the agent is told (median)** (healthy ≤ 3000 ms): 2 of 6 cells: stress@0.1.623 6963 ms ⚠️, stress@0.1.626 6699 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 2 of 6 cells: stress@0.1.623 5722 ms ⚠️, stress@0.1.626 5907 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 2 of 6 cells: stress@0.1.623 46140 ms ❌, stress@0.1.626 48011 ms ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 2 of 6 cells: stress@0.1.623 late ❌, stress@0.1.626 late ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 5 of 6 cells: ref@0.1.626 2.7 % core ⚠️, wt-3@0.1.623 4.7 % core ⚠️, wt-3@0.1.626 7.9 % core ❌, stress@0.1.623 9.6 % core ❌, stress@0.1.626 11 % core ❌
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 6 of 6 cells: ref@0.1.623 425 MiB ⚠️, ref@0.1.626 464 MiB ⚠️, wt-3@0.1.623 446 MiB ⚠️, wt-3@0.1.626 470 MiB ⚠️, stress@0.1.623 380 MiB ⚠️, stress@0.1.626 416 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 5 of 6 cells: ref@0.1.623 1 ⚠️, wt-3@0.1.623 6 ❌, wt-3@0.1.626 6 ❌, stress@0.1.623 23 ❌, stress@0.1.626 34 ❌

## Every metric

| Metric | Healthy | Warn | ref@0.1.623 | ref@0.1.626 | wt-3@0.1.623 | wt-3@0.1.626 | stress@0.1.623 | stress@0.1.626 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 85 ms ⚠️ | 169 ms ⚠️ | 215 ms ❌ | 208 ms ❌ | 542 ms ❌ | 480 ms ❌ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 124 ms ⚠️ | 271 ms ❌ | 309 ms ❌ | 272 ms ❌ | 713 ms ❌ | 707 ms ❌ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 96 ms | 207 ms | 262 ms | 243 ms | 858 ms | 579 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 99 ms | 216 ms | 267 ms | 251 ms | 991 ms | 589 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 128 ms | 298 ms | 455 ms | 313 ms | 882 ms | 1075 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 129 ms | 302 ms | 465 ms | 437 ms | 1057 ms | 1647 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | n/a | 70 ms | n/a | 245 ms | n/a | 827 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | n/a | 70 ms | n/a | 245 ms | n/a | 827 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | n/a | 0 | n/a | 0 | n/a | 8 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 140 ms ✅ | 135 ms ✅ | 163 ms ✅ | 316 ms ✅ | 515 ms ✅ | 533 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 206 ms ✅ | 149 ms ✅ | 174 ms ✅ | 181 ms ✅ | 682 ms ✅ | 515 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 248 ms ✅ | 420 ms ⚠️ | 437 ms ⚠️ | 558 ms ⚠️ | 1311 ms ❌ | 1292 ms ❌ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 232 ms ✅ | 397 ms ⚠️ | 416 ms ⚠️ | 578 ms ⚠️ | 1662 ms ❌ | 1167 ms ❌ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 503 ms ✅ | 413 ms ✅ | 499 ms ✅ | 494 ms ✅ | 1427 ms ✅ | 824 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 593 ms ✅ | 538 ms ✅ | 1344 ms ✅ | 2450 ms ⚠️ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.22 x ✅ | 1.41 x ⚠️ | n/a | n/a | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 52 s | 62 s | 56 s | 57 s | 561 s | 510 s |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1194 ms ✅ | 1282 ms ✅ | 1542 ms ✅ | 1311 ms ✅ | 6963 ms ⚠️ | 6699 ms ⚠️ |
| **Correctness** | | |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1649 ms ✅ | 2301 ms ✅ | 1908 ms ✅ | 2022 ms ✅ | 5722 ms ⚠️ | 5907 ms ⚠️ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 4619 ms ✅ | 8559 ms ✅ | 8355 ms ✅ | 6922 ms ✅ | 46140 ms ❌ | 48011 ms ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 96 % ✅ | 96 % ✅ |
| **Correctness** | | |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 52 s ✅ | 56 s ✅ | 173 s ✅ | 156 s ✅ | late ❌ | late ❌ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.8 % core ✅ | 2.7 % core ⚠️ | 4.7 % core ⚠️ | 7.9 % core ❌ | 9.6 % core ❌ | 11 % core ❌ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 425 MiB ⚠️ | 464 MiB ⚠️ | 446 MiB ⚠️ | 470 MiB ⚠️ | 380 MiB ⚠️ | 416 MiB ⚠️ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 1106 MiB ✅ | 1196 MiB ✅ | 778 MiB ✅ | 813 MiB ✅ | 800 MiB ✅ | 764 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.4 s | 2.4 s | 0.6 s | 0.8 s | 4.4 s | 2.6 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.1 s | 2.0 s | 4.5 s | 4.3 s | 7.0 s | 6.7 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 157 MiB | 154 MiB | 193 MiB | 208 MiB | 220 MiB | 232 MiB |
| **Store** | | |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 1 ⚠️ | 0 ✅ | 6 ❌ | 6 ❌ | 23 ❌ | 34 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 19 MiB | 19 MiB | 38 MiB | 41 MiB | 46 MiB | 45 MiB |
| Result rows in the store (`store.results`) | report |  | 8190 | 8190 | 17038 | 17038 | 9415 | 9555 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 1 ms | 31 ms | 159 ms | 163 ms | 335 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 2.0 s | 4.0 s | 7.2 s | 8.6 s | 24 s | 25 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| **Commands** | | |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.5 s | 0.4 s | 0.5 s | 0.3 s | 0.8 s | 0.9 s |
| **Resources** | | |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 154 MiB | 154 MiB | 158 MiB | 165 MiB | 132 MiB | 131 MiB |
| **Store** | | |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 407 ms | n/a | 435 ms | 467 ms | 764 ms | 1133 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.4 s | 0 s | 2.0 s | 1.9 s | 9.1 s | 14 s |
