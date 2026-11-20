# Squeal performance scorecard

Squeal 0.1.570 · Node v24.22.1 · AMD EPYC 4584PX 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2128 MiB/s · 2026-11-20T08:03:57.795Z

**Correctness: PASS** (no wrong verdict, missed push or failed session in any cell)

**Overall score: 65 / 100** (mean of the cell scores; a cell is the mean of its 5 areas, each the mean of its metrics: healthy 1, warn 0.5, fail 0)

| Area | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---:|
| All cells | 63 | 88 | 40 | 58 | 75 |

| Cell | Files | Worktrees | Load | Aged rounds | Correct | Score | Hooks | Commands | Verdicts | Resources | Store |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 0 | ✅ | 73 | 75 | 100 | 40 | 75 | 75 |
| store-1.7g | 500 | 1 | 0% | 70 | ✅ | 58 | 63 | 63 | 40 | 50 | 75 |
| store-7g | 500 | 1 | 0% | 326 | ✅ | 63 | 50 | 100 | 40 | 50 | 75 |

| Metric | Healthy | Warn | ref | store-1.7g | store-7g |
|---|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |
| hook.preToolUse.p95 | ≤ 80 | ≤ 200 | 125 ms ⚠️ | 157 ms ⚠️ | 230 ms ❌ |
| hook.postToolBatch.p95 | ≤ 80 | ≤ 200 | 184 ms ⚠️ | 232 ms ❌ | 140 ms ⚠️ |
| hook.sessionStart.max | ≤ 750 | ≤ 2000 | 91 ms ✅ | 100 ms ✅ | 1079 ms ⚠️ |
| hook.stop.max | ≤ 1500 | ≤ 2000 | 228 ms ✅ | 98 ms ✅ | 158 ms ✅ |
| **Commands** | | |  |  |  |
| cmd.status.p95 | ≤ 300 | ≤ 1000 | 219 ms ✅ | 337 ms ⚠️ | 268 ms ✅ |
| cmd.statusJson.p95 | ≤ 300 | ≤ 1000 | 247 ms ✅ | 329 ms ⚠️ | 193 ms ✅ |
| cmd.start.main | ≤ 2000 | ≤ 5000 | 426 ms ✅ | 412 ms ✅ | 430 ms ✅ |
| cmd.start.others.max | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a |
| cmd.runAll.overhead | ≤ 1.3 | ≤ 2 | 1.26 x ✅ | 1.34 x ⚠️ | 1.27 x ✅ |
| cmd.runAll | report |  | 53 s | 44 s | 39 s |
| **Verdicts** | | |  |  |  |
| session.pushFail.p50 | ≤ 3000 | ≤ 10000 | 1222 ms ✅ | 1275 ms ✅ | 1196 ms ✅ |
| **Correctness** | | |  |  |  |
| session.pushFail.missed | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| session.pushRecovery.missed | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| session.verdict.p50 | ≤ 3000 | ≤ 10000 | late ❌ | late ❌ | late ❌ |
| session.verdict.p95 | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ |
| session.verdict.within60s | ≥ 95 | ≥ 80 | 50 % ❌ | 50 % ❌ | 50 % ❌ |
| **Correctness** | | |  |  |  |
| session.verdict.wrong | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| session.failed | 0 (gate) |  | 0 ✅ | 0 ✅ | 0 ✅ |
| **Verdicts** | | |  |  |  |
| session.broad.verdict | ≤ 180 | ≤ 300 | 164 s ✅ | 160 s ✅ | 166 s ✅ |
| **Resources** | | |  |  |  |
| res.idleCpu.maxPct | ≤ 1 | ≤ 5 | 0.6 % core ✅ | 2.5 % core ⚠️ | 2.1 % core ⚠️ |
| res.daemonRss.max | ≤ 300 | ≤ 600 | 397 MiB ⚠️ | 418 MiB ⚠️ | 391 MiB ⚠️ |
| res.cpuPerEdit | report |  | 1.2 s | 1.3 s | 1.2 s |
| **Store** | | |  |  |  |
| store.longWrites | ≤ 0 | ≤ 3 | 2 ⚠️ | 3 ⚠️ | 3 ⚠️ |
| store.lockFailures | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ |
| store.size | report |  | 20 MiB | 1999 MiB | 9199 MiB |
| store.results | report |  | 7728 | 252616 | 1147720 |
| store.prune.doneMin | ≤ 12 | ≤ 20 | n/a | n/a | n/a |
| store.prune.s | report |  | n/a | n/a | n/a |
| store.fullCheck.s | report |  | n/a | n/a | n/a |
