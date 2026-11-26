# Squeal performance scorecard

Squeal 0.1.600 vs 0.1.636 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2611 MiB/s · 2026-11-26T09:17:50.966Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 97 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 100 | 100 | 100 | 83 | 100 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.600 | 500 | 1 | 0% | 0 | ✅ | 97 | 100 | 100 | 100 | 83 | 100 |
| ref@0.1.636 | 500 | 1 | 0% | 0 | ✅ | 97 | 100 | 100 | 100 | 83 | 100 |

## 0.1.600 compared with 0.1.636 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.600 | 1 | ✅ | 97 |  |  |  |  |  |  |
| ref | 0.1.636 | 1 | ✅ | 97 | +0 | +0 | +0 | +0 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.600 | 0.1.636 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 41 ms | 40 ms | -2% |
| ref | Hook after each batch of tool calls (slowest 5%) | 41 ms | 47 ms | +14% |
| ref | Hook before each tool call (slowest 1%) | 41 ms | 40 ms | -2% |
| ref | Hook after each batch of tool calls (slowest 1%) | 41 ms | 47 ms | +14% |
| ref | Hook write wait for the daemon main thread (longest) | n/a | 12 ms |  |
| ref | Hook writes that waited over 250 ms for the daemon main thread | n/a | 0 |  |
| ref | Hook at session start (slowest) | 77 ms | 94 ms | +22% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.3 % core | 0.3 % core | +6% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 3.2 s | 3.8 s | +19% |
| ref | Daemon memory, peak | 391 MiB | 373 MiB | -5% |
| ref | Daemon with its test runs, memory per worktree, peak | 978 MiB | 1061 MiB | +9% |
| ref | Store process memory, peak | 147 MiB | 148 MiB | +0% |
| ref | Store writes that held the lock over 250 ms | 0 | 0 |  |
| ref | Logged lock holds, total | 0 s | 0 s |  |
| ref | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | +46% |
| ref | `squeal impact` memory, peak | 88 MiB | 154 MiB | +75% |

## What is not healthy

- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 2 of 2 cells: ref@0.1.600 391 MiB ⚠️, ref@0.1.636 373 MiB ⚠️

## Before the idle minute

Every cell's baselines and store process settled before its idle minute.

## Every metric

| Metric | Healthy | Warn | ref@0.1.600 | ref@0.1.636 |
|---|---:|---:|---:|---:|
| **Hooks** | | |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 41 ms ✅ | 40 ms ✅ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 41 ms ✅ | 47 ms ✅ |
| Hook before each tool call (slowest 1%) (`hook.preToolUse.p99`) | report |  | 41 ms | 40 ms |
| Hook before each tool call (slowest) (`hook.preToolUse.max`) | report |  | 41 ms | 40 ms |
| Hook after each batch of tool calls (slowest 1%) (`hook.postToolBatch.p99`) | report |  | 41 ms | 47 ms |
| Hook after each batch of tool calls (slowest) (`hook.postToolBatch.max`) | report |  | 41 ms | 47 ms |
| Hook write wait for the daemon main thread (highest per-minute p95) (`hook.writeWait.p95`) | report |  | n/a | 12 ms |
| Hook write wait for the daemon main thread (longest) (`hook.writeWait.max`) | report |  | n/a | 12 ms |
| Hook writes that waited over 250 ms for the daemon main thread (`hook.longWriteWaits`) | report |  | n/a | 0 |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 77 ms ✅ | 94 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 75 ms ✅ | 100 ms ✅ |
| **Commands** | | |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | n/a | n/a |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | n/a | n/a |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 194 ms ✅ | 284 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.20 x ✅ | 1.24 x ✅ |
| Full run with Squeal (`cmd.runAll`) | report |  | 35 s | 35 s |
| **Verdicts** | | |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a |
| **Correctness** | | |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | n/a | n/a |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | n/a | n/a |
| **Correctness** | | |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 34 s ✅ | 36 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a |
| **Resources** | | |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.3 % core ✅ | 0.3 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 391 MiB ⚠️ | 373 MiB ⚠️ |
| Daemon with its test runs, memory per worktree, peak (`res.treeRss.max`) | ≤ 1200 | ≤ 2400 | 978 MiB ✅ | 1061 MiB ✅ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 3.2 s | 3.8 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.2 s | 0.2 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 147 MiB | 148 MiB |
| **Store** | | |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 18 MiB | 18 MiB |
| Result rows in the store (`store.results`) | report |  | 7000 | 7000 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 0 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 0.6 s | 0.6 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 |
| **Commands** | | |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.2 s |
| **Resources** | | |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 88 MiB | 154 MiB |
| **Store** | | |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | n/a | n/a |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0 s | 0 s |
