# Issue 109 reproduction: "no daemon is validating" while the daemon is alive

Issue: https://github.com/hearsay-tools/squeal/issues/109 ("Distinguish delayed heartbeats from stopped validation"), read 2026-10-27 with `gh issue view 109 -R hearsay-tools/squeal --comments`. It is open, with a body and two comments. Source examined at `faa43f882` (tag `squeal--v0.1.365` + 1 docs commit). The probe ran the bundles committed at that revision, `plugins/claude-code/dist` 0.1.365, on 2026-10-27 02:42–02:44 UTC. Host load before the live probe was 15.57 / 14.61 / 14.71 on 24 CPUs (`uptime`, `nproc`), which is below the CPU count, so the live probe ran. During the run, load was 8.52 / 11.67 / 13.55. The probe makes no CPU load: it stops the daemon with `SIGSTOP`.

Brief: the coordinator's task message (this task, `5e6142fc`). Related: `docs/specifications/004-slow-suites/research/issue-12.md` and task 004-66 (a wait goes on through a stale heartbeat when the socket answers).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can a live daemon with a delayed heartbeat produce "no daemon is validating" and then "a daemon is validating again"? | Yes, deterministically. One daemon pid stayed alive. About 10 s after its last heartbeat, a Claude Code PostToolBatch boundary delivered `SQUEAL · no daemon is validating at revision 1`, and `status --json` gave `daemon.state: "down"`. The first boundary after `SIGCONT` delivered `SQUEAL · a daemon is validating again at revision 0` (run 1). In run 2 a test result arrived in the same boundary, and the title was `1 check changed` instead. | verified by experiment, 0.1.365 |
| 2 | Does a `status --wait` at the same time correctly report a stale heartbeat with a live socket? | Yes. The wait started at the stall, went on, and ended after 19.1 s with the result. Its line said `the daemon's heartbeat went 14 s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on`. This is the text of issue 109. | verified by experiment, 0.1.365 |
| 3 | Why do the two disagree? | Delivered text and status judge liveness from the heartbeat only: `now - heartbeatAt <= heartbeatIntervalMs * 2` (`daemonLiveness`, `src/core/delivery/liveness.ts`; `HEARTBEAT_GRACE_INTERVALS = 2`, `src/core/status/snapshot.ts:63`). `livenessChange` tells each consumer every change of that judgment once. Only the wait asks the socket (`watchDaemon`, `src/cli/wait-liveness.ts`, task 004-66). | read in source code, `faa43f882` |
| 4 | Is this the specified behaviour? | Yes. 011 C8 as amended 2026-10-25 lists "a daemon down with no successor (a stale heartbeat, …)" as news. 011 C9 as amended for review 0.1.355 B1 says "the boundary that spawns says no daemon is validating, as before" with a stale record. No clause tells a hook to ask the socket before it says so. | read in source code (spec text, `docs/specifications/011-core/spec.md` C8, C9, at `faa43f882`) |
| 5 | Does the boundary start a second daemon during the stall? | At the end, one daemon process remained in the fixture (`pgrep -fc`). The probe does not show whether a hook spawned a daemon that lost the lock and exited. | not determined, because the probe did not trace spawns |
| 6 | What delayed the heartbeat in the cezarion incident? | Not determined, because the incident recorded no daemon log, no `--json` at the transition and no lock holder. issue-12.md showed that a store write lock held for more than 10 s and an event-loop stall give the same lapse. A load of 30.45 on 24 CPUs can give either. | inferred |

## Findings

### 1. Reproduction (verified by experiment, 0.1.365)

Command, from the worktree root:

```sh
VITEST_NODE_MODULES=$PWD/node_modules \
  docs/specifications/011-core/research/probes/issue-109/probe.sh \
  "$PWD/plugins/claude-code/dist/cli/squeal.mjs" "$PWD/plugins/claude-code/dist" 14
```

Output: `probes/issue-109/output-0.1.365-sigstop.txt`. Timeline of run 2 (UTC):

- 02:44:11.356, the last heartbeat before the stall. The test edit is pending. `SIGSTOP` at about 02:44:12.6; the wait starts at the same time.
- 02:44:12.6–02:44:19.6, four boundaries. Status reads `alive`, with the heartbeat aging. The boundaries are silent.
- 02:44:21.748, boundary B5: `SQUEAL · no daemon is validating at revision 1 | … No daemon has validated since 2026-10-27T02:44:11.356Z`. The process state is `Tl` (stopped, same pid). `status --json` gives `{"state":"down","since":1793069051356}`.
- 02:44:24.110, boundary B6: `SQUEAL · Not validated: no daemon has validated since …`.
- 02:44:26.477, `SIGCONT`. Boundary C1, 2 ms later, delivers the run's result. `status --json` gives `alive` again.
- 02:44:31.860, the wait ends: `after 19.1 s; the daemon's heartbeat went 14 s stale while its socket showed it alive …, so the wait went on`.

Run 1 (same probe, no Vitest in the fixture, not kept as a file) gave the explicit pair: B4 `SQUEAL · no daemon is validating at revision 0`, then C1 `SQUEAL · a daemon is validating again at revision 0`. The same pid ran throughout.

So for one stall, the agent reads "no daemon" from its hook and "socket alive" from its wait. Both are correct by their own rule.

### 2. Two rules, one daemon (read in source code, `faa43f882`)

- Hook delivery: `readLiveHeader` and `livenessChange` (`src/core/delivery/liveness.ts`) call `worktreeLiveness`, which uses the heartbeat age only. The record is not cleared during the stall, so `asStopped`, `asRested` and the start marks do not apply. The title comes from `livenessTitle` (`src/core/delivery/format.ts:472`).
- Status (`squeal status`, `--json`): the same `daemonLiveness`, so status and headers agree. This was intended (001 D10, "so a header and status never disagree").
- The wait: `watchDaemon` asks the socket when the heartbeat is stale. An answer, or a connection that is accepted but not answered (a stalled event loop, as under `SIGSTOP`), is `lapsed`. The wait goes on and records the lapse (`lapseText`, `src/cli/status-wait-lines.ts:454`).
- The ensure step: `ensureDaemon` pings the recorded socket before it spawns (`src/core/daemon/ensure.ts:97`). The daemon lock refuses a second daemon. Because of this, the `squeal start` in the incident answered "Squeal daemon alive". issue-12.md observed the same.

### 3. Limits versus the original incident

- Cause of the delay. The probe uses `SIGSTOP`, a full event-loop stall with no load. The incident was on a host at load 30.45 / 20.21 / 18.18 on 24 CPUs, in a large repository (7,459 pending checks), and its cause was not recorded. A held store write lock (issue-12.md, finding 1 B) is the other known way to get the same lapse. This probe did not run it again.
- Harness. The incident was Codex on 0.1.359. The probe drove the Claude Code bundles of 0.1.365. Both harnesses use `src/harness/shared/deliver.ts` and the same `livenessChange`, so the same text is inferred for Codex; it was not run. The liveness code path from 0.1.359 to 0.1.365 was not compared (`git diff` of the tags was not read).
- The stall in the probe is 14 s. The incident's wait reported 15 s. The second comment's wait reported 48 s. The rule is the same for every length above 10 s.
- The first comment on the issue (2026-10-27 00:50 UTC, cezarion#1936) is a different case. There, status said `down` with no daemon until an explicit `squeal start`. That start exited 3 ("still starting after 30 s"). It looks like a stop, not a heartbeat lapse. This probe does not cover it.
- The second comment (cezarion#1941: `down` at revision 0, `alive` again, a wait that reported 48 s stale with the socket alive) has the shape this probe reproduces.

## Recommendation for Squeal

Treat the body of issue 109 and its second comment as reproduced and understood: a heartbeat lapse, not a stopped daemon. The decision for a spec is whether hook delivery and status should use the evidence the wait already collects. There are two options:

- (a) A boundary that finds a stale heartbeat asks the socket, as `ensureDaemon` already does before it spawns. If the socket answers, or accepts and does not answer, the header says the heartbeat is late and the daemon is alive, and it gives no "validating again" when the heartbeat returns. Cost: one ping per boundary while the heartbeat is stale. This is bounded by the ensure ping that already runs at that time.
- (b) Keep the rule and change only the text: "no heartbeat for N s; the daemon may be busy or stalled; status --wait still waits for it". Cost: none at run time. The two messages still change state twice per lapse.

Option (a) matches vision principle 7 (actionable evidence) and removes the restart the issue reports. Squeal must not say "alive" for a socket that only accepts and never answers. The wait gives that case a bound (`WAIT_DOWN_MS`); a header needs a bound too.

## Open questions

- Does a hook boundary spawn a daemon during a lapse that then loses the lock? Trace the spawn mark (`<lock file>.spawned`) in a repeat probe.
- What delayed the heartbeats in the cezarion runs: a busy store or a stalled event loop? A daemon log or the store-busy line (added in 0.1.201) from a real incident would decide it.
- The first comment's stopped daemon and the 30 s start are a separate question (see hearsay-tools/squeal#94).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/109 (body and 2 comments, read 2026-10-27).
- Source at `faa43f882`: `src/core/delivery/liveness.ts` (`daemonLiveness`, `livenessChange`, `asTold`), `src/core/delivery/format.ts:452-474` (`livenessTitle`), `src/core/status/snapshot.ts:58-63`, `src/cli/wait-liveness.ts:20-140` (`watchDaemon`), `src/cli/status-wait-lines.ts:445-458`, `src/core/daemon/ensure.ts:74-100`.
- Spec: `docs/specifications/011-core/spec.md` C8 (amended 2026-10-25, row 011-215) and C9 (amendments for rows 011-250, 011-251, 011-252 and review 0.1.355 B1).
- Prior research: `docs/specifications/004-slow-suites/research/issue-12.md`, `research/probes/issue-12/`.
- Probe: `docs/specifications/011-core/research/probes/issue-109/probe.sh`, `README.md`, `output-0.1.365-sigstop.txt`.
