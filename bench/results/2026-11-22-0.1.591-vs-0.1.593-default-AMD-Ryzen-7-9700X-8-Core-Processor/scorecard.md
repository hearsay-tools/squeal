# Squeal performance scorecard

Squeal 0.1.591 vs 0.1.593 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2440 MiB/s · 2026-11-21T22:55:52.584Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 55 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 50 | 84 | 40 | 50 | 50 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| store-7g@0.1.591 | 500 | 1 | 0% | 326 | ✅ | 54 | 50 | 88 | 30 | 50 | 50 |
| store-7g@0.1.593 | 500 | 1 | 0% | 326 | ✅ | 54 | 50 | 88 | 30 | 50 | 50 |
| store-7g-wt3@0.1.591 | 500 | 3 | 0% | 326 | ✅ | 58 | 50 | 88 | 50 | 50 | 50 |
| store-7g-wt3@0.1.593 | 500 | 3 | 0% | 326 | ✅ | 55 | 50 | 75 | 50 | 50 | 50 |

## 0.1.591 compared with 0.1.593 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| store-7g | 0.1.591 | 1 | ✅ | 54 |  |  |  |  |  |  |
| store-7g | 0.1.593 | 1 | ✅ | 54 | +0 | +0 | +0 | +0 | +0 | +0 |
| store-7g-wt3 | 0.1.591 | 1 | ✅ | 58 |  |  |  |  |  |  |
| store-7g-wt3 | 0.1.593 | 1 | ✅ | 55 | -3 | +0 | -13 | +0 | +0 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.591 | 0.1.593 | Δ% |
|---|---|---:|---:|---:|
| store-7g | Hook before each tool call (slowest 5%) | 701 ms | 235 ms | -67% |
| store-7g | Hook after each batch of tool calls (slowest 5%) | 881 ms | 255 ms | -71% |
| store-7g | Hook at session start (slowest) | 211 ms | 100 ms | -53% |
| store-7g | `squeal status` (slowest 5%) | 242 ms | 212 ms | -13% |
| store-7g | Edit that breaks a test until the agent is told (median) | 1499 ms | 1268 ms | -15% |
| store-7g | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| store-7g | CPU with no edits: the busiest daemon, plus the store process | 1.6 % core | 2.0 % core | +20% |
| store-7g | CPU per edit: daemons with their test runs, plus the store process | 21 s | 19 s | -9% |
| store-7g | Daemon memory, peak | 502 MiB | 506 MiB | +1% |
| store-7g | Store process memory, peak | 149 MiB | 162 MiB | +9% |
| store-7g | Store writes that held the lock over 250 ms | 601 | 38 | -94% |
| store-7g | Longest logged lock hold (only holds over 250 ms are logged) | 2108 ms | 1649 ms | -22% |
| store-7g | Logged lock holds, total | 371 s | 18 s | -95% |
| store-7g | `squeal reach` (reads every stored module list) | 0.3 s | 0.3 s | +9% |
| store-7g | `squeal reach` memory, peak | 104 MiB | 122 MiB | +18% |
| store-7g-wt3 | Hook before each tool call (slowest 5%) | 1081 ms | 254 ms | -77% |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 5%) | 1118 ms | 393 ms | -65% |
| store-7g-wt3 | Hook at session start (slowest) | 203 ms | 140 ms | -31% |
| store-7g-wt3 | `squeal status` (slowest 5%) | 326 ms | 397 ms | +22% |
| store-7g-wt3 | Edit that breaks a test until the agent is told (median) | 1932 ms | 1517 ms | -21% |
| store-7g-wt3 | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| store-7g-wt3 | CPU with no edits: the busiest daemon, plus the store process | 3.8 % core | 3.4 % core | -10% |
| store-7g-wt3 | CPU per edit: daemons with their test runs, plus the store process | 7.5 s | 6.2 s | -17% |
| store-7g-wt3 | Daemon memory, peak | 502 MiB | 540 MiB | +8% |
| store-7g-wt3 | Store process memory, peak | 179 MiB | 161 MiB | -10% |
| store-7g-wt3 | Store writes that held the lock over 250 ms | 517 | 60 | -88% |
| store-7g-wt3 | Longest logged lock hold (only holds over 250 ms are logged) | 4156 ms | 1754 ms | -58% |
| store-7g-wt3 | Logged lock holds, total | 417 s | 29 s | -93% |
| store-7g-wt3 | `squeal reach` (reads every stored module list) | 0.3 s | 0.3 s | -6% |
| store-7g-wt3 | `squeal reach` memory, peak | 101 MiB | 105 MiB | +5% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: store-7g@0.1.591 701 ms ❌, store-7g@0.1.593 235 ms ❌, store-7g-wt3@0.1.591 1081 ms ❌, store-7g-wt3@0.1.593 254 ms ❌
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: store-7g@0.1.591 881 ms ❌, store-7g@0.1.593 255 ms ❌, store-7g-wt3@0.1.591 1118 ms ❌, store-7g-wt3@0.1.593 393 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 2 of 4 cells: store-7g-wt3@0.1.591 326 ms ⚠️, store-7g-wt3@0.1.593 397 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 1 of 4 cells: store-7g-wt3@0.1.593 340 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 2 of 4 cells: store-7g@0.1.591 1.34 x ⚠️, store-7g@0.1.593 1.45 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 2 of 4 cells: store-7g@0.1.591 late ❌, store-7g@0.1.593 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 4 of 4 cells: store-7g@0.1.591 late ❌, store-7g@0.1.593 late ❌, store-7g-wt3@0.1.591 late ❌, store-7g-wt3@0.1.593 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 4 of 4 cells: store-7g@0.1.591 50 % ❌, store-7g@0.1.593 50 % ❌, store-7g-wt3@0.1.591 69 % ❌, store-7g-wt3@0.1.593 69 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 4 of 4 cells: store-7g@0.1.591 189 s ⚠️, store-7g@0.1.593 203 s ⚠️, store-7g-wt3@0.1.591 232 s ⚠️, store-7g-wt3@0.1.593 212 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 4 of 4 cells: store-7g@0.1.591 1.6 % core ⚠️, store-7g@0.1.593 2.0 % core ⚠️, store-7g-wt3@0.1.591 3.8 % core ⚠️, store-7g-wt3@0.1.593 3.4 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 4 of 4 cells: store-7g@0.1.591 502 MiB ⚠️, store-7g@0.1.593 506 MiB ⚠️, store-7g-wt3@0.1.591 502 MiB ⚠️, store-7g-wt3@0.1.593 540 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 4 of 4 cells: store-7g@0.1.591 601 ❌, store-7g@0.1.593 38 ❌, store-7g-wt3@0.1.591 517 ❌, store-7g-wt3@0.1.593 60 ❌

## Every metric

| Metric | Healthy | Warn | store-7g@0.1.591 | store-7g@0.1.593 | store-7g-wt3@0.1.591 | store-7g-wt3@0.1.593 |
|---|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 701 ms ❌ | 235 ms ❌ | 1081 ms ❌ | 254 ms ❌ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 881 ms ❌ | 255 ms ❌ | 1118 ms ❌ | 393 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 211 ms ✅ | 100 ms ✅ | 203 ms ✅ | 140 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 521 ms ✅ | 134 ms ✅ | 711 ms ✅ | 293 ms ✅ |
| **Commands** | | |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 242 ms ✅ | 212 ms ✅ | 326 ms ⚠️ | 397 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 205 ms ✅ | 171 ms ✅ | 250 ms ✅ | 340 ms ⚠️ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 605 ms ✅ | 620 ms ✅ | 437 ms ✅ | 721 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 352 ms ✅ | 498 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.34 x ⚠️ | 1.45 x ⚠️ | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 45 s | 54 s | 50 s | 43 s |
| **Verdicts** | | |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1499 ms ✅ | 1268 ms ✅ | 1932 ms ✅ | 1517 ms ✅ |
| **Correctness** | | |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | 2470 ms ✅ | 1892 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 69 % ❌ | 69 % ❌ |
| **Correctness** | | |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 189 s ⚠️ | 203 s ⚠️ | 232 s ⚠️ | 212 s ⚠️ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 1.6 % core ⚠️ | 2.0 % core ⚠️ | 3.8 % core ⚠️ | 3.4 % core ⚠️ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 502 MiB ⚠️ | 506 MiB ⚠️ | 502 MiB ⚠️ | 540 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 21 s | 19 s | 7.5 s | 6.2 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.7 s | 1.6 s | 5 s | 5.1 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 149 MiB | 162 MiB | 179 MiB | 161 MiB |
| **Store** | | |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 601 ❌ | 38 ❌ | 517 ❌ | 60 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 8803 MiB | 9169 MiB | 9252 MiB | 9565 MiB |
| Result rows in the store (`store.results`) | report |  | 1148224 | 1148210 | 1156442 | 1155994 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 1 ms | 1 ms | 761 ms | 455 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 4.7 s | 7.8 s | 18 s | 13 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 2 | 2 | 4 | 89 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 0.3 s | 0.3 s | 0.3 s | 0.3 s |
| **Resources** | | |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 104 MiB | 122 MiB | 101 MiB | 105 MiB |
| **Store** | | |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 2108 ms | 1649 ms | 4156 ms | 1754 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 371 s | 18 s | 417 s | 29 s |
