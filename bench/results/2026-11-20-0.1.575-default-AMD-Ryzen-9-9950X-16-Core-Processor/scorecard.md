# Squeal performance scorecard

Squeal 0.1.575 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2488 MiB/s · 2026-11-20T11:56:27.043Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 68 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 67 | 96 | 43 | 58 | 75 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 78 | 75 | 100 | 40 | 75 | 100 |
| wt-3 | 500 | 3 | 0% | 0 | ✅ | 70 | 63 | 100 | 60 | 50 | 75 |
| load-50 | 500 | 1 | 50% | 0 | ✅ | 56 | 63 | 88 | 30 | 50 | 50 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 87 ms ⚠️, wt-3 180 ms ⚠️, load-50 159 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 113 ms ⚠️, wt-3 249 ms ❌, load-50 304 ms ❌
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 3 cells: load-50 1.81 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 2 of 3 cells: ref late ❌, load-50 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 3 of 3 cells: ref late ❌, wt-3 late ❌, load-50 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 3 of 3 cells: ref 50 % ❌, wt-3 69 % ❌, load-50 50 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 1 of 3 cells: load-50 234 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 3 cells: wt-3 2.5 % core ⚠️, load-50 2.4 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 3 of 3 cells: ref 537 MiB ⚠️, wt-3 514 MiB ⚠️, load-50 525 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 2 of 3 cells: wt-3 3 ⚠️, load-50 4 ❌

## Every metric

| Metric | Healthy | Warn | ref | wt-3 | load-50 |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 87 ms ⚠️ | 180 ms ⚠️ | 159 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 113 ms ⚠️ | 249 ms ❌ | 304 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 82 ms ✅ | 78 ms ✅ | 195 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 98 ms ✅ | 171 ms ✅ | 171 ms ✅ |
| **Commands** | | |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 156 ms ✅ | 255 ms ✅ | 291 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 151 ms ✅ | 280 ms ✅ | 284 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 206 ms ✅ | 267 ms ✅ | 365 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | 273 ms ✅ | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.29 x ✅ | n/a | 1.81 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 39 s | 37 s | 82 s |
| **Verdicts** | | |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1178 ms ✅ | 1168 ms ✅ | 1335 ms ✅ |
| **Correctness** | | |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | 1666 ms ✅ | late ❌ |
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
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 156 s ✅ | 177 s ✅ | 234 s ⚠️ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a |
| **Resources** | | |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.8 % core ✅ | 2.5 % core ⚠️ | 2.4 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 537 MiB ⚠️ | 514 MiB ⚠️ | 525 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.9 s | 0.5 s | 1.5 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | n/a | n/a |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 3 ⚠️ | 4 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 36 MiB | 20 MiB |
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
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | 304 ms | 431 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0.9 s | 1.3 s |
