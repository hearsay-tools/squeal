# Squeal performance scorecard

Squeal 0.1.640 vs 0.1.641 · Node v24.22.1 · AMD EPYC · 4 vCPU · 7.8 GiB · SHA-256 2405 MiB/s · 2026-11-26T17:11:14.614Z

**Correctness: FAILED** in ref@0.1.640 (session.pushFail.missed 4, session.pushRecovery.missed 4); ref@0.1.641 (session.pushFail.missed 4, session.pushRecovery.missed 4); wt-3@0.1.640 (session.pushFail.missed 12, session.pushRecovery.missed 12); wt-3@0.1.641 (session.pushFail.missed 12, session.pushRecovery.missed 12); stress@0.1.640 (session.pushFail.missed 24, session.pushRecovery.missed 24); stress@0.1.641 (session.pushFail.missed 24, session.pushRecovery.missed 24)

**Overall score: 69 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 75 | 94 | 0 | 97 | 79 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.640 | 500 | 1 | 0% | 0 | ❌ | 70 | 75 | 100 | 0 | 100 | 75 |
| ref@0.1.641 | 500 | 1 | 0% | 0 | ❌ | 72 | 75 | 100 | 0 | 83 | 100 |
| wt-3@0.1.640 | 500 | 3 | 0% | 0 | ❌ | 75 | 100 | 100 | 0 | 100 | 75 |
| wt-3@0.1.641 | 500 | 3 | 0% | 0 | ❌ | 65 | 75 | 100 | 0 | 100 | 50 |
| stress@0.1.640 | 500 | 6 | 100% | 0 | ❌ | 63 | 50 | 88 | 0 | 100 | 75 |
| stress@0.1.641 | 500 | 6 | 100% | 0 | ❌ | 70 | 75 | 75 | 0 | 100 | 100 |

## 0.1.640 compared with 0.1.641 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.640 | 1 | ❌ | 70 |  |  |  |  |  |  |
| ref | 0.1.641 | 1 | ❌ | 72 | +2 | +0 | +0 | +0 | -17 | +25 |
| wt-3 | 0.1.640 | 1 | ❌ | 75 |  |  |  |  |  |  |
| wt-3 | 0.1.641 | 1 | ❌ | 65 | -10 | -25 | +0 | +0 | +0 | -25 |
| stress | 0.1.640 | 1 | ❌ | 63 |  |  |  |  |  |  |
| stress | 0.1.641 | 1 | ❌ | 70 | +8 | +25 | -13 | +0 | +0 | +25 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.640 | 0.1.641 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 154 ms | 144 ms | -6% |
| ref | Hook after each batch of tool calls (slowest 5%) | 151 ms | 104 ms | -31% |
| ref | Hook before each tool call (slowest 1%) | 186 ms | 146 ms | -21% |
| ref | Hook after each batch of tool calls (slowest 1%) | 177 ms | 121 ms | -31% |
| ref | Hook write wait for the daemon main thread (longest) | 14 ms | 6 ms | -57% |
| ref | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| ref | Hook at session start (slowest) | 367 ms | 303 ms | -18% |
| ref | `squeal status` (slowest 5%) | 227 ms | 194 ms | -15% |
| ref | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.5 % core | 2.3 % core | +353% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.1 s | 0.7 s | -38% |
| ref | Daemon memory, peak | 281 MiB | 276 MiB | -2% |
| ref | Daemon with its test runs, memory per worktree, peak | 530 MiB | 525 MiB | -1% |
| ref | Store process memory, peak | 138 MiB | 138 MiB | +0% |
| ref | Store writes that held the lock over 250 ms | 1 | 0 | -100% |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 516 ms | n/a |  |
| ref | Logged lock holds, total | 0.5 s | 0 s | -100% |
| ref | `squeal impact` (reads every stored module list) | 0.2 s | 0.1 s | -43% |
| ref | `squeal impact` memory, peak | 77 MiB | 0 MiB | -100% |
| wt-3 | Hook before each tool call (slowest 5%) | 80 ms | 187 ms | +135% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 77 ms | 90 ms | +18% |
| wt-3 | Hook before each tool call (slowest 1%) | 241 ms | 214 ms | -11% |
| wt-3 | Hook after each batch of tool calls (slowest 1%) | 127 ms | 160 ms | +26% |
| wt-3 | Hook write wait for the daemon main thread (longest) | 45 ms | 72 ms | +60% |
| wt-3 | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| wt-3 | Hook at session start (slowest) | 232 ms | 394 ms | +70% |
| wt-3 | `squeal status` (slowest 5%) | 131 ms | 140 ms | +7% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 0.1 % core | 0.1 % core | -0% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.2 s | 0.2 s | +12% |
| wt-3 | Daemon memory, peak | 266 MiB | 279 MiB | +5% |
| wt-3 | Daemon with its test runs, memory per worktree, peak | 307 MiB | 313 MiB | +2% |
| wt-3 | Store process memory, peak | 178 MiB | 188 MiB | +5% |
| wt-3 | Store writes that held the lock over 250 ms | 3 | 5 | +67% |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 341 ms | 1184 ms | +247% |
| wt-3 | Logged lock holds, total | 1.0 s | 3.7 s | +279% |
| wt-3 | `squeal impact` (reads every stored module list) | 0.1 s | 0.2 s | +22% |
| wt-3 | `squeal impact` memory, peak | 81 MiB | 71 MiB | -12% |
| stress | Hook before each tool call (slowest 5%) | 208 ms | 180 ms | -13% |
| stress | Hook after each batch of tool calls (slowest 5%) | 200 ms | 182 ms | -9% |
| stress | Hook before each tool call (slowest 1%) | 359 ms | 263 ms | -27% |
| stress | Hook after each batch of tool calls (slowest 1%) | 257 ms | 220 ms | -14% |
| stress | Hook write wait for the daemon main thread (longest) | 243 ms | 48 ms | -80% |
| stress | Hook writes that waited over 250 ms for the daemon main thread | 0 | 0 |  |
| stress | Hook at session start (slowest) | 503 ms | 315 ms | -37% |
| stress | `squeal status` (slowest 5%) | 344 ms | 311 ms | -10% |
| stress | Edits with a verdict within the 60 s agents wait | 0 % | 0 % |  |
| stress | CPU with no edits: the busiest daemon, plus the store process | 0.1 % core | 0.1 % core | +25% |
| stress | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.2 s | -42% |
| stress | Daemon memory, peak | 278 MiB | 273 MiB | -2% |
| stress | Daemon with its test runs, memory per worktree, peak | 262 MiB | 267 MiB | +2% |
| stress | Store process memory, peak | 198 MiB | 213 MiB | +7% |
| stress | Store writes that held the lock over 250 ms | 2 | 0 | -100% |
| stress | Longest logged lock hold (only holds over 250 ms are logged) | 640 ms | n/a |  |
| stress | Logged lock holds, total | 1.1 s | 0 s | -100% |
| stress | `squeal impact` (reads every stored module list) | 0.3 s | 0.2 s | -42% |
| stress | `squeal impact` memory, peak | 76 MiB | 71 MiB | -6% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 5 of 6 cells: ref@0.1.640 154 ms ⚠️, ref@0.1.641 144 ms ⚠️, wt-3@0.1.641 187 ms ⚠️, stress@0.1.640 208 ms ❌, stress@0.1.641 180 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 5 of 6 cells: ref@0.1.640 151 ms ⚠️, ref@0.1.641 104 ms ⚠️, wt-3@0.1.641 90 ms ⚠️, stress@0.1.640 200 ms ❌, stress@0.1.641 182 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 2 of 6 cells: stress@0.1.640 344 ms ⚠️, stress@0.1.641 311 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 6 cells: stress@0.1.641 366 ms ⚠️
- **Verdicts · Edit that breaks a test until the agent is told (median)** (healthy ≤ 3000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 6 of 6 cells: ref@0.1.640 0 % ❌, ref@0.1.641 0 % ❌, wt-3@0.1.640 0 % ❌, wt-3@0.1.641 0 % ❌, stress@0.1.640 0 % ❌, stress@0.1.641 0 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 6 cells: ref@0.1.640 late ❌, ref@0.1.641 late ❌, wt-3@0.1.640 late ❌, wt-3@0.1.641 late ❌, stress@0.1.640 late ❌, stress@0.1.641 late ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 1 of 6 cells: ref@0.1.641 2.3 % core ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 4 of 6 cells: ref@0.1.640 1 ⚠️, wt-3@0.1.640 3 ⚠️, wt-3@0.1.641 5 ❌, stress@0.1.640 2 ⚠️

## Before the idle minute

- wt-3@0.1.640: wt1 baseline not settled (listing); wt2 baseline not settled (listing)
- wt-3@0.1.641: wt1 baseline not settled (listing); wt2 baseline not settled (listing)
- stress@0.1.640: wt1 baseline not settled (listing); wt2 baseline not settled (listing); wt3 baseline not settled (listing); wt4 baseline not settled (listing); wt5 baseline not settled (listing)
- stress@0.1.641: wt1 baseline not settled (listing); wt2 baseline not settled (listing); wt3 baseline not settled (listing); wt4 baseline not settled (listing); wt5 baseline not settled (listing)

## Every metric

| Metric | Healthy | Warn | ref@0.1.640 | ref@0.1.641 | wt-3@0.1.640 | wt-3@0.1.641 | stress@0.1.640 | stress@0.1.641 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 154 ms ⚠️ | 144 ms ⚠️ | 80 ms ✅ | 187 ms ⚠️ | 208 ms ❌ | 180 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 151 ms ⚠️ | 104 ms ⚠️ | 77 ms ✅ | 90 ms ⚠️ | 200 ms ❌ | 182 ms ⚠️ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 186 ms | 146 ms | 241 ms | 214 ms | 359 ms | 263 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 195 ms | 147 ms | 419 ms | 218 ms | 597 ms | 285 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 177 ms | 121 ms | 127 ms | 160 ms | 257 ms | 220 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 203 ms | 182 ms | 504 ms | 685 ms | 457 ms | 360 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | 5 ms | 2 ms | 1 ms | 4 ms | 243 ms | 48 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | 14 ms | 6 ms | 45 ms | 72 ms | 243 ms | 48 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 367 ms ✅ | 303 ms ✅ | 232 ms ✅ | 394 ms ✅ | 503 ms ✅ | 315 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 149 ms ✅ | 56 ms ✅ | 74 ms ✅ | 85 ms ✅ | 251 ms ✅ | 150 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 227 ms ✅ | 194 ms ✅ | 131 ms ✅ | 140 ms ✅ | 344 ms ⚠️ | 311 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 206 ms ✅ | 158 ms ✅ | 131 ms ✅ | 123 ms ✅ | 289 ms ✅ | 366 ms ⚠️ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 778 ms ✅ | 1027 ms ✅ | 1149 ms ✅ | 745 ms ✅ | 1395 ms ✅ | 1328 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 685 ms ✅ | 298 ms ✅ | 1235 ms ✅ | 1004 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 0.03 x ✅ | 0.03 x ✅ | n/a | n/a | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 1.1 s | 1.7 s | 1.8 s | 1.6 s | 3.0 s | 2.6 s |
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
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.5 % core ✅ | 2.3 % core ⚠️ | 0.1 % core ✅ | 0.1 % core ✅ | 0.1 % core ✅ | 0.1 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 281 MiB ✅ | 276 MiB ✅ | 266 MiB ✅ | 279 MiB ✅ | 278 MiB ✅ | 273 MiB ✅ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 530 MiB ✅ | 525 MiB ✅ | 307 MiB ✅ | 313 MiB ✅ | 262 MiB ✅ | 267 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.1 s | 0.7 s | 0.2 s | 0.2 s | 0.3 s | 0.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.7 s | 0.4 s | 0.8 s | 0.9 s | 1.4 s | 1.2 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 138 MiB | 138 MiB | 178 MiB | 188 MiB | 198 MiB | 213 MiB |
| **Store** | | |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 1 ⚠️ | 0 ✅ | 3 ⚠️ | 5 ❌ | 2 ⚠️ | 0 ✅ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 6.6 MiB | 6.6 MiB | 11 MiB | 11 MiB | 18 MiB | 18 MiB |
| Result rows in the store (`store.results`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 1 ms | 232 ms | 132 ms | 1610 ms | 102 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 4.6 s | 3.4 s | 13 s | 18 s | 28 s | 20 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.1 s | 0.1 s | 0.2 s | 0.3 s | 0.2 s |
| **Resources** | | |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 77 MiB | 0 MiB | 81 MiB | 71 MiB | 76 MiB | 71 MiB |
| **Store** | | |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 516 ms | n/a | 341 ms | 1184 ms | 640 ms | n/a |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.5 s | 0 s | 1.0 s | 3.7 s | 1.1 s | 0 s |
