# Research 011-256: a browser fixture server outlives Squeal and blocks worker cleanup (gh-107)

Researcher cad75d7d, 2026-10-26. Brief: `issue-107-brief.md`. Squeal 0.1.350 on the host (the reports used 0.1.346 to 0.1.349); experiments used this tree's `plugins/claude-code/dist` on 83a1dec6e, Vitest 5.0.3. Cezarion read at `main` ecdde7685 (2026-10-26). Host: 24 CPUs, load 11 to 20 during the work.

**Verdict.** Squeal's daemon starts the server, but Squeal does not own the server's lifetime. Cezarion's e2e `globalSetup` runs inside the daemon process (Vitest's main process) and boots the server detached, in its own process group. On purpose, its teardown only releases a lease. A cezarion watcher stops the server 30 minutes after the last lease holder goes, or when the checkout is deleted. The departure drain (C9) runs the slow e2e files after the worker session ends, so the server boots minutes before the parent cleans up. Governed destroy refuses to delete a tree that a live process holds, so the watcher's "checkout deleted" stop cannot fire. The server blocks cleanup until the 30 idle minutes pass. Every Squeal exit path leaves the server the same way. No Squeal exit skips a stop that would otherwise happen.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Who starts it | Squeal's slow tier: the e2e project's `globalSetup` (`packages/web/e2e/environment.ts`) runs `test-env-up.sh` inside the daemon process. The agent does not start it. Both live servers on the host carry the daemon's scratch `TMPDIR` and no `SQUEAL_*` name. | verified by experiment (E1, E2); read in source code |
| 2 | Why it survives | Nothing on that path stops it: the teardown releases a lease only; `test-env-down.sh` is not called; the watcher waits 30 idle minutes. Every Squeal exit leaves it: stop, drain end, idle, step-down, cut run, signal. | verified by experiment (E1 for stop and drain-close, E3 for the watcher); inferred for the other exits |
| 3 | How often | Reports: 5 of 60 finished workers (1/4, 3/20, 1/36). Each server was 3.7 to 11.7 min old at the refused destroy and booted 12 s to 5.6 min after its worker's session ended. On the host now: 2 servers. 1 is in a finished tree and was stopped by its watcher at 17:52:25Z, 31 min after that session ended. 1 is in the main checkout, whose daemon is alive. Per-worker counts of who ran browser files: not determined (see below). | read from logs; verified by experiment (E2, E3) |
| 4 | What Squeal sees | Row 011-245's reading would not name it. `squeal stop` prints "Squeal daemon stopped" (exit 0) and then "No daemon running" (exit 0) while it lives. `squeal ps` does not list it. | verified by experiment (E1, stop); read in source code (011-245 reading, ps) |

## Findings

**Q1. Who starts it.**
- `packages/web/e2e/vitest.config.ts` sets `globalSetup: ['./environment.ts']`. Its comment says "Project globalSetup prepares the environment when Squeal runs a browser file directly." `environment.ts` `setup()` runs `exec('sh', ['.ai/scripts/test-env-up.sh'])`. That script runs `test-env-lease.mjs detach-app`, which starts the app with `startOwnedGroup(...)` and `child.unref()`. That gives a new process group, cwd the root and output to `.ai/qa/test-env-app.log`. It also starts a watcher (`watch-app`) with `cwd: tmpdir()`. cezarion `squeal.config.json` puts `packages/web/e2e/*.e2e.ts` in `slow.include`. *Read in source code, cezarion ecdde7685.*
- Squeal runs Vitest in the daemon process (`createVitest` in `src/runners/vitest/adapter.ts:217`). A daemon sets its own `TMPDIR` to `/tmp/squeal-<uid>/tmp/<sha256(repository-id \0 root)[:16]>` (`adoptScratch`, `src/core/daemon/scratch.ts:181`). Only test workers get `SQUEAL_DAEMON_CHILD` and `SQUEAL_OBSERVE`. So a process that a `globalSetup` starts carries the daemon's scratch `TMPDIR` and neither Squeal name. *Read in source code.*
- **E1.** A fixture with that shape ran one slow file under Squeal. The setup ran in the daemon's PID. The server had `TMPDIR` equal to the daemon scratch of its root, `squealVars=[]`, its own process group and cwd the root. *Verified by experiment, 17:51Z, load 15.7.*
- **E2.** On the host at 17:51Z, each of the two live servers had a watcher whose cwd (`os.tmpdir()` of the booting process) equalled the Squeal scratch key of the server's root:
  - `a6d4e254` (the parent task that filed the comments): age 2,785 s, no live daemon, scratch directory deleted.
  - The cezar main checkout: age 2,427 s, daemon 157068 (0.1.347) alive.

  Neither server's env has a `SQUEAL_*` name. *Verified by experiment.* The main-checkout server has `CODEX_SESSION_ID`, probably because a daemon inherits the env of the Codex hook that spawned it. *Inferred.*
- The affected workers' own commands only read the scripts (`cat`, `git diff`). Each server booted after its worker's last log event:

  | Worker | Session ended | Server booted | Refused destroy | Server age at destroy |
  |---|---|---|---|---|
  | 69610ddd | 15:56:13 | 15:59:34 | 16:11:13 | 11.7 min |
  | 07939555 | 16:00:49 | 16:01:56 | 16:11:14 | 9.3 min |
  | df3e4d87 | 16:02:00 | 16:07:35 | 16:11:18 | 3.7 min |
  | 13753c76 | 17:12:20 | 17:12:32 | 17:16:52 | 4.3 min |

  Times are UTC. Boot times come from `/proc` start ticks in the parent's retained evidence (`/tmp/cezar-review-effort-a6d4e254-*/cleanup/`); session ends come from cezarion `runs/<id>.ndjson`. C9's departure drain runs slow files after the last session goes, which explains the order. *Read from logs; inferred for the drain as the runner.*

**Q2. Why it survives.**
- The teardown that `setup()` returns calls `restoreRegistry`, `restoreTmpdir` and `lease.release()`. It never stops the app. The comment says "the next run can reuse it". *Read in source code.*
- The lease records `pid = process.pid`, which is the daemon here. `liveHolders` drops a holder row once its PID is dead. So a teardown that never ran (SIGKILL, a forced cut) frees the lease within one 30 s watcher poll, and a clean teardown frees it at once. *Read in source code.*
- `watchApp` stops the app on: checkout deleted, `.ai/qa` deleted, served project deleted, or no lease holder for `TEST_ENV_IDLE_EXIT_MINUTES` (default 30), polled every 30 s. This came from cezarion#1448 (closed 2026-10-22). *Read in source code.* **E3:** the watcher stopped the `a6d4e254` server at 17:52:25Z ("idle 30 minutes"). Its daemon had drained after that session ended at 17:21:19Z. Surviving trees' watch logs hold 9 more "idle 30 minutes" stops. *Verified by experiment.*
- `test-env-down.sh` runs `stop-app`. On cezarion main only `e2e-lanes.mjs` calls it, so neither the slow tier nor `e2e.sh` does. *Read in source code.*
- Squeal closes the slow instance when the pass drains, when a hold begins, or after 60 s with no slow tier (`slow-instance.ts`, row 011-211). That close runs the teardown. In E1 the teardown line appeared before `squeal stop`. *Verified by experiment.*
- So no Squeal exit skips a stop. Stop and drain-close are verified in E1. Idle exit, step-down, a cut run and a signal stop are inferred: in each one the teardown either runs (lease released) or does not (the lease row dies with the daemon PID), and the server lives on until the watcher's 30 minutes pass.
- Squeal's stop guarantee covers only processes with its `SQUEAL_DAEMON_CHILD` token or in its process group (C9, `src/core/daemon/escaped.ts`). This server has neither. *Read in source code; E1.*

**Q3. How often.**
- Reports: 1 of 4 (0.1.346), 3 of 20 and 1 of 36 (0.1.349). That is 5 of 60 finished report-only workers. The parent's cleanup files hold 13 "No daemon running" and 7 "Squeal daemon stopped" for the 20, and 36 "No daemon running" for the 36. *Read from logs.*
- The cezar store's run logs hold 20 e2e file runs between 15:50 and 16:12Z, 43 between 16:55 and 17:17Z, and 2,465 in the 24 h to 17:50Z. These cover the whole repository (main checkout, parent and workers). *Read from logs (`<common-dir>/squeal/runs/*/report.json`).*
- Host now: 27 cezar worktrees. 6 ever booted the e2e environment (`.ai/qa/test-env-app.log`), 4 of them in the last 24 h. 2 servers are live, as listed in E2. *Verified by experiment.*
- **Not determined:** how many of the 60 workers ran a browser file. Run logs do not name their worktree. The run-to-worktree map is in the live cezar store, which this research did not open. The rule implied by the findings: a worker is blocked when its drain ran an e2e file within 30 minutes before its destroy. *Inferred.*

**Q4. What Squeal sees.**
- Row 011-245 reads processes only right before a forced cancel. It counts a worker's descendant, a member of a worker's group or session, or a process whose env holds `SQUEAL_OBSERVE` (`heldByRun`, `src/core/daemon/outlived.ts:89`). This server comes from the daemon's own `globalSetup`, not a worker. It is in its own group and its env has no `SQUEAL_*` name. Its run usually completes, so no cut happens. It would not be named. *Read in source code; env names verified in E1 and E2.*
- `squeal stop`: E1 printed `Squeal daemon stopped for <root>` and exit 0, then `No daemon running for <root>` and exit 0, with the server alive both times and reparented to PID 1049. *Verified by experiment.*
- `squeal ps` lists marked processes and a daemon's subtree (`src/core/ps/processes.ts`). In cezarion the spawner exits at boot, so the server's parent is 1049 from the start and it carries no mark. It is not listed. `squeal ps` was not run, because it opens every host store read-only (`src/core/ps/work.ts`) and the brief forbids opening live stores. *Read in source code.*

## Recommendation for Squeal

The defect is a lifetime split, not a missed Squeal stop. Squeal hosts the setup that boots the server, and cezarion keeps the server warm for 30 minutes on purpose. The decision for the fix row is who ends the server early when a tree is about to go:

- **Cezarion's side.** For example, a governed destroy or the slow-tier teardown runs `test-env-down.sh`, or Squeal-run setups use a short `TEST_ENV_IDLE_EXIT_MINUTES`. This fixes it at the owner of the reuse rule, with no new Squeal duty.
- **Squeal's side.** Squeal could report or stop processes that hold the root after its daemon is gone. That would make C9's sentence "no process of Squeal's has its working directory … under the root" cover what a `globalSetup` starts. But Squeal would then judge processes that carry no mark. The 011-245 decision was report, not stop.

## Open questions

1. Daemon exit reason per affected worker (drain end vs idle): this is in the live store's notes and was not read.
2. Which of the 60 workers ran a browser file (see Q3).
3. Whether to cover a project's `globalSetup` children in C9's stop guarantee is a human decision. The scope of row 011-245 is the precedent.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/107 and its 2 comments. cezarion#1448: https://github.com/hearsay-tools/cezarion/issues/1448.
- Cezarion `main` ecdde7685: `packages/web/e2e/vitest.config.ts`, `packages/web/e2e/environment.ts`, `.ai/scripts/test-env-up.sh`, `test-env-down.sh`, `test-env-lease.mjs` (`acquireTestEnvLease`, `liveHolders`, `detachApp`, `watchApp`), `.ai/scripts/e2e-lanes.mjs`, `squeal.config.json`.
- Squeal: `src/core/daemon/scratch.ts`, `escaped.ts`, `outlived.ts`, `slow-instance.ts`, `src/runners/vitest/adapter.ts`, `src/runners/observe/runtime.ts`, `src/core/ps/processes.ts`, `work.ts`. 011 C9 and 004 D2 in the specs.
- Logs: `~/projects/cezar/.ai/cezar/runs/{a6d4e254,69610ddd,07939555,df3e4d87,13753c76}-*.ndjson`, `/tmp/cezar-review-effort-a6d4e254-{expanded,five-prs}/cleanup/`, `~/projects/cezar/.git/squeal/runs/*/report.json`, and each tree's `.ai/qa/test-env-watch.log`.
- Probes: `probes/issue-107/` (E1 `run.sh` and `fixture/`, E2 `survey.sh`; E3 is the loop in the probe README).
