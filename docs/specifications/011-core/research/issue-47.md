# Issue 47: upgrade handoff during active validation

Researcher findings for [hearsay-tools/squeal#47](https://github.com/hearsay-tools/squeal/issues/47), 2026-10-19. Spec 011 C9 (daemon upgrade and lock lifecycle), C6 (status), related C4/C7 (pending-state preservation) and C8 (hooks). Documentation only; no product, spec, status, skill or board edit.

## Reproduction verdict

**Reproduced in an isolated fixture with the shipped 0.1.223 and 0.1.224 plugin bundles. The handoff failure and the restart's pending-work loss are each reproduced as separate steps; the reporter's exact cezarion workload was not run.** An old daemon with an edit's tier in flight steps down, writes its note and keeps running until the tier ends. Six 0.1.224 hooks spawn six `--await-lock 120000` successors. Once the old heartbeat lapses, `start` prints `Squeal daemon alive` above `Daemon: no daemon running since …`, and `status --json` says `down`. If the tier outlasts 120 s, every successor gives up and nothing takes over. A `stop`/`start` restores a daemon, but under `baseline.onStart: lookup-only` (the reporter's setting) the edited file is left stale and unqueued, and `status --wait 60000` returns "on quiet".

**Unresolved cause:** which step held the reporter's 0.1.223 daemon is not determined, because the process tree was not captured at the time. The fixture shows that a tier in flight is enough. The cezarion config allows a tier to take up to `runner.timeoutMs: 600000`, five times the successor's 120 s wait.

Host load: 15.91 on 24 CPUs at the start of the task. The first probe attempt was refused by the probe's own guard (`load 24.23 >= 24 CPUs: not run`). Each kept run's one-minute load was below the CPU count: 23.22, 18.16, 20.45, 15.63 and 6.49. Node v24.21.0, Vitest 4.1.10. CLIs: `~/.claude/plugins/cache/hearsay/squeal/0.1.223` and `/0.1.224` (`--version` prints each). Source read at tags `squeal--v0.1.223` and `squeal--v0.1.224`; `src/core/daemon/daemon.ts` and `handlers.ts` are identical across the two.

## Exact probe commands

From `docs/specifications/011-core/research/probes/issue-47/`, with `P=~/.claude/plugins/cache/hearsay/squeal` and `NM=/home/agent/projects/cezar/node_modules`:

```sh
./probe.sh $P/0.1.223 $P/0.1.224 $NM 120                                        # run 1
./probe.sh $P/0.1.223 $P/0.1.224 $NM 600 135 release                            # run 2
./probe.sh $P/0.1.223 $P/0.1.224 $NM 600 20 stopstart                           # run 3
BASELINE=lookup-only ./probe.sh $P/0.1.223 $P/0.1.224 $NM 600 20 stopstart      # run 4
BASELINE=lookup-only ./probe.sh $P/0.1.224 $P/0.1.224 $NM 600 20 stopstart      # run 5, control
```

`HOME` and `XDG_*` point inside each `/tmp/issue47.*`, so no real daemon was touched. After the runs, `pgrep -af '/tmp/issue47\.'` found no process, and the roots were removed.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a step-down wait for active validation? | Yes. Step-down does not cancel the tier in flight, but `stop` does. | verified by experiment (runs 1, 2); read in source code (0.1.223) |
| 2 | Why six successors? | Each hook that finds the old daemon's heartbeat fresh asks again, the answer is `steppingDown: true` again, and each spawns its own successor. | verified by experiment (6 hooks → 6 processes, runs 1–4); read in source code |
| 3 | Do concurrent successors converge? | Yes, while the predecessor exits within 120 s: one wins the lock, and the rest exit. They do not converge past 120 s: all give up, and none follows. | verified by experiment (runs 1, 3 vs 2) |
| 4 | `start` alive beside a down snapshot? | Reproduced once the heartbeat lapses: still alive in the snapshot 4–8 s after step-down, `down` 38 s after it. | verified by experiment (runs 2–4); read in source code |
| 5 | Is pending work preserved across stop/start? | With the default baseline, the edit is re-run. Under `lookup-only` the held file is stale, 0 are queued, and the wait returns on quiet. That happens without any version change too. | verified by experiment (runs 3, 4, 5), n=1 each |
| 6 | What held the reporter's daemon? | Not determined, because no process tree or tier state from the incident survives. A tier in flight is sufficient in the fixture. | inferred |

## Findings

**1. The step-down waits for the tier in flight.** `handlers.ts` (`step-down`) calls `onStepDown`. `daemon.ts` turns that into `#shutdown("superseded", …)` without `#cancelTiers()`, which only `onStop` calls. `#shutdown` sets phase `stopping`, stops timers, marks the exit, writes the note, then awaits `loop.close()`, which "waits for the tier in flight". The socket closes and the lock is released only after that. In run 2 the old 0.1.223 daemon stayed up from the note at 21:46:44.622Z until the hold was released at 21:49:11. Read in source code (`src/core/daemon/daemon.ts:711`, `handlers.ts` at both tags); verified by experiment.

**2. One successor per hook, bounded at 120 s.** `src/harness/shared/ensure.ts` (0.1.224) calls `stepDownIfOlder` at every boundary while `daemonLiveness(record)` is `alive`, and on `true` spawns `successor()` with `awaitLockMs: SUCCESSOR_LOCK_WAIT_MS = 120_000`. The comment notes that a stepping daemon's heartbeat goes stale, "so the request is not repeated past two intervals". Within those intervals it is repeated: six hooks over 3.4 s produced six `daemon $T/repo --await-lock 120000` processes in every 0.1.223→0.1.224 run. The control run, at one version, spawned none. In run 2, six notes `a successor daemon gave up: the lock was still held after 120000 ms; the next hook boundary starts one` came at 21:48:44–48Z. After the hold was released, the old daemon exited, and no daemon ran until a later boundary: status showed `Returned without a daemon`. Verified by experiment; read in source code.

**3. `start` reads a different signal than its snapshot.** `src/cli/start.ts` prints `Squeal daemon ${result}` from `ensureDaemon`, whose socket `ping` the stepping daemon still answers ("alive"). The snapshot below it reads the store record's heartbeat through `daemonLiveness`, which goes `down` once timers stop. Run 2 at +140 s and runs 3–4 at +38 s printed `Squeal daemon alive for …` and then `Daemon: no daemon running since 2026-10-19T21:46:44.600Z`, and `status --json` printed `{"state":"down",…}`. The named wait printed `the daemon's heartbeat went 146 s stale while its socket showed it alive …, so the wait went on`. `start` also spawns nothing in that state, so the waiting successors are the only way forward. Verified by experiment; read in source code.

**4. Pending work after the reporter's recovery.** With 0.1.224 `stop` sent to the stepping daemon, the tier is cancelled, the lock is released, and a waiting successor takes it (runs 3, 4). With the default baseline, the successor ran all four files as a baseline checkpoint at revision 1 (run 3: `8 passed`, checkpoint completed). Under `lookup-only` (run 4) the successor showed `0 passed, 0 running, 0 queued, 8 stale`. The key format moved 14→15 between the tags (`src/core/keys/key-format.ts`), so every prior check re-keyed to stale. `status --wait 60000` returned `on quiet: nothing the edits since revision 1 re-keyed is pending (1 test file)` while `tests/hold.test.ts`, the edited file in flight, had no result. That matches the issue's "all prior checks stale, no run open, files unqueued, the pending fast file no longer held the wait". The same-version control (run 5) printed `2 queued` at `start` and `0 queued, 2 stale` 3 s later with the hold still on, then the same quiet return. So losing the in-flight edit's file is a stop/restart behaviour under `lookup-only`, not an upgrade one. The upgrade adds the re-key of every other check. Verified by experiment, n=1 per run; why the queued file left the queue is not determined.

## Recommendation for Squeal

The coordinator decides C9 and C4/C7; this is the evidence. The tradeoff is a bounded handoff against losing an edit's result. Cancelling the tier at step-down and re-queuing it for the successor would bound the handoff the way `stop` already is. Waiting longer would need a successor wait at least `runner.timeoutMs`. The successor's lock wait should be one per worktree rather than one per hook. The handoff should hand pending edits over explicitly, because a `lookup-only` restart does not rediscover them (finding 4). For `start`, the "stopping" phase is already in the desk (`#setPhase("stopping")`), so its headline could name a handoff instead of "alive". Regression coverage: this probe's shape, with an edit's tier held across a step-down and six hooks, then the 120 s bound, then a `lookup-only` restart.

## Open questions

- What held the reporter's 0.1.223 daemon: an edit tier, a slow-tier run (81 optional slow files were pending), the escaped-children step or another shutdown step? Not determined, because no incident-time process tree or daemon log was captured. `squeal` has no `log` command (exit 2 in run 1).
- Why the control run's queued file went to stale without running under `lookup-only` (run 5). Not determined in the time budget; the scheduler's start scan at an unchanged revision is the place to read.
- Whether the incident's successors would have converged had the old daemon exited within their 120 s. The fixture says yes (runs 1, 3), but the reporter stopped it first.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/47 (read with `gh issue view 47`, 2026-10-19).
- Source at tags `squeal--v0.1.223`, `squeal--v0.1.224`: `src/core/daemon/daemon.ts` (`#shutdown`, `onStop`, `onStepDown`), `src/core/daemon/handlers.ts` (`step-down`), `src/harness/shared/ensure.ts` (`stepDownIfOlder`, `successor`, `SUCCESSOR_LOCK_WAIT_MS`), `src/core/daemon/ensure.ts` (`ensureDaemon`), `src/cli/start.ts`, `src/core/scheduler/scheduler.ts` (`close`), `src/core/keys/key-format.ts`.
- Reporter config: `/home/agent/projects/cezar/squeal.config.json` (`baseline.onStart: "lookup-only"`, `runner.timeoutMs: 600000`, `runner.tierSize: 12`).
- Probe and outputs: `docs/specifications/011-core/research/probes/issue-47/`.
