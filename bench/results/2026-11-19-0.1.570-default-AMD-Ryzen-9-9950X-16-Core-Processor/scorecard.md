# Squeal performance scorecard

Squeal 0.1.570 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2487 MiB/s · 2026-11-19T20:23:01.205Z

**Correctness: FAILED** in stress (hook.overTimeout 8)

**Overall score: 56 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 56 | 73 | 35 | 56 | 59 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 66 | 63 | 75 | 40 | 75 | 75 |
| size-s | 100 | 1 | 0% | 0 | ✅ | 87 | 75 | 88 | 70 | 100 | 100 |
| size-l | 2000 | 1 | 0% | 0 | ✅ | 46 | 50 | 75 | 30 | 25 | 50 |
| wt-3 | 500 | 3 | 0% | 0 | ✅ | 63 | 63 | 100 | 50 | 50 | 50 |
| wt-6 | 500 | 6 | 0% | 0 | ✅ | 48 | 50 | 75 | 40 | 25 | 50 |
| load-50 | 500 | 1 | 50% | 0 | ✅ | 54 | 50 | 75 | 20 | 75 | 50 |
| load-100 | 500 | 1 | 100% | 0 | ✅ | 42 | 50 | 50 | 10 | 50 | 50 |
| stress | 500 | 6 | 100% | 0 | ❌ | 44 | 50 | 50 | 20 | 50 | 50 |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: ref 193 ms ⚠️, size-s 90 ms ⚠️, size-l 243 ms ❌, wt-3 177 ms ⚠️, wt-6 253 ms ❌, load-50 467 ms ❌, load-100 651 ms ❌, stress 788 ms ❌
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: ref 211 ms ❌, size-s 101 ms ⚠️, size-l 486 ms ❌, wt-3 256 ms ❌, wt-6 402 ms ❌, load-50 699 ms ❌, load-100 657 ms ❌, stress 1219 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 5 of 8 cells: size-l 348 ms ⚠️, wt-6 605 ms ⚠️, load-50 756 ms ⚠️, load-100 697 ms ⚠️, stress 1736 ms ❌
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 6 of 8 cells: ref 304 ms ⚠️, size-l 356 ms ⚠️, wt-6 570 ms ⚠️, load-50 665 ms ⚠️, load-100 684 ms ⚠️, stress 1538 ms ❌
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 3 of 8 cells: ref 1.31 x ⚠️, size-s 1.36 x ⚠️, load-100 3.61 x ❌
- **Verdicts · Edit that breaks a test until the agent is told (median)** (healthy ≤ 3000 ms): 3 of 8 cells: load-50 3054 ms ⚠️, load-100 5384 ms ⚠️, stress 7243 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 5 of 8 cells: ref late ❌, size-l late ❌, load-50 late ❌, load-100 late ❌, stress 6591 ms ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 8 of 8 cells: ref late ❌, size-s late ❌, size-l late ❌, wt-3 late ❌, wt-6 late ❌, load-50 late ❌, load-100 late ❌, stress late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 8 of 8 cells: ref 50 % ❌, size-s 94 % ⚠️, size-l 72 % ❌, wt-3 69 % ❌, wt-6 71 % ❌, load-50 50 % ❌, load-100 50 % ❌, stress 72 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 6 of 8 cells: size-l 290 s ⚠️, wt-3 188 s ⚠️, wt-6 late ❌, load-50 267 s ⚠️, load-100 late ❌, stress late ❌
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 5 of 8 cells: size-l 1.1 % core ⚠️, wt-3 3.1 % core ⚠️, wt-6 5.5 % core ❌, load-100 2.6 % core ⚠️, stress 4.8 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 7 of 8 cells: ref 391 MiB ⚠️, size-l 709 MiB ❌, wt-3 407 MiB ⚠️, wt-6 425 MiB ⚠️, load-50 447 MiB ⚠️, load-100 349 MiB ⚠️, stress 410 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 7 of 8 cells: ref 2 ⚠️, size-l 14 ❌, wt-3 13 ❌, wt-6 24 ❌, load-50 5 ❌, load-100 9 ❌, stress 49 ❌

## Every metric

| Metric | Healthy | Warn | ref | size-s | size-l | wt-3 | wt-6 | load-50 | load-100 | stress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 193 ms ⚠️ | 90 ms ⚠️ | 243 ms ❌ | 177 ms ⚠️ | 253 ms ❌ | 467 ms ❌ | 651 ms ❌ | 788 ms ❌ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 211 ms ❌ | 101 ms ⚠️ | 486 ms ❌ | 256 ms ❌ | 402 ms ❌ | 699 ms ❌ | 657 ms ❌ | 1219 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 77 ms ✅ | 87 ms ✅ | 181 ms ✅ | 108 ms ✅ | 281 ms ✅ | 491 ms ✅ | 262 ms ✅ | 448 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 123 ms ✅ | 104 ms ✅ | 265 ms ✅ | 324 ms ✅ | 907 ms ✅ | 185 ms ✅ | 1073 ms ✅ | 337 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 276 ms ✅ | 184 ms ✅ | 348 ms ⚠️ | 281 ms ✅ | 605 ms ⚠️ | 756 ms ⚠️ | 697 ms ⚠️ | 1736 ms ❌ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 304 ms ⚠️ | 193 ms ✅ | 356 ms ⚠️ | 252 ms ✅ | 570 ms ⚠️ | 665 ms ⚠️ | 684 ms ⚠️ | 1538 ms ❌ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 258 ms ✅ | 451 ms ✅ | 257 ms ✅ | 305 ms ✅ | 432 ms ✅ | 287 ms ✅ | 920 ms ✅ | 997 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | 404 ms ✅ | 1135 ms ✅ | n/a | n/a | 1852 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.31 x ⚠️ | 1.36 x ⚠️ | 1.29 x ✅ | n/a | n/a | 1.16 x ✅ | 3.61 x ❌ | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 38 s | 12 s | 168 s | 38 s | 75 s | 60 s | 295 s | 329 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1284 ms ✅ | 1181 ms ✅ | 2201 ms ✅ | 1181 ms ✅ | 1287 ms ✅ | 3054 ms ⚠️ | 5384 ms ⚠️ | 7243 ms ⚠️ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | 531 ms ✅ | late ❌ | 1661 ms ✅ | 1978 ms ✅ | late ❌ | late ❌ | 6591 ms ⚠️ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 94 % ⚠️ | 72 % ❌ | 69 % ❌ | 71 % ❌ | 50 % ❌ | 50 % ❌ | 72 % ❌ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 8 ❌ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 175 s ✅ | 130 s ✅ | 290 s ⚠️ | 188 s ⚠️ | late ❌ | 267 s ⚠️ | late ❌ | late ❌ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.4 % core ✅ | 0.4 % core ✅ | 1.1 % core ⚠️ | 3.1 % core ⚠️ | 5.5 % core ❌ | 0.8 % core ✅ | 2.6 % core ⚠️ | 4.8 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 391 MiB ⚠️ | 216 MiB ✅ | 709 MiB ❌ | 407 MiB ⚠️ | 425 MiB ⚠️ | 447 MiB ⚠️ | 349 MiB ⚠️ | 410 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 1.5 s | 0.4 s | 3.1 s | 0.6 s | 1.1 s | 4.8 s | 2.4 s | 1.6 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Store** | | |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 2 ⚠️ | 0 ✅ | 14 ❌ | 13 ❌ | 24 ❌ | 5 ❌ | 9 ❌ | 49 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 7.0 MiB | 62 MiB | 36 MiB | 59 MiB | 21 MiB | 17 MiB | 45 MiB |
| Result rows in the store (`store.results`) | report |  | 7728 | 1722 | 28672 | 15890 | 26264 | 7728 | 5012 | 9086 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: time spent writing (`store.process.busy`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: times it stopped (`store.process.stops`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Store** | | |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 320 ms | n/a | 560 ms | 855 ms | 1147 ms | 525 ms | 1074 ms | 1575 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 0.6 s | 0 s | 4.4 s | 4.8 s | 12 s | 2.0 s | 4.2 s | 25 s |
