# Squeal performance scorecard

Squeal 0.1.584 · Node v24.22.1 · AMD EPYC 4585PX 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2452 MiB/s · 2026-11-21T09:53:55.023Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 71 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 69 | 78 | 69 | 63 | 75 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ff | 500 | 1 | 0% | 0 | ✅ | 75 | 63 | 88 | 75 | 75 | 75 |
| ff-known | 500 | 1 | 0% | 0 | ✅ | 79 | 75 | 88 | 81 | 75 | 75 |
| ff-load50 | 500 | 1 | 50% | 0 | ✅ | 54 | 63 | 63 | 44 | 50 | 50 |
| ff-rebase | 500 | 1 | 0% | 0 | ✅ | 75 | 75 | 75 | 75 | 50 | 100 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: ff 117 ms ⚠️, ff-known 111 ms ⚠️, ff-load50 146 ms ⚠️, ff-rebase 142 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: ff 298 ms ❌, ff-known 194 ms ⚠️, ff-load50 281 ms ❌, ff-rebase 172 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 1 of 4 cells: ff-load50 388 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 2 of 4 cells: ff-load50 333 ms ⚠️, ff-rebase 306 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 4 of 4 cells: ff 1.32 x ⚠️, ff-known 1.57 x ⚠️, ff-load50 1.47 x ⚠️, ff-rebase 1.47 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 4 of 4 cells: ff late ❌, ff-known late ❌, ff-load50 late ❌, ff-rebase late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 4 of 4 cells: ff 94 % ⚠️, ff-known 94 % ⚠️, ff-load50 78 % ❌, ff-rebase 94 % ⚠️
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 1 of 4 cells: ff-load50 238 s ⚠️
- **Verdicts · Fast-forward: until no test file waits (polled before each later step)** (healthy ≤ 120 s): 1 of 4 cells: ff-load50 late ❌
- **Verdicts · Fast-forward: hook outputs after it that report its files as not run yet** (healthy ≤ 0): 3 of 4 cells: ff 1 ⚠️, ff-load50 9 ❌, ff-rebase 1 ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 4 cells: ff-load50 2.5 % core ⚠️, ff-rebase 1.7 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 4 of 4 cells: ff 511 MiB ⚠️, ff-known 509 MiB ⚠️, ff-load50 507 MiB ⚠️, ff-rebase 527 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 3 of 4 cells: ff 2 ⚠️, ff-known 3 ⚠️, ff-load50 6 ❌

## Every metric

| Metric | Healthy | Warn | ff | ff-known | ff-load50 | ff-rebase |
|---|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 117 ms ⚠️ | 111 ms ⚠️ | 146 ms ⚠️ | 142 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 298 ms ❌ | 194 ms ⚠️ | 281 ms ❌ | 172 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 80 ms ✅ | 84 ms ✅ | 188 ms ✅ | 108 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 153 ms ✅ | 136 ms ✅ | 154 ms ✅ | 133 ms ✅ |
| **Commands** | | |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 234 ms ✅ | 207 ms ✅ | 388 ms ⚠️ | 270 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 200 ms ✅ | 179 ms ✅ | 333 ms ⚠️ | 306 ms ⚠️ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 273 ms ✅ | 600 ms ✅ | 471 ms ✅ | 270 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.32 x ⚠️ | 1.57 x ⚠️ | 1.47 x ⚠️ | 1.47 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 39 s | 55 s | 70 s | 49 s |
| **Verdicts** | | |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1168 ms ✅ | 1181 ms ✅ | 1305 ms ✅ | 1204 ms ✅ |
| **Correctness** | | |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1553 ms ✅ | 1520 ms ✅ | 1765 ms ✅ | 1609 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 94 % ⚠️ | 94 % ⚠️ | 78 % ❌ | 94 % ⚠️ |
| **Correctness** | | |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 164 s ✅ | 166 s ✅ | 238 s ⚠️ | 162 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | 350 | 0 | 350 | 350 |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | 60 s ✅ | 9.4 s ✅ | late ❌ | 66 s ✅ |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | 1 ⚠️ | 0 ✅ | 9 ❌ | 1 ⚠️ |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | 1549 ms ✅ | 1543 ms ✅ | 1689 ms ✅ | 1645 ms ✅ |
| **Resources** | | |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.0 % core ✅ | 0.6 % core ✅ | 2.5 % core ⚠️ | 1.7 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 511 MiB ⚠️ | 509 MiB ⚠️ | 507 MiB ⚠️ | 527 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.2 s | 1.0 s | 1.5 s | 1.3 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.8 s | 1.5 s | 1.9 s | 2.0 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 146 MiB | 153 MiB | 154 MiB | 145 MiB |
| **Store** | | |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 3 ⚠️ | 6 ❌ | 0 ✅ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 24 MiB | 22 MiB | 20 MiB |
| Result rows in the store (`store.results`) | report |  | 9800 | 9863 | 9247 | 9807 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 2 ms | 3 ms | 0 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 1.7 s | 3.7 s | 3.7 s | 2.4 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 | 0 |
| **Commands** | | |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 0.3 s | 0.3 s | 0.3 s | 0.4 s |
| **Resources** | | |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 116 MiB | 119 MiB | 147 MiB | 131 MiB |
| **Store** | | |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 287 ms | 388 ms | 417 ms | n/a |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.5 s | 1.0 s | 1.9 s | 0 s |
