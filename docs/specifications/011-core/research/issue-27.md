# Issue 27: a session-started daemon outlives a settled orchestrated worker

## Verdict and provenance

Not reproduced as stated on 0.1.199. In an isolated linked worktree laid out as cezar's, a session-started daemon exited 3.2 s after the last session's SessionEnd, and 5.3 s after the session's harness process died with no SessionEnd; with two sessions on the root it stayed up until the second ended. It survived only while the session's harness process stayed alive after a turn Stop (20 s observed, by spec until `daemon.unusedExitMinutes`, 30 min). In this no-runner fixture the daemon ended with its session; what the probe cannot settle is whether the reported worker's session had ended. The report's survival needs one of: the worker's Claude process still alive after its last turn (a turn ended, the session did not), a slow-file drain (C9, up to `daemon.idleExitMinutes`, 60 min), or a harness record the daemon cannot check. Which one held is not determined, because the cezarion sessions were not inspected.

Host load before the run: `1.58 2.58 4.33` on 24 CPUs (`nproc`); `2.42` at the first check; `7.28` at the probe's end. Exercised: the installed Claude Code plugin 0.1.199 (`~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/{session-start,stop,session-end}.mjs`, `dist/cli/squeal.mjs`; `squeal --version` prints `0.1.199`). Source read: this checkout, 0.1.203 (`package.json`) at `a0e2fc5a`, not exercised. Cezar read, not exercised: installed `@wjarka/cezarion` 0.16.0-dev.1886. No shared daemon or session was touched; no agent session was created.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a turn Stop end the session for the daemon? | No. Stop unregisters nothing; with the harness alive the daemon stayed 20 s | verified by experiment, 0.1.199 |
| 2 | Does the daemon exit after the last session's SessionEnd in a linked worktree? | Yes, 3.2 s (case C) and 3.3 s (case D, second session) | verified by experiment, 0.1.199 |
| 3 | With no SessionEnd, does a dead harness end the session? | Yes, 5.3 s after SIGKILL (cases A and B): heartbeat drop, then the 3 s grace | verified by experiment, 0.1.199 |
| 4 | Does one session ending stop a daemon another session shares? | No, stayed 12 s while the second was registered | verified by experiment, 0.1.199 |
| 5 | What can keep the daemon after the last session | A slow-file drain (≤ 60 min), a consumer whose harness is unrecorded or in another PID namespace (10 min waiterless or 12 h expiry), or a still-live harness (≤ 30 min unused bound) | read in source code, 0.1.203; spec 011 C9 |
| 6 | Does daemon survival alone make cezar refuse a resume? | Only if cezar's probe sees it: a recorded process of the generation alive, or any process whose cwd is under the worktree or scratch. The daemon's cwd is `<common-dir>/squeal/` except during a runner call; its esbuild and Vitest children hold the root | read in source code, cezarion 0.16.0-dev.1886; spec 011 C9 |
| 7 | Owning spec sections | 011 C9 (exit rules, drain, cwd), C8 (harness process record), 012 CC2 (SessionEnd unregisters), CC4 (liveness) | read in spec at `a0e2fc5a` |

## Findings

**Command.** From `/tmp`, invoking the probe by its absolute worker-worktree path: `node /home/agent/projects/squeal/.ai/cezar/worktrees/4df49f4e-06d0-465e-9fe2-3615260a875c/docs/specifications/011-core/research/probes/issue-27/probe.mjs /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.199`. For a rerun, substitute this checkout’s absolute path (the worker path is historical). Hooks get Claude Code's JSON on stdin with `CLAUDE_CODE_SESSION_ATTENDED` unset (no idle waiter, as headless). Each session's hooks run as children of its own fake harness process, so the registration records that process (C8 "Harness process"). Output, `probes/issue-27/output-run1.txt`, abbreviated:

```
=== A: turn Stop, harness alive, no SessionEnd
+3.3s  hook stop status 0
+23.3s A after Stop: daemon stays 1 for 20 s
+23.4s killed harness pid 2298256
+28.8s A after harness killed: daemon 1 -> 0 after 5.3 s
=== B: turn Stop, harness killed, no SessionEnd
+38.4s B after harness killed: daemon 1 -> 0 after 5.3 s
=== C: turn Stop, SessionEnd, harness exits
+45.8s C after SessionEnd: daemon 1 -> 0 after 3.2 s
=== D: two sessions share the root
+62.4s D after first SessionEnd: daemon stays 1 for 12 s
+66.0s D after last SessionEnd: daemon 1 -> 0 after 3.3 s
+66.7s leftover daemons: 0
```

**Session end against turn Stop.** SessionEnd calls `endSession` → `unregisterSession` (`src/harness/shared/session.ts:84`, `src/harness/shared/sweep.ts:19`), which unregisters every consumer of the session and stamps the departure. Stop ends a turn and registers or unregisters nothing (012 CC2). A harness that dies without SessionEnd is dropped at the next heartbeat by `dropGoneHarnesses` (`src/core/delivery/expiry.ts`), "since a killed harness runs no SessionEnd". The departure check (`src/core/daemon/lifecycle.ts:262`) then exits with `sessions-gone` once none is registered for `departureGraceMs` (3 s). Read in source code at 0.1.203, matching the 0.1.199 timings observed.

**What survives the last session, by spec.** Three paths, read in source and C9, none exercised: (a) `drainable(context)` non-null: "When the 3 s end with slow files pending, queued or running … the daemon drains them before it exits", for at most `daemon.idleExitMinutes` (60 min) after the departure. The issue's second report, where a review worker's `status --wait` selected e2e consumers and a browser test env booted, fits slow work in flight. (b) A consumer with no recorded harness (no `/proc`, a walk that fails) or one in another PID namespace is "left to the expiry above": 10 min once its waiter lock is free, else 12 h. A sandboxed hook in its own PID namespace would be this case; not determined whether cezar's workers run so. (c) A session not ended at all: a live harness keeps its consumer, and the daemon stops at `daemon.unusedExitMinutes` (30 min) with no edit, tier or request. Every path is the spec doing what it says.

**Daemon survival against cezar's refusal.** `beginWorkerExecution` (cezarion `dist/workflows/run.js:604`) refuses with `WorkerOrphanAliveError` when `inspectExecutionGeneration` finds the previous generation alive. A failed admission is then filed as `worker execution checkpoint unavailable` (`run.js:2188`), the text the issue saw (cezarion#867). `inspectGeneration` (`dist/delegation/process-liveness.js:213`) counts the generation's recorded live processes plus every process "whose readable cwd is under `paths`", the worktree and scratch locations. A detached daemon is not in a process group cezar spawned, and per C9 it moves to `<common-dir>/squeal/`. It holds the root only while a runner call is in flight ("the daemon returns to `<common-dir>/squeal/` when none is in flight"), and its esbuild service and Vitest workers start with the root as cwd. So an idle daemon at rest in `.git/squeal` should not hold the worktree for cezar's cwd scan. One running tests, or with esbuild alive, does. The comment's daemon showed cwd `.git/squeal` yet was named a holder. Whether cezar named it from its cwd at another moment or from the generation's recorded processes is not determined. Inferred from both sources; nothing here ran cezar.

## Uncertainty against the reported sessions

The fixture had no `node_modules`, so no runner, no slow tier and no drain. Its harness was a fake process, not `claude`. It had no idle waiter and no sandbox or PID namespace. It did not run cezar, so whether cezar kills the worker's Claude process when a worker settles, and whether SessionEnd runs then, is not observed. The reported plugin version is assumed to be the host's 0.1.199, not determined.

## Recommendation for Squeal

Do not treat #27 as "the daemon outlives its session": the daemon ends 3 to 6 s after the last session ends, by unregister or by harness death, in a linked worktree too. The open cause is one of the three C9 survival paths. The likeliest from the reports is the slow-file drain or a session that never ended. Before any change, record in the next refusal: `squeal status` in the worker worktree (registered consumers, pending slow files), the notes since the last turn (`the last session ended with … pending` names a drain), whether the worker's Claude pid is alive, and the daemon's and its children's cwd. A fix is then a C9 rule, for example that a drain does not hold an orchestrated worktree, or a C8 rule for an unrecordable harness; this probe does not rule out a lifecycle defect in the reported setting. Existing holds stand.

## Open questions

- Whether a settled cezar Claude worker's process exits, and whether SessionEnd runs, at settle: not determined, because no cezar session was inspected or created.
- Which survival path held in the two 2026-10-17 refusals: not determined, because their notes and status were not captured.
- Whether cezar's holder list came from a cwd scan during a runner call or from recorded processes: not determined, because cezar was read, not run.

## Sources

- hearsay-tools/squeal#27 and its comment, `gh issue view 27 --repo hearsay-tools/squeal --comments`, read 2026-10-17.
- Spec 011 C8, C9 (`docs/specifications/011-core/spec.md` at `a0e2fc5a`); 012 CC2, CC4.
- `src/core/daemon/lifecycle.ts`, `src/core/delivery/expiry.ts`, `src/harness/shared/session.ts`, `src/harness/shared/sweep.ts`, `src/harness/claude-code/hooks/session-end.ts` at `a0e2fc5a` (0.1.203).
- Installed plugin `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/`.
- Installed cezarion 0.16.0-dev.1886: `dist/workflows/run.js:604,714,820,2188`, `dist/delegation/process-liveness.js:206-240`.
- Probe: `research/probes/issue-27/` (`probe.mjs`, `harness.mjs`, `output-run1.txt`, `README.md`).
