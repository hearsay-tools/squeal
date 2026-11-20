# Squeal performance scorecard

Squeal 0.1.570 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 1972 MiB/s · 2026-11-20T09:15:33.842Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 64 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 54 | 96 | 33 | 58 | 81 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 76 | 63 | 100 | 40 | 75 | 100 |
| store-7g | 500 | 1 | 0% | 326 | ✅ | 56 | 38 | 88 | 30 | 50 | 75 |
| churn | 500 | 1 | 0% | 326 churn | ✅ | 62 | 63 | 100 | 30 | 50 | 67 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 152 ms ⚠️, store-7g 212 ms ❌, churn 127 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 202 ms ❌, store-7g 259 ms ❌, churn 199 ms ⚠️
- **Hooks · Hook at session start (slowest)** (healthy ≤ 750 ms): 2 of 3 cells: store-7g 1133 ms ⚠️, churn 1087 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 3 cells: store-7g 1.30 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 3 of 3 cells: ref late ❌, store-7g late ❌, churn late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 3 of 3 cells: ref late ❌, store-7g late ❌, churn late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 3 of 3 cells: ref 50 % ❌, store-7g 50 % ❌, churn 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 2 of 3 cells: store-7g 192 s ⚠️, churn 181 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 3 cells: store-7g 2.3 % core ⚠️, churn 2.8 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 3 of 3 cells: ref 444 MiB ⚠️, store-7g 420 MiB ⚠️, churn 388 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 2 of 3 cells: store-7g 3 ⚠️, churn 6 ❌

## Every metric

| Metric | Healthy | Warn | ref | store-7g | churn |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 152 ms ⚠️ | 212 ms ❌ | 127 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 202 ms ❌ | 259 ms ❌ | 199 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 95 ms ✅ | 1133 ms ⚠️ | 1087 ms ⚠️ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 94 ms ✅ | 165 ms ✅ | 125 ms ✅ |
| **Commands** | | |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 244 ms ✅ | 238 ms ✅ | 242 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 244 ms ✅ | 266 ms ✅ | 257 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 278 ms ✅ | 443 ms ✅ | 578 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.18 x ✅ | 1.30 x ⚠️ | 1.20 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 43 s | 42 s | 56 s |
| **Verdicts** | | |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1284 ms ✅ | 1275 ms ✅ | 1214 ms ✅ |
| **Correctness** | | |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 50 % ❌ |
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
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 159 s ✅ | 192 s ⚠️ | 181 s ⚠️ |
| **Resources** | | |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.4 % core ✅ | 2.3 % core ⚠️ | 2.8 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 444 MiB ⚠️ | 420 MiB ⚠️ | 388 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.2 s | 1.6 s | 3.8 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | n/a | n/a |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 3 ⚠️ | 6 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 9202 MiB | 8120 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 1148280 | 1002120 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | 1.4 min ✅ |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | 20 s |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | 77 s |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | n/a | n/a | n/a |
| Store process: time spent writing (`store.process.busy`) | report |  | n/a | n/a | n/a |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | n/a | n/a | n/a |
| Store process: times it stopped (`store.process.stops`) | report |  | n/a | n/a | n/a |
| **Commands** | | |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | n/a | n/a | n/a |
| **Resources** | | |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | 1443 ms | 2680 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 3.2 s | 4.9 s |
