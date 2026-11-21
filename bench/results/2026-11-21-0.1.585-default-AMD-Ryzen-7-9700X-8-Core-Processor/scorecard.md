# Squeal performance scorecard

Squeal 0.1.585 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2552 MiB/s · 2026-11-21T12:52:17.506Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 77 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 75 | 96 | 79 | 67 | 67 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ff | 500 | 1 | 0% | 0 | ✅ | 75 | 75 | 100 | 75 | 50 | 75 |
| ff-known | 500 | 1 | 0% | 0 | ✅ | 79 | 75 | 88 | 81 | 75 | 75 |
| ff-ci | 500 | 1 | 0% | 0 | ✅ | 76 | 75 | 100 | 81 | 75 | 50 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ff 102 ms ⚠️, ff-known 122 ms ⚠️, ff-ci 110 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ff 187 ms ⚠️, ff-known 194 ms ⚠️, ff-ci 145 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 3 cells: ff-known 1.35 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 3 of 3 cells: ff late ❌, ff-known late ❌, ff-ci late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 3 of 3 cells: ff 94 % ⚠️, ff-known 94 % ⚠️, ff-ci 94 % ⚠️
- **Verdicts · Fast-forward: hook outputs after it that report its files as not run yet** (healthy ≤ 0): 1 of 3 cells: ff 1 ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 1 of 3 cells: ff 1.2 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 3 of 3 cells: ff 491 MiB ⚠️, ff-known 519 MiB ⚠️, ff-ci 472 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 3 of 3 cells: ff 3 ⚠️, ff-known 3 ⚠️, ff-ci 4 ❌

## Every metric

| Metric | Healthy | Warn | ff | ff-known | ff-ci |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 102 ms ⚠️ | 122 ms ⚠️ | 110 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 187 ms ⚠️ | 194 ms ⚠️ | 145 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 71 ms ✅ | 70 ms ✅ | 117 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 65 ms ✅ | 117 ms ✅ | 119 ms ✅ |
| **Commands** | | |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 175 ms ✅ | 214 ms ✅ | 242 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 174 ms ✅ | 210 ms ✅ | 229 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 587 ms ✅ | 480 ms ✅ | 628 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.29 x ✅ | 1.35 x ⚠️ | 1.26 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 37 s | 38 s | 46 s |
| **Verdicts** | | |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1151 ms ✅ | 1171 ms ✅ | 1238 ms ✅ |
| **Correctness** | | |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1476 ms ✅ | 1457 ms ✅ | 1616 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 94 % ⚠️ | 94 % ⚠️ | 94 % ⚠️ |
| **Correctness** | | |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 154 s ✅ | 168 s ✅ | 169 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | 350 | 0 | 0 |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | 0.6 s |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | 60 s ✅ | 9.2 s ✅ | 9.5 s ✅ |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | 1 ⚠️ | 0 ✅ | 0 ✅ |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | 1472 ms ✅ | 505 ms ✅ | 1617 ms ✅ |
| **Resources** | | |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.2 % core ⚠️ | 0.3 % core ✅ | 0.7 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 491 MiB ⚠️ | 519 MiB ⚠️ | 472 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.8 s | 1.0 s | 1.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.2 s | 1.6 s | 1.8 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 165 MiB | 153 MiB | 147 MiB |
| **Store** | | |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 3 ⚠️ | 3 ⚠️ | 4 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 24 MiB | 22 MiB |
| Result rows in the store (`store.results`) | report |  | 9800 | 9863 | 9863 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 0 ms | 1 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 5.4 s | 5.7 s | 5.4 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 |
| **Commands** | | |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 0.2 s | 0.3 s | 0.2 s |
| **Resources** | | |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 96 MiB | 114 MiB | 134 MiB |
| **Store** | | |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 355 ms | 367 ms | 326 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.9 s | 1.0 s | 1.2 s |
