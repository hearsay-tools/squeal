# Squeal performance scorecard

Squeal 0.1.591 vs 0.1.593 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2457 MiB/s · 2026-11-22T00:55:05.099Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 54 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 50 | 81 | 43 | 44 | 50 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| store-7g@0.1.591 | 500 | 1 | 0% | 326 | ✅ | 54 | 50 | 88 | 30 | 50 | 50 |
| store-7g@0.1.593 | 500 | 1 | 0% | 326 | ✅ | 56 | 50 | 88 | 40 | 50 | 50 |
| store-7g-wt3@0.1.591 | 500 | 3 | 0% | 326 | ✅ | 55 | 50 | 75 | 50 | 50 | 50 |
| store-7g-wt3@0.1.593 | 500 | 3 | 0% | 326 | ✅ | 50 | 50 | 75 | 50 | 25 | 50 |

## 0.1.591 compared with 0.1.593 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| store-7g | 0.1.591 | 1 | ✅ | 54 |  |  |  |  |  |  |
| store-7g | 0.1.593 | 1 | ✅ | 56 | +2 | +0 | +0 | +10 | +0 | +0 |
| store-7g-wt3 | 0.1.591 | 1 | ✅ | 55 |  |  |  |  |  |  |
| store-7g-wt3 | 0.1.593 | 1 | ✅ | 50 | -5 | +0 | +0 | +0 | -25 | +0 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.591 | 0.1.593 | Δ% |
|---|---|---:|---:|---:|
| store-7g | Hook before each tool call (slowest 5%) | 1083 ms | 211 ms | -81% |
| store-7g | Hook after each batch of tool calls (slowest 5%) | 825 ms | 295 ms | -64% |
| store-7g | Hook at session start (slowest) | 141 ms | 169 ms | +20% |
| store-7g | `squeal status` (slowest 5%) | 247 ms | 335 ms | +36% |
| store-7g | Edit that breaks a test until the agent is told (median) | 1906 ms | 2001 ms | +5% |
| store-7g | Edits with a verdict within the 60 s agents wait | 50 % | 50 % | +0% |
| store-7g | CPU with no edits: the busiest daemon, plus the store process | 2.8 % core | 3.3 % core | +20% |
| store-7g | CPU per edit: daemons with their test runs, plus the store process | 23 s | 4.1 s | -82% |
| store-7g | Daemon memory, peak | 453 MiB | 501 MiB | +11% |
| store-7g | Store process memory, peak | 169 MiB | 143 MiB | -15% |
| store-7g | Store writes that held the lock over 250 ms | 575 | 17 | -97% |
| store-7g | Longest logged lock hold (only holds over 250 ms are logged) | 2134 ms | 830 ms | -61% |
| store-7g | Logged lock holds, total | 387 s | 7.8 s | -98% |
| store-7g | `squeal reach` (reads every stored module list) | 0.3 s | 0.3 s | +4% |
| store-7g | `squeal reach` memory, peak | 105 MiB | 102 MiB | -3% |
| store-7g-wt3 | Hook before each tool call (slowest 5%) | 995 ms | 641 ms | -36% |
| store-7g-wt3 | Hook after each batch of tool calls (slowest 5%) | 1120 ms | 509 ms | -55% |
| store-7g-wt3 | Hook at session start (slowest) | 190 ms | 220 ms | +16% |
| store-7g-wt3 | `squeal status` (slowest 5%) | 348 ms | 309 ms | -11% |
| store-7g-wt3 | Edit that breaks a test until the agent is told (median) | 2040 ms | 1301 ms | -36% |
| store-7g-wt3 | Edits with a verdict within the 60 s agents wait | 69 % | 69 % | +0% |
| store-7g-wt3 | CPU with no edits: the busiest daemon, plus the store process | 3.8 % core | 5.7 % core | +50% |
| store-7g-wt3 | CPU per edit: daemons with their test runs, plus the store process | 7.1 s | 1.1 s | -85% |
| store-7g-wt3 | Daemon memory, peak | 499 MiB | 512 MiB | +3% |
| store-7g-wt3 | Store process memory, peak | 188 MiB | 186 MiB | -1% |
| store-7g-wt3 | Store writes that held the lock over 250 ms | 511 | 77 | -85% |
| store-7g-wt3 | Longest logged lock hold (only holds over 250 ms are logged) | 2579 ms | 3148 ms | +22% |
| store-7g-wt3 | Logged lock holds, total | 385 s | 39 s | -90% |
| store-7g-wt3 | `squeal reach` (reads every stored module list) | 0.2 s | 0.2 s | -15% |
| store-7g-wt3 | `squeal reach` memory, peak | 102 MiB | 87 MiB | -15% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: store-7g@0.1.591 1083 ms ❌, store-7g@0.1.593 211 ms ❌, store-7g-wt3@0.1.591 995 ms ❌, store-7g-wt3@0.1.593 641 ms ❌
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 4 of 4 cells: store-7g@0.1.591 825 ms ❌, store-7g@0.1.593 295 ms ❌, store-7g-wt3@0.1.591 1120 ms ❌, store-7g-wt3@0.1.593 509 ms ❌
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 3 of 4 cells: store-7g@0.1.593 335 ms ⚠️, store-7g-wt3@0.1.591 348 ms ⚠️, store-7g-wt3@0.1.593 309 ms ⚠️
- **Commands · `squeal status --json` (slowest 5%)** (healthy ≤ 300 ms): 2 of 4 cells: store-7g-wt3@0.1.591 312 ms ⚠️, store-7g-wt3@0.1.593 317 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 1 of 4 cells: store-7g@0.1.591 1.41 x ⚠️
- **Verdicts · Edit until `status --wait` gives a verdict (median)** (healthy ≤ 3000 ms): 2 of 4 cells: store-7g@0.1.591 late ❌, store-7g@0.1.593 late ❌
- **Verdicts · Edit until `status --wait` gives a verdict (slowest 5%)** (healthy ≤ 10000 ms): 4 of 4 cells: store-7g@0.1.591 late ❌, store-7g@0.1.593 late ❌, store-7g-wt3@0.1.591 late ❌, store-7g-wt3@0.1.593 late ❌
- **Verdicts · Edits with a verdict within the 60 s agents wait** (healthy ≥ 95 %): 4 of 4 cells: store-7g@0.1.591 50 % ❌, store-7g@0.1.593 50 % ❌, store-7g-wt3@0.1.591 69 % ❌, store-7g-wt3@0.1.593 69 % ❌
- **Verdicts · Edit every test imports until the whole suite is current** (healthy ≤ 180 s): 3 of 4 cells: store-7g@0.1.591 209 s ⚠️, store-7g-wt3@0.1.591 229 s ⚠️, store-7g-wt3@0.1.593 222 s ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 4 of 4 cells: store-7g@0.1.591 2.8 % core ⚠️, store-7g@0.1.593 3.3 % core ⚠️, store-7g-wt3@0.1.591 3.8 % core ⚠️, store-7g-wt3@0.1.593 5.7 % core ❌
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 4 of 4 cells: store-7g@0.1.591 453 MiB ⚠️, store-7g@0.1.593 501 MiB ⚠️, store-7g-wt3@0.1.591 499 MiB ⚠️, store-7g-wt3@0.1.593 512 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 4 of 4 cells: store-7g@0.1.591 575 ❌, store-7g@0.1.593 17 ❌, store-7g-wt3@0.1.591 511 ❌, store-7g-wt3@0.1.593 77 ❌

## Every metric

| Metric | Healthy | Warn | store-7g@0.1.591 | store-7g@0.1.593 | store-7g-wt3@0.1.591 | store-7g-wt3@0.1.593 |
|---|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 1083 ms ❌ | 211 ms ❌ | 995 ms ❌ | 641 ms ❌ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 825 ms ❌ | 295 ms ❌ | 1120 ms ❌ | 509 ms ❌ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 141 ms ✅ | 169 ms ✅ | 190 ms ✅ | 220 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 79 ms ✅ | 363 ms ✅ | 1030 ms ✅ | 358 ms ✅ |
| **Commands** | | |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 247 ms ✅ | 335 ms ⚠️ | 348 ms ⚠️ | 309 ms ⚠️ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 292 ms ✅ | 288 ms ✅ | 312 ms ⚠️ | 317 ms ⚠️ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 728 ms ✅ | 887 ms ✅ | 488 ms ✅ | 771 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | 484 ms ✅ | 494 ms ✅ |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.41 x ⚠️ | 1.24 x ✅ | n/a | n/a |
| Full run with Squeal (`cmd.runAll`) | report |  | 52 s | 40 s | 48 s | 45 s |
| **Verdicts** | | |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1906 ms ✅ | 2001 ms ✅ | 2040 ms ✅ | 1301 ms ✅ |
| **Correctness** | | |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | 2627 ms ✅ | 1782 ms ✅ |
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
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 209 s ⚠️ | 162 s ✅ | 229 s ⚠️ | 222 s ⚠️ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 2.8 % core ⚠️ | 3.3 % core ⚠️ | 3.8 % core ⚠️ | 5.7 % core ❌ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 453 MiB ⚠️ | 501 MiB ⚠️ | 499 MiB ⚠️ | 512 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 23 s | 4.1 s | 7.1 s | 1.1 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 1.6 s | 1.7 s | 4.4 s | 4.7 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 169 MiB | 143 MiB | 188 MiB | 186 MiB |
| **Store** | | |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 575 ❌ | 17 ❌ | 511 ❌ | 77 ❌ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 8982 MiB | 10463 MiB | 9343 MiB | 10535 MiB |
| Result rows in the store (`store.results`) | report |  | 1147524 | 1147496 | 1155966 | 1156274 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 1 ms | 1 ms | 122 ms | 206 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 7.4 s | 3.7 s | 15 s | 19 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 3 | 3 | 2 | 2 |
| Store process: times it stopped (`store.process.stops`) | report |  | 1 | 1 | 1 | 1 |
| **Commands** | | |  |  |  |  |
| `squeal reach` (reads every stored module list) (`cmd.reach.s`) | report |  | 0.3 s | 0.3 s | 0.2 s | 0.2 s |
| **Resources** | | |  |  |  |  |
| `squeal reach` memory, peak (`res.reach.rss`) | report |  | 105 MiB | 102 MiB | 102 MiB | 87 MiB |
| **Store** | | |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 2134 ms | 830 ms | 2579 ms | 3148 ms |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 387 s | 7.8 s | 385 s | 39 s |
