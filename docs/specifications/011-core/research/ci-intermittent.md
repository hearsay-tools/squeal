# Intermittent CI failures: two reproduced races, one unresolved stall

2026-10-31. Wave 60 R2, board row `ci-40592034593`. Diagnosis only.

**Recommendation:** repair the lock and step-down tests' synchronization assumptions; capture the scheduler's stalled phase before choosing its repair. Neither reproduced race proves that exclusion or daemon version selection failed. Do not resolve the whole CI row from these findings alone.

Examined source: `b34b00682af49227d84b0b232209b49ecf5a374c` (0.1.379). Scheduler repetitions use its failing commit `37c3c71254bdd0fe35093fda37a28b930895d56b` (0.1.377). CI and local runs use Node 22.19.0 and Vitest 5.0.3. The lock implementation/test, step-down test/ensure logic, and scheduler test/runner crash logic cited below have no diff between their failing commits and the examined source. [Probes and preserved output](probes/ci-intermittent/README.md) contain commands, setup limits and reproduction details.

## Questions answered

| Failure | Cause or missing evidence | Frequency in this investigation | Proposed row |
| --- | --- | --- | --- |
| Lock contenders: PID 0 | **verified by experiment**, 0.1.379: exclusion starts before the owner hint exists; the test requires a hint too early | 2/3 named CI runs; 2/9 unchanged local file runs; controlled window reproduced | Test exclusion separately from owner-hint publication |
| Equal/newer daemon: empty `ensured` | **verified by experiment**, 0.1.379: a live startup marker bypasses the recorded `ensureDaemon` call even after the socket and store are ready | 1/3 named CI runs; controlled equal/newer cases reproduced; natural local rate unmeasured | Synchronize the settled-daemon assertion and cover the startup window |
| Scheduler crash/re-key test | **inferred**, 0.1.377: a pending operation outlasted both the test and its cleanup; the phase and root cause are **not determined**, because CI kept no phase trace or fixture | 1/3 named CI runs; 0/10 isolated, name-filtered local runs | Capture the phase, then bound the specific stalled operation |

The three CI runs were selected because they failed. These fractions are observations, not an estimate of the overall CI failure rate. A forced ordering proves a mechanism, not how often CI takes it.

## 1. The updater lock excludes correctly before it can name the owner

**read in source code**, `b34b00682`: `src/harness/codex/runtime-update/lock.ts:46–97` executes `BEGIN EXCLUSIVE`, then publishes JSON through `writeAtomic`. A losing process reads `ownerHint`; a missing hint returns `{pid: 0, startedAt: 0}`. The hint is explicitly best effort and never grants exclusion. In `test/harness/codex/runtime-update/lock-process.test.ts:38–46`, all three contenders start together. The assertions for one holder and two busy results pass before the PID assertion fails.

**verified by experiment**, Node 22.19.0, 0.1.379: the `now` callback starts a second real process while the first holds SQLite but has not published JSON. It returns busy with PID 0. After publication, another attempt returns busy with the holder's PID. The unchanged file also failed on runs 6 and 7 of nine, at exactly the CI assertion. Each run still passed its killed-owner recovery test. No load was added; launch load was below 24 CPUs.

**inferred:** the evidence supports a test contract error, not two live updaters. Publishing the hint before taking the lock would not make it authoritative and could name a loser.

**Proposed repair row, test only:** own `test/harness/codex/runtime-update/lock-process.test.ts` and its process fixture. Retain exactly one holder/two losers. Permit an unknown owner during simultaneous acquisition; assert an exact PID only after the holder's acquisition acknowledgement. Done when a deterministic contender before hint publication stays busy, an acknowledged holder is identified correctly, and killed-owner recovery still preserves the SQLite inode and cleans staging. No change to lock acquisition or owner-age policy is supported by this evidence.

## 2. A ping is not a barrier for the startup marker's removal

**read in source code**, `b34b00682`: `Daemon.start` opens the socket before `#register` (`src/core/daemon/daemon.ts:291–301`). Registration commits the daemon row, then removes the start marker (`:441–480`). The socket worker can answer independently. In `src/harness/shared/ensure.ts:74–89`, `startCurrent` returns `spawned` while that marker names a live process, before the injected `ensureDaemon` runs. With a fresh heartbeat, `ensureIfStale` also skips that dependency. The test waits only for a ping, runs both hooks and expects the dependency's recorded results to equal `["alive"]` (`test/daemon/step-down.test.ts:205–224`). An empty array is possible without a replacement or a dead daemon.

**verified by experiment**, Node 22.19.0, committed 0.1.379 CLI: a test preload holds the main thread just before removing `.starting`, after registration. It uses `Atomics.wait`, without added CPU work; the socket worker still answers. Source hooks with equal and older hook versions both return without hook errors and record `[]`. After the marker clears, SessionStart records `["alive"]`, with the same daemon PID. This reproduces the failed assertion's state while the daemon is untouched.

**inferred:** this ordering explains the CI symptom, but CI did not preserve the marker, hook output or which loop iteration failed. A swallowed hook error cannot be excluded from the historical log alone. The reproduced startup window is sufficient to invalidate the assertion as currently synchronized.

**Proposed repair row, test only:** own `test/daemon/step-down.test.ts` and its helper. For the settled-daemon case, wait for the matching daemon record and absence of its startup marker before requiring an `alive` dependency result. Add a controlled startup-window case that permits no dependency call but requires the original PID/version, no successor and no step-down note. Capture both hook results, with debug stderr, on failure. Done when equal and newer daemons satisfy those checks both while starting and after registration settles. Keep the older-daemon cancellation and handover assertions.

## 3. The scheduler's 240 seconds are two distinct timeouts

**verified by experiment**, inspection of run 40853153243 at `37c3c7125`: the log reports `Test timed out in 120000ms` at `runs.test.ts:118`, then `Hook timed out in 120000ms` at `helpers.ts:64`. Its combined test duration is 240,113 ms. The preceding crash-only test passed in 846 ms. The same crash/re-key test passed in 1,054 ms and 618 ms in the other two named CI runs.

**read in source code**, `37c3c7125`: the test starts a real scheduler, waits for its baseline, adds a file which rewrites itself and sends itself SIGKILL, polls for the rewritten bytes, reports the batch, then waits for scheduler idle twice. Its recording runner serializes runner calls (`test/scheduler/helpers.ts:133–173`); `beforeRun` starts the poll without awaiting it. Thus there is no direct test callback waiting for work that it prevents from starting. The poll has a 60-second bound; the scheduler waits do not. Cleanup calls `scheduler.close()` without cancellation, which waits for its pump, before closing the runner. The harness inherits the 600,000 ms runner budget, longer than the 120,000 ms test and cleanup budgets.

**inferred:** the cleanup timeout is consistent with unfinished scheduler work, not proof of slow CPU alone. The log cannot distinguish a baseline stall, a worker exit/run completion stall, runner refinement after the edit, or a later close. `execute` bounds the Vitest run, but instance setup and normal close are separate awaits. None of those possible locations is a diagnosed cause here.

**verified by experiment**, Node 22.19.0, `37c3c7125`: ten isolated invocations selecting only the failed test passed; six sibling tests were skipped each time. They used a private `/tmp` source copy, sequentially, at launch loads 17.41–20.46 on 24 CPUs. This did not reproduce shard contention or prior-test order. The first archive invocation also reported a pnpm automatic-install warning before Vitest; details are preserved in the probe README. No local full suite ran.

**Proposed follow-up row, diagnosis before repair:** own this test, its diagnostic helper and only the runner/scheduler operation that a trace proves stalled. First capture phase entry/exit for baseline, child rewrite, child exit, `runner.run`, runner refinement, idle and cleanup; retain the temporary run logs and store on timeout. Done when the failing phase has a bounded reproduction, and a targeted regression proves both crash reporting and the new-key rerun complete, with cleanup bounded and no stale result stored. Stop for another scope decision if it needs an upstream Vitest change. Raising test timeouts or retrying the whole shard is not a supported repair yet.

## Sources and verification limits

- [CI 40592034593](https://github.com/hearsay-tools/squeal/actions/runs/40592034593), `8e5c2d12f`: lock PID 0 on shard 1; empty `ensured` on shard 3.
- [CI 40774288680](https://github.com/hearsay-tools/squeal/actions/runs/40774288680), `3dfaf504d`: lock PID 0 on shard 1; step-down and scheduler files passed.
- [CI 40853153243](https://github.com/hearsay-tools/squeal/actions/runs/40853153243), `37c3c7125`: scheduler test and cleanup timed out on shard 3; lock and step-down files passed.
- Fetched with `gh run view <id> --log-failed`; full logs for the latter two establish the other named files' passes. [Evidence excerpts](probes/ci-intermittent/evidence.txt) are preserved locally in this spec.
- **read in source code**, the cited commits: `.github/workflows/ci.yml` pins Node 22.19, runs three shards and excludes only `opencode-dispose.test.ts` for a separate step. The scheduler push changed only research docs and probes; `docs/**/probes/**` is explicitly included, so that CI run was expected. CI success on other commits does not clear this failure.
- Only research files changed. No product repair, build, typecheck, full-suite run or CI rerun was performed. The two proposed test repairs still need approval and verification; the scheduler cause remains open.
