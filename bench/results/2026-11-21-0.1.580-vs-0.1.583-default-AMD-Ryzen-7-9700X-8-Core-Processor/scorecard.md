# Squeal performance scorecard

Squeal 0.1.580 vs 0.1.583 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2388 MiB/s · 2026-11-20T23:20:24.449Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 64 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 75 | 92 | 43 | 50 | 58 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.580 | 500 | 1 | 0% | 0 | ✅ | 61 | 75 | 88 | 40 | 50 | 50 |
| ref@0.1.583 | 500 | 1 | 0% | 0 | ✅ | 66 | 75 | 88 | 40 | 50 | 75 |
| wt-3@0.1.580 | 500 | 3 | 0% | 0 | ✅ | 67 | 75 | 100 | 60 | 50 | 50 |
| wt-3@0.1.583 | 500 | 3 | 0% | 0 | ✅ | 67 | 75 | 100 | 60 | 50 | 50 |
| load-50@0.1.580 | 500 | 1 | 50% | 0 | ✅ | 64 | 75 | 88 | 30 | 50 | 75 |
| load-50@0.1.583 | 500 | 1 | 50% | 0 | ✅ | 59 | 75 | 88 | 30 | 50 | 50 |

## 0.1.580 compared with 0.1.583 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.580 | 1 | ✅ | 61 |  |  |  |  |  |  |
| ref | 0.1.583 | 1 | ✅ | 66 | +5 | +0 | +0 | +0 | +0 | +25 |
| wt-3 | 0.1.580 | 1 | ✅ | 67 |  |  |  |  |  |  |
| wt-3 | 0.1.583 | 1 | ✅ | 67 | +0 | +0 | +0 | +0 | +0 | +0 |
| load-50 | 0.1.580 | 1 | ✅ | 64 |  |  |  |  |  |  |
| load-50 | 0.1.583 | 1 | ✅ | 59 | -5 | +0 | +0 | +0 | +0 | -25 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.580 | 0.1.583 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 90 ms | 111 ms | +23% |
| ref | Hook after each batch of tool calls (slowest 5%) | 191 ms | 157 ms | -18% |
| ref | Hook at session start (slowest) | 162 ms | 79 ms | -52% |
| ref | `squeal status` (slowest 5%) | 191 ms | 198 ms | +4% |
| ref | Edit that breaks a test until the agent is told (median) | 1239 ms | 1221 ms | -1% |
| ref | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 2.2 % core | 1.4 % core | -33% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 1.1 s | 1.2 s | +6% |
| ref | Daemon memory, peak | 543 MiB | 493 MiB | -9% |
| ref | Store process memory, peak | 163 MiB | 161 MiB | -1% |
| ref | Store writes that held the lock over 250 ms | 6 | 3 | -50% |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 527 ms | 272 ms | -48% |
| ref | Logged lock holds, total | 2.0 s | 0.8 s | -61% |
| ref | `squeal reach` (reads every stored module list) | 0.2 s | 0.2 s | -8% |
| ref | `squeal reach` memory, peak | 135 MiB | 85 MiB | -37% |
| wt-3 | Hook before each tool call (slowest 5%) | 155 ms | 97 ms | -38% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 175 ms | 138 ms | -21% |
| wt-3 | Hook at session start (slowest) | 127 ms | 112 ms | -12% |
| wt-3 | `squeal status` (slowest 5%) | 216 ms | 232 ms | +7% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1183 ms | 1193 ms | +1% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 5.0 % core | 3.5 % core | -30% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.4 s | 0.4 s | +13% |
| wt-3 | Daemon memory, peak | 495 MiB | 499 MiB | +1% |
| wt-3 | Store process memory, peak | 187 MiB | 188 MiB | +1% |
| wt-3 | Store writes that held the lock over 250 ms | 10 | 10 | +0% |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | 754 ms | 392 ms | -48% |
| wt-3 | Logged lock holds, total | 3.7 s | 3.1 s | -16% |
| wt-3 | `squeal reach` (reads every stored module list) | 0.2 s | 0.4 s | +57% |
| wt-3 | `squeal reach` memory, peak | 134 MiB | 132 MiB | -2% |
| load-50 | Hook before each tool call (slowest 5%) | 83 ms | 130 ms | +57% |
| load-50 | Hook after each batch of tool calls (slowest 5%) | 142 ms | 175 ms | +23% |
| load-50 | Hook at session start (slowest) | 127 ms | 74 ms | -41% |
| load-50 | `squeal status` (slowest 5%) | 164 ms | 181 ms | +10% |
| load-50 | Edit that breaks a test until the agent is told (median) | 1191 ms | 1171 ms | -2% |
| load-50 | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| load-50 | CPU with no edits: the busiest daemon, plus the store process | 1.1 % core | 1.7 % core | +58% |
| load-50 | CPU per edit: daemons with their test runs, plus the store process | 0.9 s | 1.1 s | +21% |
| load-50 | Daemon memory, peak | 494 MiB | 461 MiB | -7% |
| load-50 | Store process memory, peak | 149 MiB | 140 MiB | -6% |
| load-50 | Store writes that held the lock over 250 ms | 1 | 4 | +300% |
| load-50 | Longest logged lock hold (only holds over 250 ms are logged) | 363 ms | 459 ms | +26% |
| load-50 | Logged lock holds, total | 0.4 s | 1.6 s | +335% |
| load-50 | `squeal reach` (reads every stored module list) | 0.3 s | 0.3 s | -1% |
| load-50 | `squeal reach` memory, peak | 130 MiB | 127 MiB | -2% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 6 of 6 cells: ref@0.1.580 90 ms ⚠️, ref@0.1.583 111 ms ⚠️, wt-3@0.1.580 155 ms ⚠️, wt-3@0.1.583 97 ms ⚠️, load-50@0.1.580 83 ms ⚠️, load-50@0.1.583 130 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 6 of 6 cells: ref@0.1.580 191 ms ⚠️, ref@0.1.583 157 ms ⚠️, wt-3@0.1.580 175 ms ⚠️, wt-3@0.1.583 138 ms ⚠️, load-50@0.1.580 142 ms ⚠️, load-50@0.1.583 175 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 4 of 6 cells: ref@0.1.580 1.45 x ⚠️, ref@0.1.583 1.35 x ⚠️, load-50@0.1.580 1.36 x ⚠️, load-50@0.1.583 1.53 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 4 of 6 cells: ref@0.1.580 late ❌, ref@0.1.583 late ❌, load-50@0.1.580 late ❌, load-50@0.1.583 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 6 of 6 cells: ref@0.1.580 late ❌, ref@0.1.583 late ❌, wt-3@0.1.580 late ❌, wt-3@0.1.583 late ❌, load-50@0.1.580 late ❌, load-50@0.1.583 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 6 of 6 cells: ref@0.1.580 50 % ❌, ref@0.1.583 50 % ❌, wt-3@0.1.580 69 % ❌, wt-3@0.1.583 69 % ❌, load-50@0.1.580 50 % ❌, load-50@0.1.583 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 2 of 6 cells: load-50@0.1.580 216 s ⚠️, load-50@0.1.583 230 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 6 of 6 cells: ref@0.1.580 2.2 % core ⚠️, ref@0.1.583 1.4 % core ⚠️, wt-3@0.1.580 5.0 % core ⚠️, wt-3@0.1.583 3.5 % core ⚠️, load-50@0.1.580 1.1 % core ⚠️, load-50@0.1.583 1.7 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 6 of 6 cells: ref@0.1.580 543 MiB ⚠️, ref@0.1.583 493 MiB ⚠️, wt-3@0.1.580 495 MiB ⚠️, wt-3@0.1.583 499 MiB ⚠️, load-50@0.1.580 494 MiB ⚠️, load-50@0.1.583 461 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 6 of 6 cells: ref@0.1.580 6 ❌, ref@0.1.583 3 ⚠️, wt-3@0.1.580 10 ❌, wt-3@0.1.583 10 ❌, load-50@0.1.580 1 ⚠️, load-50@0.1.583 4 ❌

## Every metric

| Metric | Healthy | Warn | ref@0.1.580 | ref@0.1.583 | wt-3@0.1.580 | wt-3@0.1.583 | load-50@0.1.580 | load-50@0.1.583 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 90 ms ⚠️ | 111 ms ⚠️ | 155 ms ⚠️ | 97 ms ⚠️ | 83 ms ⚠️ | 130 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 191 ms ⚠️ | 157 ms ⚠️ | 175 ms ⚠️ | 138 ms ⚠️ | 142 ms ⚠️ | 175 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 162 ms ✅ | 79 ms ✅ | 127 ms ✅ | 112 ms ✅ | 127 ms ✅ | 74 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 84 ms ✅ | 83 ms ✅ | 100 ms ✅ | 148 ms ✅ | 106 ms ✅ | 114 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 191 ms ✅ | 198 ms ✅ | 216 ms ✅ | 232 ms ✅ | 164 ms ✅ | 181 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 188 ms ✅ | 189 ms ✅ | 194 ms ✅ | 176 ms ✅ | 161 ms ✅ | 194 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 568 ms ✅ | 395 ms ✅ | 614 ms ✅ | 518 ms ✅ | 510 ms ✅ | 442 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 383 ms ✅ | 279 ms ✅ | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.45 x ⚠️ | 1.35 x ⚠️ | n/a | n/a | 1.36 x ⚠️ | 1.53 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 45 s | 43 s | 48 s | 41 s | 50 s | 53 s |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1239 ms ✅ | 1221 ms ✅ | 1183 ms ✅ | 1193 ms ✅ | 1191 ms ✅ | 1171 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | 1579 ms ✅ | 1540 ms ✅ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 69 % ❌ | 69 % ❌ | 50 % ❌ | 50 % ❌ |
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
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 160 s ✅ | 159 s ✅ | 179 s ✅ | 168 s ✅ | 216 s ⚠️ | 230 s ⚠️ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 2.2 % core ⚠️ | 1.4 % core ⚠️ | 5.0 % core ⚠️ | 3.5 % core ⚠️ | 1.1 % core ⚠️ | 1.7 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 543 MiB ⚠️ | 493 MiB ⚠️ | 495 MiB ⚠️ | 499 MiB ⚠️ | 494 MiB ⚠️ | 461 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.1 s | 1.2 s | 0.4 s | 0.4 s | 0.9 s | 1.1 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.1 s | 1.2 s | 2.9 s | 3.6 s | 0.8 s | 1.0 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 163 MiB | 161 MiB | 187 MiB | 188 MiB | 149 MiB | 140 MiB |
| **Store** | | |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 6 ❌ | 3 ⚠️ | 10 ❌ | 10 ❌ | 1 ⚠️ | 4 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 21 MiB | 21 MiB | 35 MiB | 36 MiB | 18 MiB | 20 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 7728 | 15890 | 15890 | 7728 | 7728 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 1 ms | 0 ms | 205 ms | 112 ms | 0 ms | 1 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 6.2 s | 3.5 s | 11 s | 12 s | 4.3 s | 4.6 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 |
| **Commands** | | |  |  |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 0.2 s | 0.2 s | 0.2 s | 0.4 s | 0.3 s | 0.3 s |
| **Resources** | | |  |  |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 135 MiB | 85 MiB | 134 MiB | 132 MiB | 130 MiB | 127 MiB |
| **Store** | | |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 527 ms | 272 ms | 754 ms | 392 ms | 363 ms | 459 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 2.0 s | 0.8 s | 3.7 s | 3.1 s | 0.4 s | 1.6 s |
