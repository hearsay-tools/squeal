# Squeal performance scorecard

Squeal 0.1.576 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2345 MiB/s · 2026-11-20T11:56:39.262Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 64 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 71 | 88 | 43 | 50 | 67 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 68 | 75 | 100 | 40 | 50 | 75 |
| wt-3 | 500 | 3 | 0% | 0 | ✅ | 60 | 63 | 75 | 60 | 50 | 50 |
| load-50 | 500 | 1 | 50% | 0 | ✅ | 64 | 75 | 88 | 30 | 50 | 75 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 100 ms ⚠️, wt-3 198 ms ⚠️, load-50 128 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 107 ms ⚠️, wt-3 300 ms ❌, load-50 199 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 1 of 3 cells: wt-3 392 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 3 cells: wt-3 372 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 3 cells: load-50 1.52 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 2 of 3 cells: ref late ❌, load-50 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 3 of 3 cells: ref late ❌, wt-3 late ❌, load-50 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 3 of 3 cells: ref 50 % ❌, wt-3 69 % ❌, load-50 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 1 of 3 cells: load-50 231 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 3 of 3 cells: ref 1.3 % core ⚠️, wt-3 4.9 % core ⚠️, load-50 1.3 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 3 of 3 cells: ref 484 MiB ⚠️, wt-3 477 MiB ⚠️, load-50 455 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 3 of 3 cells: ref 2 ⚠️, wt-3 7 ❌, load-50 3 ⚠️

## Every metric

| Metric | Healthy | Warn | ref | wt-3 | load-50 |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 100 ms ⚠️ | 198 ms ⚠️ | 128 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 107 ms ⚠️ | 300 ms ❌ | 199 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 117 ms ✅ | 178 ms ✅ | 129 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 191 ms ✅ | 116 ms ✅ | 130 ms ✅ |
| **Commands** | | |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 173 ms ✅ | 392 ms ⚠️ | 181 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 184 ms ✅ | 372 ms ⚠️ | 207 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 269 ms ✅ | 473 ms ✅ | 429 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | 439 ms ✅ | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.28 x ✅ | n/a | 1.52 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 43 s | 61 s | 60 s |
| **Verdicts** | | |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1182 ms ✅ | 1318 ms ✅ | 1232 ms ✅ |
| **Correctness** | | |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | 1844 ms ✅ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 69 % ❌ | 50 % ❌ |
| **Correctness** | | |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | n/a | n/a | n/a |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 165 s ✅ | 163 s ✅ | 231 s ⚠️ |
| **Resources** | | |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.3 % core ⚠️ | 4.9 % core ⚠️ | 1.3 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 484 MiB ⚠️ | 477 MiB ⚠️ | 455 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.2 s | 0.5 s | 1.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | n/a | n/a |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 7 ❌ | 3 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 21 MiB | 36 MiB | 20 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 15890 | 7728 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | n/a | n/a | n/a |
| Store process: time spent writing (`store.process.busy`) | report |  | n/a | n/a | n/a |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | n/a | n/a | n/a |
| Store process: times it stopped (`store.process.stops`) | report |  | n/a | n/a | n/a |
| **Commands** | | |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | n/a | n/a | n/a |
| **Resources** | | |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 276 ms | 759 ms | 336 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.5 s | 3.1 s | 0.9 s |
