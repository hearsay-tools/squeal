# Squeal performance scorecard

Squeal 0.1.640 vs 0.1.641 · Node v24.22.1 · AMD EPYC 9455 48-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 1941 MiB/s · 2026-11-26T13:54:24.833Z

**Correctness: FAILED** in ref@0.1.640 (session.pushFail.missed 4, session.pushRecovery.missed 4); ref@0.1.641 (session.pushFail.missed 4, session.pushRecovery.missed 4); wt-3@0.1.640 (session.pushFail.missed 12, session.pushRecovery.missed 12); wt-3@0.1.641 (session.pushFail.missed 12, session.pushRecovery.missed 12); stress@0.1.640 (session.pushFail.missed 24, session.pushRecovery.missed 24); stress@0.1.641 (session.pushFail.missed 24, session.pushRecovery.missed 24)

**Overall score: 76 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 90 | 100 | 0 | 94 | 96 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.640 | 500 | 1 | 0% | 0 | ❌ | 77 | 100 | 100 | 0 | 83 | 100 |
| ref@0.1.641 | 500 | 1 | 0% | 0 | ❌ | 77 | 100 | 100 | 0 | 83 | 100 |
| wt-3@0.1.640 | 500 | 3 | 0% | 0 | ❌ | 78 | 88 | 100 | 0 | 100 | 100 |
| wt-3@0.1.641 | 500 | 3 | 0% | 0 | ❌ | 80 | 100 | 100 | 0 | 100 | 100 |
| stress@0.1.640 | 500 | 6 | 100% | 0 | ❌ | 75 | 75 | 100 | 0 | 100 | 100 |
| stress@0.1.641 | 500 | 6 | 100% | 0 | ❌ | 70 | 75 | 100 | 0 | 100 | 75 |

## 0.1.640 compared with 0.1.641 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.640 | 1 | ❌ | 77 |  |  |  |  |  |  |
| ref | 0.1.641 | 1 | ❌ | 77 | +0 | +0 | +0 | +0 | +0 | +0 |
| wt-3 | 0.1.640 | 1 | ❌ | 78 |  |  |  |  |  |  |
| wt-3 | 0.1.641 | 1 | ❌ | 80 | +3 | +13 | +0 | +0 | +0 | +0 |
| stress | 0.1.640 | 1 | ❌ | 75 |  |  |  |  |  |  |
| stress | 0.1.641 | 1 | ❌ | 70 | -5 | +0 | +0 | +0 | +0 | -25 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.640 | 0.1.641 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 59 ms | 78 ms | +33% |
| ref | Hook after each batch of tool calls (slowest 5%) | 66 ms | 70 ms | +7% |
| ref | Hook before each tool call (slowest 1%) | 65 ms | 90 ms | +39% |
| ref | Hook after each batch of tool calls (slowest 1%) | 82 ms | 77 ms | -6% |
| ref | Hook write wait for the daemon main thread (longest) | 1 ms | 1 ms | +0% |
| ref | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| ref | Hook at session start (slowest) | 84 ms | 95 ms | +13% |
| ref | `squeal status` (slowest 5%) | 98 ms | 126 ms | +29% |
| ref | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| ref | CPU with no edits: the busiest daemon, plus the store process | 1.3 % core | 1.1 % core | -12% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 0.5 s | 0.6 s | +22% |
| ref | Daemon memory, peak | 277 MiB | 274 MiB | -1% |
| ref | Daemon with its test runs, memory per worktree, peak | 512 MiB | 451 MiB | -12% |
| ref | Store process memory, peak | 141 MiB | 138 MiB | -2% |
| ref | Store writes that held the lock over 250 ms | 0 | 0 |  |
| ref | Logged lock holds, total | 0 s | 0 s |  |
| ref | `squeal impact` (reads every stored module list) | 0.1 s | 0.2 s | +86% |
| ref | `squeal impact` memory, peak | 0 MiB | 68 MiB |  |
| wt-3 | Hook before each tool call (slowest 5%) | 88 ms | 67 ms | -24% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 79 ms | 72 ms | -9% |
| wt-3 | Hook before each tool call (slowest 1%) | 157 ms | 85 ms | -46% |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 107 ms | 78 ms | -27% |
| wt-3 | Hook write wait for the daemon main thread (longest) | 119 ms | 6 ms | -95% |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| wt-3 | Hook at session start (slowest) | 125 ms | 138 ms | +10% |
| wt-3 | `squeal status` (slowest 5%) | 143 ms | 141 ms | -1% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 0.1 % core | 0.1 % core | -0% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.2 s | 0.2 s | +0% |
| wt-3 | Daemon memory, peak | 251 MiB | 280 MiB | +11% |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 302 MiB | 308 MiB | +2% |
| wt-3 | Store process memory, peak | 176 MiB | 189 MiB | +7% |
| wt-3 | Store writes that held the lock over 250 ms | 0 | 0 |  |
| wt-3 | Logged lock holds, total | 0 s | 0 s |  |
| wt-3 | `squeal impact` (reads every stored module list) | 0.1 s | 0.1 s | -10% |
| wt-3 | `squeal impact` memory, peak | 74 MiB | 79 MiB | +6% |
| stress | Hook before each tool call (slowest 5%) | 114 ms | 109 ms | -5% |
| stress | Hook after each batch of tool calls (slowest 5%) | 126 ms | 124 ms | -2% |
| stress | Hook before each tool call (slowest 1%) | 124 ms | 114 ms | -8% |
| stress | Hook after each batch of tool calls (slowest 1%) | 155 ms | 158 ms | +2% |
| stress | Hook write wait for the daemon main thread (longest) | 10 ms | 42 ms | +320% |
| stress | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| stress | Hook at session start (slowest) | 179 ms | 175 ms | -2% |
| stress | `squeal status` (slowest 5%) | 258 ms | 207 ms | -20% |
| stress | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| stress | CPU with no edits: the busiest daemon, plus the store process | 0.1 % core | 0.1 % core | +25% |
| stress | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.3 s | -1% |
| stress | Daemon memory, peak | 273 MiB | 280 MiB | +3% |
| stress | Daemon with its test runs, memory per worktree, peak | 267 MiB | 264 MiB | -1% |
| stress | Store process memory, peak | 206 MiB | 205 MiB | -0% |
| stress | Store writes that held the lock over 250 ms | 0 | 3 |  |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | n/a | 311 ms |  |
| stress | Logged lock holds, total | 0 s | 0.9 s |  |
| stress | `squeal impact` (reads every stored module list) | 0.2 s | 0.3 s | +33% |
| stress | `squeal impact` memory, peak | 63 MiB | 71 MiB | +13% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 6 cells: wt-3@0.1.640 88 ms ⚠️, stress@0.1.640 114 ms ⚠️, stress@0.1.641 109 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 2 of 6 cells: stress@0.1.640 126 ms ⚠️, stress@0.1.641 124 ms ⚠️
- **Verdicts · Edit that breaks a test until the agent is told (median)** (healthy ≤ 3000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 6 of 6 cells: ref@0.1.640 0 % ❌, ref@0.1.641 0 % ❌, wt-3@0.1.640 0 % ❌, wt-3@0.1.641 0 % ❌, stress@0.1.640 0 % ❌, stress@0.1.641 0 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 6 cells: ref@0.1.640 1.3 % core ⚠️, ref@0.1.641 1.1 % core ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 1 of 6 cells: stress@0.1.641 3 ⚠️

## Before the idle minute

- wt-3@0.1.640: wt1 baseline not settled (listing); wt2 baseline not settled (listing)
- wt-3@0.1.641: wt1 baseline not settled (listing); wt2 baseline not settled (listing)
- stress@0.1.640: wt1 baseline not settled (listing); wt2 baseline not settled (listing); wt3 baseline not settled (listing); wt4 baseline not settled (listing); wt5 baseline not settled (listing)
- stress@0.1.641: wt1 baseline not settled (listing); wt2 baseline not settled (listing); wt3 baseline not settled (listing); wt4 baseline not settled (listing); wt5 baseline not settled (listing)

## Every metric

| Metric | Healthy | Warn | ref@0.1.640 | ref@0.1.641 | wt-3@0.1.640 | wt-3@0.1.641 | stress@0.1.640 | stress@0.1.641 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 59 ms ✅ | 78 ms ✅ | 88 ms ⚠️ | 67 ms ✅ | 114 ms ⚠️ | 109 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 66 ms ✅ | 70 ms ✅ | 79 ms ✅ | 72 ms ✅ | 126 ms ⚠️ | 124 ms ⚠️ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 65 ms | 90 ms | 157 ms | 85 ms | 124 ms | 114 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 66 ms | 93 ms | 207 ms | 98 ms | 129 ms | 127 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 82 ms | 77 ms | 107 ms | 78 ms | 155 ms | 158 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 149 ms | 103 ms | 456 ms | 141 ms | 273 ms | 352 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | 1 ms | 1 ms | 5 ms | 1 ms | 6 ms | 6 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | 1 ms | 1 ms | 119 ms | 6 ms | 10 ms | 42 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 84 ms ✅ | 95 ms ✅ | 125 ms ✅ | 138 ms ✅ | 179 ms ✅ | 175 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 60 ms ✅ | 64 ms ✅ | 66 ms ✅ | 67 ms ✅ | 143 ms ✅ | 126 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 98 ms ✅ | 126 ms ✅ | 143 ms ✅ | 141 ms ✅ | 258 ms ✅ | 207 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 99 ms ✅ | 110 ms ✅ | 167 ms ✅ | 136 ms ✅ | 211 ms ✅ | 194 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 368 ms ✅ | 357 ms ✅ | 567 ms ✅ | 730 ms ✅ | 1014 ms ✅ | 553 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 424 ms ✅ | 309 ms ✅ | 985 ms ✅ | 751 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 0.03 x ✅ | 0.02 x ✅ | n/a | n/a | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 0.8 s | 0.8 s | 1.1 s | 1.1 s | 2.0 s | 2.1 s |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| **Correctness** | | |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 4 ❌ | 4 ❌ | 12 ❌ | 12 ❌ | 24 ❌ | 24 ❌ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 4 ❌ | 4 ❌ | 12 ❌ | 12 ❌ | 24 ❌ | 24 ❌ |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 0 % ❌ | 0 % ❌ | 0 % ❌ | 0 % ❌ | 0 % ❌ | 0 % ❌ |
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
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.3 % core ⚠️ | 1.1 % core ⚠️ | 0.1 % core ✅ | 0.1 % core ✅ | 0.1 % core ✅ | 0.1 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 277 MiB ✅ | 274 MiB ✅ | 251 MiB ✅ | 280 MiB ✅ | 273 MiB ✅ | 280 MiB ✅ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 512 MiB ✅ | 451 MiB ✅ | 302 MiB ✅ | 308 MiB ✅ | 267 MiB ✅ | 264 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.5 s | 0.6 s | 0.2 s | 0.2 s | 0.3 s | 0.3 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.2 s | 0.3 s | 0.6 s | 0.5 s | 0.7 s | 0.7 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 141 MiB | 138 MiB | 176 MiB | 189 MiB | 206 MiB | 205 MiB |
| **Store** | | |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 3 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 6.6 MiB | 6.6 MiB | 11 MiB | 11 MiB | 18 MiB | 18 MiB |
| Result rows in the store (`store.results`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 1 ms | 39 ms | 51 ms | 67 ms | 139 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 0.2 s | 0.4 s | 1.4 s | 0.9 s | 3.9 s | 3.7 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.1 s | 0.2 s | 0.1 s | 0.1 s | 0.2 s | 0.3 s |
| **Resources** | | |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 0 MiB | 68 MiB | 74 MiB | 79 MiB | 63 MiB | 71 MiB |
| **Store** | | |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | n/a | n/a | n/a | n/a | 311 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0 s | 0 s | 0 s | 0 s | 0.9 s |
