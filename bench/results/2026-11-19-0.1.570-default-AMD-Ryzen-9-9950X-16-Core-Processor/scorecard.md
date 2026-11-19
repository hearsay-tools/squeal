# Squeal performance scorecard

Squeal 0.1.570 · Node v24.22.1 · AMD Ryzen 9 9950X 16-Core Processor · 4 vCPU · 7.8 GiB · SHA-256 2487 MiB/s · 2026-11-19T20:23:01.205Z

**Overall score: 61 / 100** (mean of the cell scores; healthy 1, warn 0.5, fail 0 per metric)

| Cell | Files | Worktrees | Load | Score | Sessions failed |
|---|---:|---:|---:|---:|---:|
| ref | 500 | 1 | 0% | 68 | 0 |
| size-s | 100 | 1 | 0% | 85 | 0 |
| size-l | 2000 | 1 | 0% | 55 | 0 |
| wt-3 | 500 | 3 | 0% | 70 | 0 |
| wt-6 | 500 | 6 | 0% | 58 | 0 |
| load-50 | 500 | 1 | 50% | 58 | 0 |
| load-100 | 500 | 1 | 100% | 48 | 0 |
| stress | 500 | 6 | 100% | 50 | 0 |

| Metric | Healthy | Warn | ref | size-s | size-l | wt-3 | wt-6 | load-50 | load-100 | stress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Hooks** | | |  |  |  |  |  |  |  |  |
| hook.preToolUse.p95 | ≤ 80 | ≤ 200 | 193 ms ⚠️ | 90 ms ⚠️ | 243 ms ❌ | 177 ms ⚠️ | 253 ms ❌ | 467 ms ❌ | 651 ms ❌ | 788 ms ❌ |
| hook.postToolBatch.p95 | ≤ 80 | ≤ 200 | 211 ms ❌ | 101 ms ⚠️ | 486 ms ❌ | 256 ms ❌ | 402 ms ❌ | 699 ms ❌ | 657 ms ❌ | 1219 ms ❌ |
| hook.sessionStart.max | ≤ 750 | ≤ 2000 | 77 ms ✅ | 87 ms ✅ | 181 ms ✅ | 108 ms ✅ | 281 ms ✅ | 491 ms ✅ | 262 ms ✅ | 448 ms ✅ |
| hook.stop.max | ≤ 1500 | ≤ 2000 | 123 ms ✅ | 104 ms ✅ | 265 ms ✅ | 324 ms ✅ | 907 ms ✅ | 185 ms ✅ | 1073 ms ✅ | 337 ms ✅ |
| **Commands** | | |  |  |  |  |  |  |  |  |
| cmd.status.p95 | ≤ 300 | ≤ 1000 | 276 ms ✅ | 184 ms ✅ | 348 ms ⚠️ | 281 ms ✅ | 605 ms ⚠️ | 756 ms ⚠️ | 697 ms ⚠️ | 1736 ms ❌ |
| cmd.statusJson.p95 | ≤ 300 | ≤ 1000 | 304 ms ⚠️ | 193 ms ✅ | 356 ms ⚠️ | 252 ms ✅ | 570 ms ⚠️ | 665 ms ⚠️ | 684 ms ⚠️ | 1538 ms ❌ |
| cmd.start.main | ≤ 2000 | ≤ 5000 | 258 ms ✅ | 451 ms ✅ | 257 ms ✅ | 305 ms ✅ | 432 ms ✅ | 287 ms ✅ | 920 ms ✅ | 997 ms ✅ |
| cmd.start.others.max | ≤ 2000 | ≤ 5000 | n/a | n/a | n/a | 404 ms ✅ | 1135 ms ✅ | n/a | n/a | 1852 ms ✅ |
| cmd.runAll.overhead | ≤ 1.3 | ≤ 2 | 1.31 x ⚠️ | 1.36 x ⚠️ | 1.29 x ✅ | n/a | n/a | 1.16 x ✅ | 3.61 x ❌ | n/a |
| cmd.runAll | report |  | 38 s | 12 s | 168 s | 38 s | 75 s | 60 s | 295 s | 329 s |
| **Session** | | |  |  |  |  |  |  |  |  |
| session.pushFail.p50 | ≤ 3000 | ≤ 10000 | 1284 ms ✅ | 1181 ms ✅ | 2201 ms ✅ | 1181 ms ✅ | 1287 ms ✅ | 3054 ms ⚠️ | 5384 ms ⚠️ | 7243 ms ⚠️ |
| session.pushFail.missed | ≤ 0 | ≤ 0 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| session.pushRecovery.missed | ≤ 0 | ≤ 0 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| session.verdict.p50 | ≤ 3000 | ≤ 10000 | late ❌ | 531 ms ✅ | late ❌ | 1661 ms ✅ | 1978 ms ✅ | late ❌ | late ❌ | 6591 ms ⚠️ |
| session.verdict.p95 | ≤ 10000 | ≤ 30000 | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ | late ❌ |
| session.verdict.within60s | ≥ 95 | ≥ 80 | 50 % ❌ | 94 % ⚠️ | 72 % ❌ | 69 % ❌ | 71 % ❌ | 50 % ❌ | 50 % ❌ | 72 % ❌ |
| session.verdict.wrong | ≤ 0 | ≤ 0 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| session.broad.verdict | ≤ 180 | ≤ 300 | 175 s ✅ | 130 s ✅ | 290 s ⚠️ | 188 s ⚠️ | late ❌ | 267 s ⚠️ | late ❌ | late ❌ |
| **Resources** | | |  |  |  |  |  |  |  |  |
| res.idleCpu.maxPct | ≤ 1 | ≤ 5 | 0.4 % core ✅ | 0.4 % core ✅ | 1.1 % core ⚠️ | 3.1 % core ⚠️ | 5.5 % core ❌ | 0.8 % core ✅ | 2.6 % core ⚠️ | 4.8 % core ⚠️ |
| res.daemonRss.max | ≤ 300 | ≤ 600 | 391 MiB ⚠️ | 216 MiB ✅ | 709 MiB ❌ | 407 MiB ⚠️ | 425 MiB ⚠️ | 447 MiB ⚠️ | 349 MiB ⚠️ | 410 MiB ⚠️ |
| res.cpuPerEdit | report |  | 1.5 s | 0.4 s | 3.1 s | 0.6 s | 1.1 s | 4.8 s | 2.4 s | 1.6 s |
| **Store** | | |  |  |  |  |  |  |  |  |
| store.longWrites | ≤ 0 | ≤ 3 | 2 ⚠️ | 0 ✅ | 14 ❌ | 13 ❌ | 24 ❌ | 5 ❌ | 9 ❌ | 49 ❌ |
| store.lockFailures | ≤ 0 | ≤ 3 | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ | 0 ✅ |
| store.size | report |  | 20 MiB | 7.0 MiB | 62 MiB | 36 MiB | 59 MiB | 21 MiB | 17 MiB | 45 MiB |
| store.results | report |  | 7728 | 1722 | 28672 | 15890 | 26264 | 7728 | 5012 | 9086 |
