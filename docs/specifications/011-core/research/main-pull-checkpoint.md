# Did Cezar main reset, or never finish?

Brief: `main-pull-checkpoint-brief.md`. Researcher, 2026-10-26, about 12:19–12:33 UTC. Read-only:
the main store `/home/agent/projects/cezar/.git/squeal/store.sqlite` opened with `node:sqlite`
`readOnly` (`probes/main-pull-checkpoint/q.mjs`), one `squeal status` in the main checkout at about
12:21 UTC, and the source at tag `squeal--v0.1.341` (`git archive`). The main daemon is 0.1.341
(started 12:16:21 UTC). The CLI on the host reported 0.1.342 by 12:21. No test, build, restart or
checkpoint was started. All times are UTC (the host clock is CET, UTC+1).

**Verdict.** It did not reset in the sense of lost results. The full run that started after the
pull never finished: it ran 663 of its 703 files, then was carried over by two daemon stops and
replaced by a new, larger `run --all` request at 12:16:51. No full run completed since revision
137 (completed 03:15:17). The current-count drop comes from an input change: a `pnpm install` in
main at 12:03:53 changed the installed packages, and that changed the keys of most files. A
terminal `squeal run --all` is not cancelled because no session is open. It is cut short only when
the daemon had a session that then ended: then the daemon exits after a bounded drain and the
next daemon resumes the checkpoint.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1a | Did a checkpoint complete since 09:13? | No. The last completed one is `16b5b7b0` (`run --all`, revision 137, 22:47:18 on 10-25 to 03:15:17). | verified by experiment (store) |
| 1b | What happened to the 09:08 run? | `3cbf259d` (revision 159, 703 files) ran 625 files at revision 159 (09:08:31–12:04:33) and 38 at revision 162 (12:04:34–12:11:57). It stayed open through the 12:12–12:14 stop and was abandoned at 12:16:51.384, 1 ms before `ceb69f3a` (revision 162, 983 files) started. | verified by experiment (store) |
| 1c | Why did counts drop? | Input change: revision 161 at 12:03:53 changed `node_modules/.pnpm/lock.yaml` from `0c5cc105` to `fb667540` (main's install caught up with the pulled lockfile). Revisions 160 and 162 only change `.ai/qa/test-env.json`. | verified by experiment (store); effect on keys read in source (C11) |
| 1d | Runtime upgrades and interrupted work | Upgrade 0.1.339 → 0.1.341 at about 12:12 (brief's notes) restarted the daemon; its baseline `94b185da` at 12:13:00 is lookup-only and abandoned at once. The daemon then stopped at 12:14 by the 60 s slow-file rule. The next daemon started at 12:16:21. At 12:17:18 a 200-file tier started; it crashed at 12:18:37 (see open questions). | verified by experiment (store, status); upgrade time from the brief only |
| 2 | Terminal `run --all` with no session | Not cancelled when no session ever registered with that daemon: it exits only after `daemon.idleExitMinutes` (60 min default) with no activity. When a session had registered and ended, the daemon drains pending slow files and owed checkpoints, then exits when done, at the 60 min bound, or when no slow file ran for 60 s after the fast work. A terminal request is not a consumer and does not cancel that exit. The checkpoint is then owed and resumed by the next daemon. | read in source code (0.1.341) |

## 1. Timeline at main (`b7555ac0d0f19f40`)

| UTC | Event | Evidence |
|---|---|---|
| 10-26 03:15:17 | `run --all` `16b5b7b0` at revision 137 completed (256 files) | `checkpoints` |
| 09:08:07 | Revision 159, pull to `ecdde7685` | `revisions` |
| 09:08:31 | `run --all` `3cbf259d` at revision 159, 703 files | `checkpoints` |
| 09:33–12:03 | 25 baseline checkpoints, each abandoned at once (lookup-only restarts of the daemon) | `checkpoints` |
| 12:03:46–12:04:07 | Revisions 160–162; 161 is the install change | `revisions` |
| 12:04:34–12:11:57 | 38 more runs of `3cbf259d`, now at revision 162 | `runs` |
| about 12:12 | Upgrade to 0.1.341 (daemon restart) | brief's notes only |
| 12:13:00 | Baseline `94b185da` at revision 162 (983 files), abandoned at once | `checkpoints` |
| 12:13–12:14 | Last session ended with 47 slow files and the checkpoint pending; stopped after no slow file ran for 60 s, 47 left queued | brief's notes; text matches `waitedText` in `lifecycle.ts` |
| 12:16:21 | Daemon 0.1.341 started | `worktrees.daemon_started_at` |
| 12:16:48 | Baseline `2a3da24a` (983 files), abandoned at once | `checkpoints` |
| 12:16:51.384 / .385 | `3cbf259d` abandoned; `run --all` `ceb69f3a` at revision 162, 983 files, started | `checkpoints` |
| 12:16:52–12:17:23 | 2 runs, 201 files, completed (the brief's "201/983") | `runs` |
| 12:17:18–12:18:37 | 1 run, 200 files, `crashed` (the brief's "200 running") | `runs`, status |
| about 12:21 | 551 of 983 files done; 145 running, 287 queued, 350 unknown; no consumer registered | status, `consumers` empty |

The 983 files are a new request, not the owed one. The owed checkpoint had at most 40 files left
(703 − 663 runs). `queueFullSuite` (`checkpoint-requests.ts`) joins the open checkpoint only when
it `covers` every requested file; otherwise `Checkpoints.start` abandons the open one
(`checkpoints.ts`, "Records a new checkpoint, abandoning the open one"). Who sent the 12:16:51
request is not determined: the store has no record of the requester. No result is lost when a
checkpoint is abandoned; only its completion record is.

## 2. Lifecycle in 0.1.341 source

- **Owner.** The daemon owns the checkpoint. `squeal run --all` sends one socket request
  (`src/cli/run.ts`). Without `--wait` it exits 0 once the checkpoint is recorded. With `--wait`
  it polls the store until the checkpoint ends or the deadline passes. Exit 0 = completed with
  every file current and no known failure; 1 = known failures, or (without `--wait`) no daemon or
  request failed; 3 = no verdict (abandoned, daemon stopped, revision moved, deadline passed).
  At the deadline it prints "the checkpoint goes on in the daemon": the wait ends, the work does
  not. Ctrl-C on the CLI does not cancel the checkpoint (no cancel request exists in `run.ts`).
- **No session ever.** `lifecycle.ts` idle check: with no consumer and none ever seen, the daemon
  exits after `idleMs` with no activity ("daemon stopped: idle for … with no registered
  consumers"). Running tiers count as activity.
- **Last session ended.** After `departureGraceMs` (3 s) the departure check drains: pending slow
  files and owed checkpoint work (`drainable`, `owedWork`), with the backlog paused. It exits
  when that work is done, at `idleMs` after the departure, or when the slow lane waited 60 s with
  the fast work done (`DRAIN_SLOW_WAIT_MS`, row 011-163). Only a new consumer cancels the drain.
- **Stop.** `Checkpoints.owe()` leaves an open `run --all` record open and writes it as owed; a
  baseline is abandoned. The next daemon's bootstrap `takeOwed` / `resumeOwed` resumes the owed
  files. The CLI then says "the next daemon resumes it, and `run --all --wait` then waits for it".

**Defect or not.** The 12:14 stop is the designed drain bound, not a defect. One gap fits the
design but surprises a terminal user: a terminal `run --all --wait` against a daemon in its drain
does not keep it alive, so the wait ends with "the daemon stopped" (exit 3) while slow files wait.
That holds only when a session had used that daemon (tag: read in source code; not run).

## Advice for terminal-only runs

1. With no agent session open, run `squeal run --all --wait` in the main checkout and leave it.
   If no session was ever registered with that daemon, the run goes on until done.
2. If it prints "the daemon stopped before it ended", run the same command again. The next daemon
   resumes the owed files; results already recorded stay.
3. A `--wait <ms>` deadline only ends the wait. Read progress later with `squeal status`.
4. Do not send a second `run --all` while one is open unless the revision changed: a request that
   is not covered replaces the open checkpoint and its count starts again.

## Open questions

- The 200-file tier crash at 12:18:37: status reports "Failed to load custom CoverageProviderModule
  from …/plugins/cache/hearsay/squeal/0.1.341/dist/coverage/provider.mjs". The file exists at
  12:21. The CLI launcher `~/.local/bin/squeal` was rewritten at 12:16:34, and the CLI then ran
  0.1.342 while the daemon and Claude Code plugin are 0.1.341. A link to the update is likely in
  time but not determined. Failed PostToolUse hooks in Cezar task `c8bb31ae` may share the cause
  (a plugin and CLI version change at the same time); this was not checked.
- Who started the 12:16:21 daemon and the 12:16:51 request: not determined, because the store does
  not record the requester.
- Why no slow file ran for 60 s at 12:13–12:14 (capacity, host load, or fast work): not determined
  within the bound.

## Sources

- Store: `/home/agent/projects/cezar/.git/squeal/store.sqlite`, tables `checkpoints`, `runs`,
  `revisions`, `worktrees`, `consumers`.
- Source at tag `squeal--v0.1.341`: `src/core/scheduler/checkpoints.ts` (`start`, `owe`,
  `takeOwed`), `src/core/scheduler/checkpoint-requests.ts` (`queueFullSuite`, `resumeOwed`),
  `src/core/scheduler/bootstrap.ts:219–227`, `src/core/daemon/lifecycle.ts` (idle check,
  departure drain, `DRAIN_SLOW_WAIT_MS`), `src/cli/run.ts` (exit codes, verdict lines).
- Prior: `main-pull-reuse.md`. Probe: `probes/main-pull-checkpoint/`.
