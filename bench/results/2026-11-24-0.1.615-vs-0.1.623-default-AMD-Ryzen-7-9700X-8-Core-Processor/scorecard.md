# Squeal performance scorecard

Squeal 0.1.615 vs 0.1.623 · Node v24.22.1 · AMD Ryzen 7 9700X 8-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2456 MiB/s · 2026-11-24T18:26:16.492Z

**Correctness: PASS** (no wrong verdict, missed, false or misaddressed notice, hook over its 2 s timeout or failed session in any cell)

**Overall score: 81 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 72 | 94 | 100 | 63 | 78 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref@0.1.615 | 500 | 1 | 0% | 0 | ✅ | 83 | 63 | 100 | 100 | 75 | 75 |
| ref@0.1.623 | 500 | 1 | 0% | 0 | ✅ | 88 | 75 | 88 | 100 | 75 | 100 |
| size-l@0.1.615 | 2000 | 1 | 0% | 0 | ✅ | 75 | 75 | 100 | 100 | 50 | 50 |
| size-l@0.1.623 | 2000 | 1 | 0% | 0 | ✅ | 73 | 63 | 100 | 100 | 50 | 50 |
| wt-3@0.1.615 | 500 | 3 | 0% | 0 | ✅ | 85 | 75 | 100 | 100 | 50 | 100 |
| wt-3@0.1.623 | 500 | 3 | 0% | 0 | ✅ | 78 | 75 | 88 | 100 | 50 | 75 |
| load-50@0.1.615 | 500 | 1 | 50% | 0 | ✅ | 83 | 75 | 88 | 100 | 75 | 75 |
| load-50@0.1.623 | 500 | 1 | 50% | 0 | ✅ | 88 | 75 | 88 | 100 | 75 | 100 |

## 0.1.615 compared with 0.1.623 (same machine, cells alternated)

| Cell | Version | Runs | Correct | Score (range) | Δ | Hooks Δ | Commands Δ | Verdicts Δ | Resources Δ | Store Δ |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ref | 0.1.615 | 1 | ✅ | 83 |  |  |  |  |  |  |
| ref | 0.1.623 | 1 | ✅ | 88 | +5 | +13 | -13 | +0 | +0 | +25 |
| size-l | 0.1.615 | 1 | ✅ | 75 |  |  |  |  |  |  |
| size-l | 0.1.623 | 1 | ✅ | 73 | -3 | -13 | +0 | +0 | +0 | +0 |
| wt-3 | 0.1.615 | 1 | ✅ | 85 |  |  |  |  |  |  |
| wt-3 | 0.1.623 | 1 | ✅ | 78 | -8 | +0 | -13 | +0 | +0 | -25 |
| load-50 | 0.1.615 | 1 | ✅ | 83 |  |  |  |  |  |  |
| load-50 | 0.1.623 | 1 | ✅ | 88 | +5 | +0 | +0 | +0 | +0 | +25 |

Raw numbers, mean per cell and version (Δ% against the first version):

| Cell | Metric | 0.1.615 | 0.1.623 | Δ% |
|---|---|---:|---:|---:|
| ref | Hook before each tool call (slowest 5%) | 82 ms | 91 ms | +11% |
| ref | Hook after each batch of tool calls (slowest 5%) | 206 ms | 92 ms | -55% |
| ref | Hook at session start (slowest) | 113 ms | 212 ms | +87% |
| ref | `squeal status` (slowest 5%) | 159 ms | 206 ms | +30% |
| ref | Edit that breaks a test until the agent is told (median) | 1216 ms | 1137 ms | -6% |
| ref | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| ref | CPU with no edits: the busiest daemon, plus the store process | 0.5 % core | 0.3 % core | -35% |
| ref | CPU per edit: daemons with their test runs, plus the store process | 0.8 s | 1.1 s | +31% |
| ref | Daemon memory, peak | 386 MiB | 419 MiB | +9% |
| ref | Store process memory, peak | 154 MiB | 154 MiB | -0% |
| ref | Store writes that held the lock over 250 ms | 1 | 0 | -100% |
| ref | Longest logged lock hold (only holds over 250 ms are logged) | 1007 ms | n/a |  |
| ref | Logged lock holds, total | 1.0 s | 0 s | -100% |
| ref | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | +35% |
| ref | `squeal impact` memory, peak | 91 MiB | 151 MiB | +67% |
| size-l | Hook before each tool call (slowest 5%) | 93 ms | 161 ms | +72% |
| size-l | Hook after each batch of tool calls (slowest 5%) | 192 ms | 230 ms | +20% |
| size-l | Hook at session start (slowest) | 246 ms | 280 ms | +14% |
| size-l | `squeal status` (slowest 5%) | 278 ms | 292 ms | +5% |
| size-l | Edit that breaks a test until the agent is told (median) | 1225 ms | 1288 ms | +5% |
| size-l | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| size-l | CPU with no edits: the busiest daemon, plus the store process | 0.2 % core | 0.8 % core | +380% |
| size-l | CPU per edit: daemons with their test runs, plus the store process | 2.4 s | 2.8 s | +14% |
| size-l | Daemon memory, peak | 706 MiB | 649 MiB | -8% |
| size-l | Store process memory, peak | 250 MiB | 278 MiB | +11% |
| size-l | Store writes that held the lock over 250 ms | 13 | 13 | +0% |
| size-l | Longest logged lock hold (only holds over 250 ms are logged) | 1287 ms | 1349 ms | +5% |
| size-l | Logged lock holds, total | 5.3 s | 5.4 s | +1% |
| size-l | `squeal impact` (reads every stored module list) | 0.5 s | 0.6 s | +18% |
| size-l | `squeal impact` memory, peak | 226 MiB | 245 MiB | +8% |
| wt-3 | Hook before each tool call (slowest 5%) | 106 ms | 95 ms | -11% |
| wt-3 | Hook after each batch of tool calls (slowest 5%) | 125 ms | 171 ms | +37% |
| wt-3 | Hook at session start (slowest) | 101 ms | 140 ms | +40% |
| wt-3 | `squeal status` (slowest 5%) | 243 ms | 336 ms | +38% |
| wt-3 | Edit that breaks a test until the agent is told (median) | 1157 ms | 1175 ms | +2% |
| wt-3 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| wt-3 | CPU with no edits: the busiest daemon, plus the store process | 2.8 % core | 3.0 % core | +5% |
| wt-3 | CPU per edit: daemons with their test runs, plus the store process | 0.3 s | 0.3 s | +2% |
| wt-3 | Daemon memory, peak | 386 MiB | 401 MiB | +4% |
| wt-3 | Store process memory, peak | 204 MiB | 202 MiB | -1% |
| wt-3 | Store writes that held the lock over 250 ms | 0 | 3 |  |
| wt-3 | Longest logged lock hold (only holds over 250 ms are logged) | n/a | 268 ms |  |
| wt-3 | Logged lock holds, total | 0 s | 0.8 s |  |
| wt-3 | `squeal impact` (reads every stored module list) | 0.2 s | 0.2 s | -3% |
| wt-3 | `squeal impact` memory, peak | 88 MiB | 92 MiB | +5% |
| load-50 | Hook before each tool call (slowest 5%) | 116 ms | 86 ms | -26% |
| load-50 | Hook after each batch of tool calls (slowest 5%) | 152 ms | 148 ms | -3% |
| load-50 | Hook at session start (slowest) | 141 ms | 102 ms | -27% |
| load-50 | `squeal status` (slowest 5%) | 197 ms | 226 ms | +15% |
| load-50 | Edit that breaks a test until the agent is told (median) | 1203 ms | 1188 ms | -1% |
| load-50 | Edits with a verdict within the 60 s agents wait | 100 % | 100 % | +0% |
| load-50 | CPU with no edits: the busiest daemon, plus the store process | 0.8 % core | 0.2 % core | -68% |
| load-50 | CPU per edit: daemons with their test runs, plus the store process | 1.1 s | 1.1 s | -1% |
| load-50 | Daemon memory, peak | 403 MiB | 459 MiB | +14% |
| load-50 | Store process memory, peak | 144 MiB | 155 MiB | +8% |
| load-50 | Store writes that held the lock over 250 ms | 1 | 0 | -100% |
| load-50 | Longest logged lock hold (only holds over 250 ms are logged) | 364 ms | n/a |  |
| load-50 | Logged lock holds, total | 0.4 s | 0 s | -100% |
| load-50 | `squeal impact` (reads every stored module list) | 0.3 s | 0.3 s | +9% |
| load-50 | `squeal impact` memory, peak | 121 MiB | 169 MiB | +40% |

## What is not healthy

- **Hooks · Hook before each tool call (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: ref@0.1.615 82 ms ⚠️, ref@0.1.623 91 ms ⚠️, size-l@0.1.615 93 ms ⚠️, size-l@0.1.623 161 ms ⚠️, wt-3@0.1.615 106 ms ⚠️, wt-3@0.1.623 95 ms ⚠️, load-50@0.1.615 116 ms ⚠️, load-50@0.1.623 86 ms ⚠️
- **Hooks · Hook after each batch of tool calls (slowest 5%)** (healthy ≤ 80 ms): 8 of 8 cells: ref@0.1.615 206 ms ❌, ref@0.1.623 92 ms ⚠️, size-l@0.1.615 192 ms ⚠️, size-l@0.1.623 230 ms ❌, wt-3@0.1.615 125 ms ⚠️, wt-3@0.1.623 171 ms ⚠️, load-50@0.1.615 152 ms ⚠️, load-50@0.1.623 148 ms ⚠️
- **Commands · `squeal status` (slowest 5%)** (healthy ≤ 300 ms): 1 of 8 cells: wt-3@0.1.623 336 ms ⚠️
- **Commands · Full run with Squeal, as a multiple of plain Vitest** (healthy ≤ 1.3 x): 3 of 8 cells: ref@0.1.623 1.48 x ⚠️, load-50@0.1.615 1.43 x ⚠️, load-50@0.1.623 1.43 x ⚠️
- **Resources · CPU with no edits: the busiest daemon, plus the store process** (healthy ≤ 1 % core): 2 of 8 cells: wt-3@0.1.615 2.8 % core ⚠️, wt-3@0.1.623 3.0 % core ⚠️
- **Resources · Daemon memory, peak** (healthy ≤ 300 MiB): 8 of 8 cells: ref@0.1.615 386 MiB ⚠️, ref@0.1.623 419 MiB ⚠️, size-l@0.1.615 706 MiB ❌, size-l@0.1.623 649 MiB ❌, wt-3@0.1.615 386 MiB ⚠️, wt-3@0.1.623 401 MiB ⚠️, load-50@0.1.615 403 MiB ⚠️, load-50@0.1.623 459 MiB ⚠️
- **Store · Store writes that held the lock over 250 ms** (healthy ≤ 0): 5 of 8 cells: ref@0.1.615 1 ⚠️, size-l@0.1.615 13 ❌, size-l@0.1.623 13 ❌, wt-3@0.1.623 3 ⚠️, load-50@0.1.615 1 ⚠️

## Every metric

| Metric | Healthy | Warn | ref@0.1.615 | ref@0.1.623 | size-l@0.1.615 | size-l@0.1.623 | wt-3@0.1.615 | wt-3@0.1.623 | load-50@0.1.615 | load-50@0.1.623 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |
| Hook before each tool call (slowest 5%) (`hook.preToolUse.p95`) | ≤ 80 | ≤ 200 | 82 ms ⚠️ | 91 ms ⚠️ | 93 ms ⚠️ | 161 ms ⚠️ | 106 ms ⚠️ | 95 ms ⚠️ | 116 ms ⚠️ | 86 ms ⚠️ |
| Hook after each batch of tool calls (slowest 5%) (`hook.postToolBatch.p95`) | ≤ 80 | ≤ 200 | 206 ms ❌ | 92 ms ⚠️ | 192 ms ⚠️ | 230 ms ❌ | 125 ms ⚠️ | 171 ms ⚠️ | 152 ms ⚠️ | 148 ms ⚠️ |
| Hook at session start (slowest) (`hook.sessionStart.max`) | ≤ 750 | ≤ 2000 | 113 ms ✅ | 212 ms ✅ | 246 ms ✅ | 280 ms ✅ | 101 ms ✅ | 140 ms ✅ | 141 ms ✅ | 102 ms ✅ |
| Hook when the agent stops (slowest) (`hook.stop.max`) | ≤ 1500 | ≤ 2000 | 67 ms ✅ | 92 ms ✅ | 241 ms ✅ | 204 ms ✅ | 97 ms ✅ | 92 ms ✅ | 163 ms ✅ | 110 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal status` (slowest 5%) (`cmd.status.p95`) | ≤ 300 | ≤ 1000 | 159 ms ✅ | 206 ms ✅ | 278 ms ✅ | 292 ms ✅ | 243 ms ✅ | 336 ms ⚠️ | 197 ms ✅ | 226 ms ✅ |
| `squeal status --json` (slowest 5%) (`cmd.statusJson.p95`) | ≤ 300 | ≤ 1000 | 146 ms ✅ | 190 ms ✅ | 260 ms ✅ | 285 ms ✅ | 289 ms ✅ | 275 ms ✅ | 208 ms ✅ | 227 ms ✅ |
| `squeal start` in the main worktree (`cmd.start.main`) | ≤ 2000 | ≤ 5000 | 797 ms ✅ | 485 ms ✅ | 644 ms ✅ | 882 ms ✅ | 451 ms ✅ | 407 ms ✅ | 512 ms ✅ | 693 ms ✅ |
| `squeal start` in another worktree on the shared store (`cmd.start.others.max`) | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | n/a | 273 ms ✅ | 291 ms ✅ | n/a | n/a |
| Full run with Squeal, as a multiple of plain Vitest (`cmd.runAll.overhead`) | ≤ 1.3 | ≤ 2 | 1.18 x ✅ | 1.48 x ⚠️ | 1.24 x ✅ | 1.17 x ✅ | n/a | n/a | 1.43 x ⚠️ | 1.43 x ⚠️ |
| Full run with Squeal (`cmd.runAll`) | report |  | 40 s | 46 s | 153 s | 151 s | 40 s | 38 s | 53 s | 55 s |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit that breaks a test until the agent is told (median) (`session.pushFail.p50`) | ≤ 3000 | ≤ 10000 | 1216 ms ✅ | 1137 ms ✅ | 1225 ms ✅ | 1288 ms ✅ | 1157 ms ✅ | 1175 ms ✅ | 1203 ms ✅ | 1188 ms ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Breaks the agent was never told about (`session.pushFail.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fixes the agent was never told about (`session.pushRecovery.missed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit until `status --wait` gives a verdict (median) (`session.verdict.p50`) | ≤ 3000 | ≤ 10000 | 1533 ms ✅ | 1117 ms ✅ | 2203 ms ✅ | 2328 ms ✅ | 1489 ms ✅ | 1515 ms ✅ | 2076 ms ✅ | 1652 ms ✅ |
| Edit until `status --wait` gives a verdict (slowest 5%) (`session.verdict.p95`) | ≤ 10000 | ≤ 30000 | 6487 ms ✅ | 6582 ms ✅ | 5736 ms ✅ | 6841 ms ✅ | 5596 ms ✅ | 6644 ms ✅ | 7211 ms ✅ | 6279 ms ✅ |
| Edits with a verdict within the 60 s agents wait (`session.verdict.within60s`) | ≥ 95 | ≥ 80 | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ | 100 % ✅ |
| **Correctness** | | |  |  |  |  |  |  |  |  |
| Verdicts that disagree with the truth (`session.verdict.wrong`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Hook calls over the 2 s timeout, which Claude Code kills and whose output it drops (`hook.overTimeout`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL notices when this session had broken nothing (`notice.falseAlarm`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Failure notices that name neither the edited file nor a test it broke (`notice.unnamed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for a test the session's break does not reach (`notice.wrongTest`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| FAIL lines for another worktree's break (`notice.wrongSession`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Code-store batches reported failed, by the store process or a daemon (lost writes) (`store.failedBatches`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Cell setup failed: plain Vitest, the full run or the store aging did not succeed, so the cell measured nothing (`cell.setupFailed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Fast-forward or rebase that git refused, so the cell measured no fast-forward (`ff.gitFailed`) | 0 (gate) |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Scripted sessions that crashed (`session.failed`) | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |  |  |  |  |  |
| Edit every test imports until the whole suite is current (`session.broad.verdict`) | ≤ 180 | ≤ 300 | 33 s ✅ | 36 s ✅ | 157 s ✅ | 158 s ✅ | 111 s ✅ | 115 s ✅ | 55 s ✅ | 61 s ✅ |
| Fast-forward: test files queued 3 s after it (`ff.queued`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward from CI: `squeal import` of the export (`ff.import.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: until no test file waits (polled before each later step) (`ff.drainS`) | ≤ 120 | ≤ 600 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: hook outputs after it that report its files as not run yet (`ff.lateNotices`) | ≤ 0 | ≤ 3 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Fast-forward: the agent's own edits after it until their verdict (median) (`ff.editVerdict.p50`) | ≤ 3000 | ≤ 10000 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Resources** | | |  |  |  |  |  |  |  |  |
| CPU with no edits: the busiest daemon, plus the store process (`res.idleCpu.maxPct`) | ≤ 1 | ≤ 5 | 0.5 % core ✅ | 0.3 % core ✅ | 0.2 % core ✅ | 0.8 % core ✅ | 2.8 % core ⚠️ | 3.0 % core ⚠️ | 0.8 % core ✅ | 0.2 % core ✅ |
| Daemon memory, peak (`res.daemonRss.max`) | ≤ 300 | ≤ 600 | 386 MiB ⚠️ | 419 MiB ⚠️ | 706 MiB ❌ | 649 MiB ❌ | 386 MiB ⚠️ | 401 MiB ⚠️ | 403 MiB ⚠️ | 459 MiB ⚠️ |
| CPU per edit: daemons with their test runs, plus the store process (`res.cpuPerEdit`) | report |  | 0.8 s | 1.1 s | 2.4 s | 2.8 s | 0.3 s | 0.3 s | 1.1 s | 1.1 s |
| Store process CPU during the sessions (`res.storeProcess.cpuS`) | report |  | 0.7 s | 0.9 s | 2.1 s | 2.3 s | 1.9 s | 2.1 s | 0.9 s | 0.9 s |
| Store process memory, peak (`res.storeProcess.rss`) | report |  | 154 MiB | 154 MiB | 250 MiB | 278 MiB | 204 MiB | 202 MiB | 144 MiB | 155 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Store writes that held the lock over 250 ms (`store.longWrites`) | ≤ 0 | ≤ 3 | 1 ⚠️ | 0 ✅ | 13 ❌ | 13 ❌ | 0 ✅ | 3 ⚠️ | 1 ⚠️ | 0 ✅ |
| Store writes that failed on a held lock (`store.lockFailures`) | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| Store files on disk (`store.size`) | report |  | 20 MiB | 19 MiB | 58 MiB | 58 MiB | 43 MiB | 41 MiB | 19 MiB | 18 MiB |
| Result rows in the store (`store.results`) | report |  | 8190 | 8190 | 28994 | 28994 | 17038 | 17038 | 8190 | 8190 |
| Restart until a day of expired history is pruned (`store.prune.doneMin`) | ≤ 12 | ≤ 20 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Time the prune spent deleting (`store.prune.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Restart until the integrity check passed (`store.fullCheck.s`) | report |  | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Store process: longest wait of a batch in its queue (`store.process.queueWaitMax`) | report |  | 0 ms | 0 ms | 2 ms | 1 ms | 103 ms | 206 ms | 1 ms | 0 ms |
| Store process: time spent writing (`store.process.busy`) | report |  | 11 s | 7.1 s | 11 s | 15 s | 12 s | 15 s | 6.6 s | 7.0 s |
| Code-store batches a daemon wrote itself because the store process was gone (`store.process.direct`) | report |  | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Store process: times it stopped (`store.process.stops`) | report |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Commands** | | |  |  |  |  |  |  |  |  |
| `squeal impact` (reads every stored module list) (`cmd.impact.s`) | report |  | 0.2 s | 0.2 s | 0.5 s | 0.6 s | 0.2 s | 0.2 s | 0.3 s | 0.3 s |
| **Resources** | | |  |  |  |  |  |  |  |  |
| `squeal impact` memory, peak (`res.impact.rss`) | report |  | 91 MiB | 151 MiB | 226 MiB | 245 MiB | 88 MiB | 92 MiB | 121 MiB | 169 MiB |
| **Store** | | |  |  |  |  |  |  |  |  |
| Longest logged lock hold (only holds over 250 ms are logged) (`store.longWrite.maxMs`) | report |  | 1007 ms | n/a | 1287 ms | 1349 ms | n/a | 268 ms | 364 ms | n/a |
| Logged lock holds, total (`store.longWrite.totalS`) | report |  | 1.0 s | 0 s | 5.3 s | 5.4 s | 0 s | 0.8 s | 0.4 s | 0 s |
