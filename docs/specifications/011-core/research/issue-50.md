# gh-50: work lost on a same-revision restart under `lookup-only`

Topic: [hearsay-tools/squeal#50](https://github.com/hearsay-tools/squeal/issues/50), brief `issue-50-brief.md`. Researcher, 2026-10-20, Squeal source and tag `squeal--v0.1.228` (worktree at `fc8bc758`), incident on 0.1.226 as the issue reports it.

Host at the time of the probe decision: 24 CPUs (`nproc`). One-minute load 14.00 at 15:18 CEST, then 58.08, 64.90, 61.30, 47.48 and 49.20 between 15:33 and 15:39 CEST, while a loop sampled every 5 s for 4 minutes and never saw it below 24. **The synthetic live reproduction was not run.** The brief skips live probes above the CPU count. `probes/issue-50/probe.sh` is written but not run.

## Answers

| # | Symptom or question | Verdict | Tag |
|---|---|---|---|
| 1 | Files queued (or `queued, promoted`) when the daemon stopped read `never run at this key: the baseline is lookup-only, so nothing queued it` after a same-revision start | On 0.1.226, yes: its start queued nothing under `lookup-only`. On 0.1.228 the source covers it: 011-33's `handover` re-queues every row left `queued` or `running`, and a signal or `sessions-gone` close leaves those rows as they are. Not reproduced live because of host load. | read in source code (0.1.226 and 0.1.228 diff, `handover.ts`, `scheduler.ts#close`); 011-33's `restart-handover.test.ts` covers the `stop` path only |
| 2 | Files running when the daemon stopped read `PASS -> UNKNOWN` with `vitest: unhandled error outside any test file: Error: [vitest-pool]: Worker forks emitted error.` and were not retried | Still open on 0.1.228. A crashed run marks its files `unknown` at the key, takes them out of the queue and sets `unknownKey`, so `handover` (which reads `pending !== null`) does not hand them over. The code is unchanged since 0.1.226. Nothing tells a crash during the daemon's own shutdown from any other crash. | read in source code; the crash's cause verified in the incident's own store and journal (below) |
| 3 | What killed the workers: "the session ended and a new one started"? | No. The cockpit's systemd unit `cezar.service` was stopped at 14:38:43 CEST (12:38:43 UTC), with `KillMode=control-group` and `KillSignal=15`. Every process in the unit's cgroup got SIGTERM at once: four Squeal daemons in four cezarion worktrees, and their Vitest fork workers. | verified by read-only queries of the incident's store, `journalctl --user`, `/proc/<pid>/cgroup` |
| 4 | Do 011-31 and 011-33 cover the issue? | 011-33 covers symptom 1. 011-31 (a step-down cancels its tiers) is not on this path. Neither covers symptom 2 or the "would have helped" items about wording and a bulk re-queue. | read in source code, board rows 011-31 and 011-33 |

## Evidence

### The original incident, from its own store (read-only)

`probes/issue-50/incident-store.cjs` opened `/home/agent/projects/cezar/.git/squeal/store.sqlite` read-only. Output, abridged:

```
daemon notes in the window:
 756d2134265bdae5 12:38:43.659 daemon stopped: signal
 d3657e5214af7a48 12:38:43.661 daemon stopped: signal
 d4adf2d72edc4dd9 12:38:43.677 daemon stopped: signal
 bd51318e786d84ed 12:38:43.733 daemon stopped: signal
runs ended in the window:
 756d2134265bdae5 rev 3  12:38:10.692..12:38:44.827 crashed 4 files
 d3657e5214af7a48 rev 2  12:36:30.053..12:38:45.228 crashed 4 files
 ba5234dcb8b7abbe rev 59 12:37:19.821..12:38:45.533 crashed 11 files
```

- Four daemons noted `daemon stopped: signal` within 74 ms, so a signal reached each daemon (`src/cli/daemon.ts`, `ownSignals` → `daemon.stop("signal")`).
- Three tiers in flight in three worktrees ended `crashed` 1.1 to 1.9 s later. All three run logs contain `Worker forks emitted error`: 12, 3 and 24 times (`grep -rho` over each `runs/<id>/`).
- `journalctl --user -u cezar.service`: `Oct 20 14:38:43 ... Stopping cezar.service - Cezar coding-agent cockpit...`. `systemctl --user show cezar.service`: `KillMode=control-group`, `KillSignal=15`, `ActiveEnterTimestamp=Tue 2026-10-20 14:40:14 CEST`.
- Every live Squeal daemon checked now sits in `/user.slice/user-1001.slice/user@1001.service/app.slice/cezar.service` (`/proc/<pid>/cgroup`, 4 of 4). Detached spawning (`setsid`) leaves the process session but not the cgroup.
- Not determined: which of these worktrees is the issue's "revision 16 at `4cf375f8`". No crashed run in the window is at revision 16. Its worktree may have been removed since, and its runs pruned with it. The incident's file names are spread over `756d2134` (`workflow-autonomous-parity`) and `ba5234dc` (`ci-wait-failure-parity`, `harness-parity`, `waits-parity`, `workflow-no-progress-parity`).

### Why the running files became UNKNOWN (0.1.228 source)

1. A signal calls `#shutdown("signal", ...)` without `#stopRequested`. `loop.close()` therefore waits for the tier in flight without cancelling it (`src/core/daemon/daemon.ts`, `#shutdown`). A `sessions-gone` exit takes the same call (`lifecycle.ts` `departure` → `context.shutdown`).
2. The same SIGTERM killed the fork workers. Vitest reports `[vitest-pool]: Worker forks emitted error` as an unhandled error. `buildReport` turns any unattributed unhandled error into `end: "crashed"` with no completed file (`src/runners/vitest/run.ts`).
3. `recordTier` puts each uncompleted file in `unknown` and calls `ledger.markUnknown(unknown, reason)` (`src/core/scheduler/tiers.ts`). That sets `file.unknownKey = key`, removes the file from the queue and syncs its phase (`ledger.ts` `markUnknown`). The rule there is `files.ts`: "The file is not queued again at this key, so a crashing file cannot loop; any change to its key, or an explicit `run --all`, queues it again."
4. On the next start, `handover` skips every row with `pending === null` (`if (row.pending === null || !ledger.files.has(id)) continue;`, `handover.ts`). The UNKNOWN files are not handed over, and under `lookup-only` nothing else queues them.

At step 3 the daemon was already stopping (`#setPhase("stopping")` and its note come before `loop.close`), so it could tell the crash came during its own shutdown. It does not use that. `git diff squeal--v0.1.226 squeal--v0.1.228 --stat` over the files above: `tiers.ts`, `run.ts`, `files.ts` and `cli/daemon.ts` are unchanged. `ledger.ts` gains only 011-38's read-as-one lookup, `lifecycle.ts` only a step-down comment, `daemon.ts` only 011-31's step-down cancel, and `scheduler.ts` only 013-02's touch barrier. Steps 1 to 4 are therefore as on 0.1.226.

### Why the queued files are covered on 0.1.228 (source)

- 0.1.226's `baseline` enqueued misses only in the `else` of `onStart` (011-33 notes, "Seams"). 0.1.228's `bootstrap.ts` calls `handover(context, ledger, previousKeys)` and under `lookup-only` queues exactly its misses, outside the abandoned baseline checkpoint. `restoreReruns` queues a pending new-failure re-run whatever the policy.
- `Scheduler.#close` clears no `queued` row. It records an owed explicit checkpoint, retires slow files and stops an install wait. The rows a no-cancel close leaves `queued` are therefore the predecessor's rows `handover` reads.
- 011-33's tests: `test/scheduler/handover-queued.test.ts` (five cases, fake runner, rows left by `close({ cancel: true })`) and `test/daemon/restart-handover.test.ts` (real CLI, `stop` with the edit's tier held, then `start`). Neither exercises a signal or `sessions-gone` close. That is the untested seam `probe.sh` targets. The claim that those rows stay `queued` is read in source only.
- Still uncovered, and not a 0.1.228 regression: promotions are not handed over (011-33 notes, "Promotions are still not handed over"), so a file that was `queued, promoted` comes back `queued` in its group, not promoted.

## Synthetic reproduction: designed, not run

`probes/issue-50/probe.sh <squeal.mjs> <deps dir> graceful|group`. It builds a `mktemp` repository with `lookup-only` and `tierSize: 2`, six test files held by a flag file, all importing `src/shared.ts`. It runs `start` and `run --all --wait`, turns the hold on and edits `src/shared.ts`, then waits for two files running and four queued. It sends SIGTERM to the daemon (`graceful`) or its process group (`group`), releases the hold, runs `start` at the same revision and `status --wait 60000` on the six files. Expected on 0.1.228 from the source above:

- `graceful`: all six end current. The two in flight store, and the four queued are handed over.
- `group`: the two in flight are UNKNOWN with the pool error and stay so, and the four queued run.

On the 0.1.226 bundle, the four queued would stay `never run at this key`. Bundles of both tags were extracted to `/tmp` with `git archive squeal--v<v> plugins/claude-code/dist`, and vitest 5 was installed to a scratch directory. Those `/tmp` copies were removed.

## Recommendation for Squeal

- Close symptom 1 against 011-33 (0.1.228), with one test gap: a signal or `sessions-gone` close followed by a start under `lookup-only`. `probe.sh graceful` is that test's shape, to run on a calm host.
- Keep symptom 2 open as its own row. A tier that crashes while its daemon is stopping is an interrupted run, not an environment failure. The tradeoff is D12's no-loop rule: a file whose run kills its own workers must not be re-queued forever. The evidence that decides it is the daemon's own stopping phase, set before the crash is recorded. The issue's fallbacks (wording that names a restart, a bulk re-queue of unknown named files) are product choices for the coordinator.
- Tell cezarion's owners: `cezar.service` with `KillMode=control-group` SIGTERMs every Squeal daemon and test worker its sessions started on each cockpit stop or restart. That is where these restarts come from, not session ends.

## Open questions

- Which worktree and run the issue's "revision 16" refers to: not determined, because no run at revision 16 in the window survives in the store.
- Whether 011-34's `start` finishing a handoff changes anything here: not determined. It is planned and unread for this path.
- Whether the four `queued` rows survive a signal close on a live daemon: read in source only, not run (load).

## Sources

- Issue: `gh issue view 50 -R hearsay-tools/squeal` (opened 2026-10-20T12:48:56Z).
- Spec: `docs/specifications/011-core/spec.md` C4 "Explicit checkpoints" (as amended 2026-10-20, 011-30 Q3 (a), Q5 (a)), C9; `status.md` lines for 011-30 and the human's 2026-10-20 "lookup only" answer; `tasks/011-33/notes.md`; `docs/board.md` rows 011-31 to 011-34.
- Source at `squeal--v0.1.228`: `src/core/daemon/daemon.ts` (`#shutdown`, `#cancelTiers`), `src/core/daemon/lifecycle.ts` (`departure`, `drainable`), `src/cli/daemon.ts`, `src/core/daemon/signals.ts`, `src/runners/vitest/run.ts` (`buildReport`), `src/core/scheduler/tiers.ts` (`recordTier`), `src/core/scheduler/ledger.ts` (`markUnknown`), `src/core/scheduler/files.ts` (`unknownKey`), `src/core/scheduler/handover.ts`, `src/core/scheduler/bootstrap.ts`, `src/core/scheduler/scheduler.ts` (`#close`, `owedWork`).
- Tests: `test/scheduler/handover-queued.test.ts`, `test/scheduler/rerun-restart.test.ts`, `test/daemon/restart-handover.test.ts`.
- Incident evidence: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (read-only) and its `runs/3121614c-…`, `runs/f195bd8d-…`, `runs/ec33c45f-…`; `journalctl --user -u cezar.service`; `systemctl --user show cezar.service`.
