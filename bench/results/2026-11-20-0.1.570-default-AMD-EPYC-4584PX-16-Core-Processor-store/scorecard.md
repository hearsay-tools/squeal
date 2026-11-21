# Squeal performance scorecard

Squeal 0.1.570 · Node v24.22.1 · AMD EPYC 4584PX 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2128 MiB/s · 2026-11-20T08:03:57.795Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 65 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 63 | 88 | 40 | 58 | 75 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 73 | 75 | 100 | 40 | 75 | 75 |
| store-1.7g | 500 | 1 | 0% | 70 | ✅ | 58 | 63 | 63 | 40 | 50 | 75 |
| store-7g | 500 | 1 | 0% | 326 | ✅ | 63 | 50 | 100 | 40 | 50 | 75 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 125 ms ⚠️, store-1.7g 157 ms ⚠️, store-7g 230 ms ❌
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 3 of 3 cells: ref 184 ms ⚠️, store-1.7g 232 ms ❌, store-7g 140 ms ⚠️
- **Hooks · Hook at session start (slowest)** (healthy ≤ 750 ms): 1 of 3 cells: store-7g 1079 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 1 of 3 cells: store-1.7g 337 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 3 cells: store-1.7g 329 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 3 cells: store-1.7g 1.34 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 3 of 3 cells: ref late ❌, store-1.7g late ❌, store-7g late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 3 of 3 cells: ref late ❌, store-1.7g late ❌, store-7g late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 3 of 3 cells: ref 50 % ❌, store-1.7g 50 % ❌, store-7g 50 % ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 3 cells: store-1.7g 2.5 % core ⚠️, store-7g 2.1 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 3 of 3 cells: ref 397 MiB ⚠️, store-1.7g 418 MiB ⚠️, store-7g 391 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 3 of 3 cells: ref 2 ⚠️, store-1.7g 3 ⚠️, store-7g 3 ⚠️

## Every metric

| Metric | Healthy | Warn | ref | store-1.7g | store-7g |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 125 ms ⚠️ | 157 ms ⚠️ | 230 ms ❌ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 184 ms ⚠️ | 232 ms ❌ | 140 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 91 ms ✅ | 100 ms ✅ | 1079 ms ⚠️ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 228 ms ✅ | 98 ms ✅ | 158 ms ✅ |
| **Commands** | | |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 219 ms ✅ | 337 ms ⚠️ | 268 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 247 ms ✅ | 329 ms ⚠️ | 193 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 426 ms ✅ | 412 ms ✅ | 430 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.26 x ✅ | 1.34 x ⚠️ | 1.27 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 53 s | 44 s | 39 s |
| **Verdicts** | | |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1222 ms ✅ | 1275 ms ✅ | 1196 ms ✅ |
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
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 164 s ✅ | 160 s ✅ | 166 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report late or queued results (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a |
| **Resources** | | |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.6 % core ✅ | 2.5 % core ⚠️ | 2.1 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 397 MiB ⚠️ | 418 MiB ⚠️ | 391 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.2 s | 1.3 s | 1.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | n/a | n/a |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | n/a | n/a |
| **Store** | | |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 3 ⚠️ | 3 ⚠️ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 1999 MiB | 9199 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 252616 | 1147720 |
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
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 348 ms | 468 ms | 1221 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.6 s | 1.2 s | 2.9 s |
