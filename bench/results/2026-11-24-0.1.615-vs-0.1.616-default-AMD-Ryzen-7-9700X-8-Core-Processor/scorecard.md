# Squeal performance scorecard

Squeal 0.1.615 vs 0.1.616 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2362 MiB/s · 2026-11-24T09:29:31.018Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 80 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 75 | 84 | 100 | 59 | 81 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.615 | 500 | 1 | 0% | 0 | ✅ | 90 | 88 | 88 | 100 | 75 | 100 |
| ref@0.1.616 | 500 | 1 | 0% | 0 | ✅ | 88 | 75 | 88 | 100 | 75 | 100 |
| size-l@0.1.615 | 2000 | 1 | 0% | 0 | ✅ | 60 | 63 | 63 | 100 | 25 | 50 |
| size-l@0.1.616 | 2000 | 1 | 0% | 0 | ✅ | 65 | 63 | 63 | 100 | 50 | 50 |
| wt-3@0.1.615 | 500 | 3 | 0% | 0 | ✅ | 80 | 75 | 100 | 100 | 50 | 75 |
| wt-3@0.1.616 | 500 | 3 | 0% | 0 | ✅ | 80 | 75 | 100 | 100 | 50 | 75 |
| load-50@0.1.615 | 500 | 1 | 50% | 0 | ✅ | 88 | 75 | 88 | 100 | 75 | 100 |
| load-50@0.1.616 | 500 | 1 | 50% | 0 | ✅ | 90 | 88 | 88 | 100 | 75 | 100 |

## 0.1.615 compared with 0.1.616 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.615 | 1 | ✅ | 90 |  |  |  |  |  |  |
| ref | 0.1.616 | 1 | ✅ | 88 | -3 | -13 | +0 | +0 | +0 | +0 |
| size-l | 0.1.615 | 1 | ✅ | 60 |  |  |  |  |  |  |
| size-l | 0.1.616 | 1 | ✅ | 65 | +5 | +0 | +0 | +0 | +25 | +0 |
| wt-3 | 0.1.615 | 1 | ✅ | 80 |  |  |  |  |  |  |
| wt-3 | 0.1.616 | 1 | ✅ | 80 | +0 | +0 | +0 | +0 | +0 | +0 |
| load-50 | 0.1.615 | 1 | ✅ | 88 |  |  |  |  |  |  |
| load-50 | 0.1.616 | 1 | ✅ | 90 | +3 | +13 | +0 | +0 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.615 | 0.1.616 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 78 ms | 88 ms | +13% |
| ref | Hook after each batch of tool calls (slowest 5%) | 95 ms | 112 ms | +18% |
| ref | Hook at session start (slowest) | 143 ms | 124 ms | -13% |
| ref | `squeal status` (slowest 5%) | 197 ms | 164 ms | -17% |
| ref | Edit that breaks a test until the agent is told (median) | 1152 ms | 1166 ms | +1% |
| ref | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.6 % core | 0.3 % core | -55% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.1 s | 1.2 s | +5% |
| ref | Daemon memory, peak | 402 MiB | 350 MiB | -13% |
| ref | Store process memory, peak | 153 MiB | 163 MiB | +7% |
| ref | Store writes that held the lock over 250 ms | 0 | 0 |  |
| ref | Logged lock holds, total | 0 s | 0 s |  |
| ref | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | +6% |
| ref | `squeal impact` memory, peak | 145 MiB | 145 MiB | +0% |
| size-l | Hook before each tool call (slowest 5%) | 90 ms | 132 ms | +48% |
| size-l | Hook after each batch of tool calls (slowest 5%) | 257 ms | 272 ms | +6% |
| size-l | Hook at session start (slowest) | 345 ms | 244 ms | -29% |
| size-l | `squeal status` (slowest 5%) | 362 ms | 329 ms | -9% |
| size-l | Edit that breaks a test until the agent is told (median) | 1356 ms | 1313 ms | -3% |
| size-l | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| size-l | CPU with no edits: the busiest daemon, plus the store process | 1.8 % core | 1.0 % core | -46% |
| size-l | CPU per edit: daemons with their test runs, plus the store process | 2.7 s | 2.9 s | +6% |
| size-l | Daemon memory, peak | 611 MiB | 666 MiB | +9% |
| size-l | Store process memory, peak | 268 MiB | 294 MiB | +9% |
| size-l | Store writes that held the lock over 250 ms | 14 | 14 | +0% |
| size-l | Longest logged lock hold (only holds over 250 ms are logged) | 1389 ms | 1405 ms | +1% |
| size-l | Logged lock holds, total | 5.8 s | 5.7 s | -1% |
| size-l | `squeal impact` (reads every stored module list) | 0.6 s | 0.5 s | -9% |
| size-l | `squeal impact` memory, peak | 245 MiB | 232 MiB | -6% |
| wt-3 | Hook before each tool call (slowest 5%) | 96 ms | 97 ms | +0% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 147 ms | 159 ms | +9% |
| wt-3 | Hook at session start (slowest) | 120 ms | 150 ms | +25% |
| wt-3 | `squeal status` (slowest 5%) | 261 ms | 222 ms | -15% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1181 ms | 1194 ms | +1% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 3.6 % core | 3.5 % core | -0% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.3 s | -7% |
| wt-3 | Daemon memory, peak | 423 MiB | 403 MiB | -5% |
| wt-3 | Store process memory, peak | 210 MiB | 190 MiB | -10% |
| wt-3 | Store writes that held the lock over 250 ms | 1 | 1 | +0% |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 280 ms | 273 ms | -3% |
| wt-3 | Logged lock holds, total | 0.3 s | 0.3 s | -3% |
| wt-3 | `squeal impact` (reads every stored module list) | 0.3 s | 0.2 s | -23% |
| wt-3 | `squeal impact` memory, peak | 144 MiB | 90 MiB | -38% |
| load-50 | Hook before each tool call (slowest 5%) | 85 ms | 77 ms | -10% |
| load-50 | Hook after each batch of tool calls (slowest 5%) | 119 ms | 93 ms | -22% |
| load-50 | Hook at session start (slowest) | 95 ms | 104 ms | +10% |
| load-50 | `squeal status` (slowest 5%) | 169 ms | 157 ms | -7% |
| load-50 | Edit that breaks a test until the agent is told (median) | 1174 ms | 1151 ms | -2% |
| load-50 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| load-50 | CPU with no edits: the busiest daemon, plus the store process | 0.6 % core | 0.2 % core | -63% |
| load-50 | CPU per edit: daemons with their test runs, plus the store process | 1.1 s | 1.0 s | -12% |
| load-50 | Daemon memory, peak | 397 MiB | 390 MiB | -2% |
| load-50 | Store process memory, peak | 144 MiB | 147 MiB | +2% |
| load-50 | Store writes that held the lock over 250 ms | 0 | 0 |  |
| load-50 | Logged lock holds, total | 0 s | 0 s |  |
| load-50 | `squeal impact` (reads every stored module list) | 0.3 s | 0.3 s | -18% |
| load-50 | `squeal impact` memory, peak | 164 MiB | 142 MiB | -14% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 6 of 8 cells: ref@0.1.616 88 ms ⚠️, size-l@0.1.615 90 ms ⚠️, size-l@0.1.616 132 ms ⚠️, wt-3@0.1.615 96 ms ⚠️, wt-3@0.1.616 97 ms ⚠️, load-50@0.1.615 85 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: ref@0.1.615 95 ms ⚠️, ref@0.1.616 112 ms ⚠️, size-l@0.1.615 257 ms ❌, size-l@0.1.616 272 ms ❌, wt-3@0.1.615 147 ms ⚠️, wt-3@0.1.616 159 ms ⚠️, load-50@0.1.615 119 ms ⚠️, load-50@0.1.616 93 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 2 of 8 cells: size-l@0.1.615 362 ms ⚠️, size-l@0.1.616 329 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 2 of 8 cells: size-l@0.1.615 381 ms ⚠️, size-l@0.1.616 346 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 6 of 8 cells: ref@0.1.615 1.32 x ⚠️, ref@0.1.616 1.33 x ⚠️, size-l@0.1.615 1.36 x ⚠️, size-l@0.1.616 1.32 x ⚠️, load-50@0.1.615 1.34 x ⚠️, load-50@0.1.616 1.36 x ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 3 of 8 cells: size-l@0.1.615 1.8 % core ⚠️, wt-3@0.1.615 3.6 % core ⚠️, wt-3@0.1.616 3.5 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 8 of 8 cells: ref@0.1.615 402 MiB ⚠️, ref@0.1.616 350 MiB ⚠️, size-l@0.1.615 611 MiB ❌, size-l@0.1.616 666 MiB ❌, wt-3@0.1.615 423 MiB ⚠️, wt-3@0.1.616 403 MiB ⚠️, load-50@0.1.615 397 MiB ⚠️, load-50@0.1.616 390 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 4 of 8 cells: size-l@0.1.615 14 ❌, size-l@0.1.616 14 ❌, wt-3@0.1.615 1 ⚠️, wt-3@0.1.616 1 ⚠️

## Every metric

| Metric | Healthy | Warn | ref@0.1.615 | ref@0.1.616 | size-l@0.1.615 | size-l@0.1.616 | wt-3@0.1.615 | wt-3@0.1.616 | load-50@0.1.615 | load-50@0.1.616 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 78 ms ✅ | 88 ms ⚠️ | 90 ms ⚠️ | 132 ms ⚠️ | 96 ms ⚠️ | 97 ms ⚠️ | 85 ms ⚠️ | 77 ms ✅ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 95 ms ⚠️ | 112 ms ⚠️ | 257 ms ❌ | 272 ms ❌ | 147 ms ⚠️ | 159 ms ⚠️ | 119 ms ⚠️ | 93 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 143 ms ✅ | 124 ms ✅ | 345 ms ✅ | 244 ms ✅ | 120 ms ✅ | 150 ms ✅ | 95 ms ✅ | 104 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 113 ms ✅ | 94 ms ✅ | 185 ms ✅ | 229 ms ✅ | 100 ms ✅ | 124 ms ✅ | 224 ms ✅ | 96 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 197 ms ✅ | 164 ms ✅ | 362 ms ⚠️ | 329 ms ⚠️ | 261 ms ✅ | 222 ms ✅ | 169 ms ✅ | 157 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 219 ms ✅ | 157 ms ✅ | 381 ms ⚠️ | 346 ms ⚠️ | 244 ms ✅ | 201 ms ✅ | 163 ms ✅ | 152 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 511 ms ✅ | 469 ms ✅ | 458 ms ✅ | 410 ms ✅ | 420 ms ✅ | 429 ms ✅ | 479 ms ✅ | 448 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a | 298 ms ✅ | 301 ms ✅ | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.32 x ⚠️ | 1.33 x ⚠️ | 1.36 x ⚠️ | 1.32 x ⚠️ | n/a | n/a | 1.34 x ⚠️ | 1.36 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 43 s | 43 s | 167 s | 163 s | 40 s | 42 s | 51 s | 49 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1152 ms ✅ | 1166 ms ✅ | 1356 ms ✅ | 1313 ms ✅ | 1181 ms ✅ | 1194 ms ✅ | 1174 ms ✅ | 1151 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1529 ms ✅ | 1556 ms ✅ | 2603 ms ✅ | 2476 ms ✅ | 1569 ms ✅ | 1525 ms ✅ | 1569 ms ✅ | 1578 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 5579 ms ✅ | 5563 ms ✅ | 7919 ms ✅ | 7425 ms ✅ | 5566 ms ✅ | 6644 ms ✅ | 6731 ms ✅ | 5577 ms ✅ |
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
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 39 s ✅ | 40 s ✅ | 159 s ✅ | 160 s ✅ | 110 s ✅ | 106 s ✅ | 59 s ✅ | 55 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.6 % core ✅ | 0.3 % core ✅ | 1.8 % core ⚠️ | 1.0 % core ✅ | 3.6 % core ⚠️ | 3.5 % core ⚠️ | 0.6 % core ✅ | 0.2 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 402 MiB ⚠️ | 350 MiB ⚠️ | 611 MiB ❌ | 666 MiB ❌ | 423 MiB ⚠️ | 403 MiB ⚠️ | 397 MiB ⚠️ | 390 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.1 s | 1.2 s | 2.7 s | 2.9 s | 0.3 s | 0.3 s | 1.1 s | 1.0 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.9 s | 0.9 s | 2.6 s | 2.6 s | 2.1 s | 2.0 s | 0.9 s | 0.8 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 153 MiB | 163 MiB | 268 MiB | 294 MiB | 210 MiB | 190 MiB | 144 MiB | 147 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 14 ❌ | 14 ❌ | 1 ⚠️ | 1 ⚠️ | 0 ✅ | 0 ✅ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 18 MiB | 19 MiB | 58 MiB | 58 MiB | 45 MiB | 39 MiB | 19 MiB | 19 MiB |
| Result rows in the store (`store.results`) | report |  | 8190 | 8190 | 28994 | 28994 | 17038 | 17038 | 8190 | 8190 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 2 ms | 0 ms | 1 ms | 1 ms | 155 ms | 529 ms | 0 ms | 1 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 5.9 s | 5.8 s | 11 s | 13 s | 12 s | 15 s | 7.0 s | 4.5 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.2 s | 0.6 s | 0.5 s | 0.3 s | 0.2 s | 0.3 s | 0.3 s |
| **Resources** | | |  |  |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 145 MiB | 145 MiB | 245 MiB | 232 MiB | 144 MiB | 90 MiB | 164 MiB | 142 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | n/a | 1389 ms | 1405 ms | 280 ms | 273 ms | n/a | n/a |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0 s | 5.8 s | 5.7 s | 0.3 s | 0.3 s | 0 s | 0 s |
