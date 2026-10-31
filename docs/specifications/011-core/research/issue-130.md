# Issue 130: a late heartbeat with current selected passes

Treat #130 as a decision about the named-wait contract, not a proven regression from #109.

Read https://github.com/hearsay-tools/squeal/issues/130 on 2026-10-31 with `gh issue view 130 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt`. It has no comments. Source and specification examined at `e59ed2260d21616ddd529f8a5a5dcf4dde8dc2fc` (package 0.1.384). Experiments use the installed Codex runtime 0.1.383 and the committed Claude Code CLI bundle 0.1.384, without a build. Node: v24.22.1. Both CLI and daemon use the same bundle within each experiment.

Initial `cat /proc/loadavg` gave **8.14 / 5.32 / 8.81**, and `getconf _NPROCESSORS_ONLN` gave **24**. Probe-start one-minute loads were **9.72** and **8.82**, below 24. The probes generated no host load. They used one temporary repository and one tiny Vitest file each. Only their own daemons were suspended or stopped.

## Questions and answers

| # | Question | Answer and evidence tag |
| --- | --- | --- |
| 1 | Can current selected passes coexist with exit 3 and a late heartbeat on an accepting socket? | Yes. Installed 0.1.383 returned exit 3 after 61.261 s for `--wait 60000`, with the file `current`/`pass` at revision 0 and `selection.result: none`, `reason: lapsed`. The 0.1.384 repeat with `--wait 3000` took 4.139 s. **verified by experiment**, 0.1.383 and 0.1.384. |
| 2 | Does socket acceptance prove a reply or a completed sync? | No. With the owned daemon under SIGSTOP, ping and sync connections succeeded, but neither replied within 2 s. **verified by experiment**, both versions. |
| 3 | Does a responding daemon with a completed sync escape the heartbeat gate? | No. With only the isolated heartbeat timestamp held old, ping replied, a separate sync-status request reported stored revision 0, and the selected file stayed current/pass. The named wait still returned `none/lapsed`, exit 3. **verified by experiment**, both versions. This proves that a completed sync is possible during the lapse; the CLI JSON does not expose its own internal sync state. |
| 4 | Is this current contract behavior, or a demonstrated #109 regression? | Current contract behavior. C15 explicitly gives a lapsed heartbeat priority over the file classes. The #109 implementation was wording only and left verdicts and exit codes unchanged. **read in source code**, `e59ed2260` and release `2e62ee7c3` (0.1.383); no regression established. |
| 5 | Do these probes reproduce the original incident and its cause? | Only the narrow observable symptom. The incident's runtime version and full output were not retained. Its six files, revision 8, load 20–130, restarts, queue delays and missing “pass over edits” were not replayed. The cause and exact gates of that incident are **not determined, because** the required runtime and diagnostic evidence are missing. |

## Findings

### 1. Reproduction and recovery

**verified by experiment, 0.1.383 and 0.1.384.** Full commands, raw JSON snapshots, text, stderr and timing are in [the probe README](probes/issue-130/README.md) and the two output files. The named wait asked the fixture's first run under lookup-only startup. That wait passed before either fault was applied. No full-suite command was used.

The suspended-daemon case models an event-loop stall. After two heartbeat intervals plus one second, the socket accepted connections but did not reply. The 0.1.383 wait's diagnostic said:

> Named test files have no verdict: the deadline passed after 60.0 s: the daemon's heartbeat had lapsed at the last read; results are as of revision 0; the daemon's heartbeat went 76 s stale while its socket showed it alive …

Its JSON still listed `test/one.test.js` as `state: current`, `verdict: pass`. On SIGCONT, the next 0.1.383 wait passed in 0.395 s at the same revision. The 0.1.384 recovery took 0.428 s.

The second case separates heartbeat age from socket responsiveness. An SQLite trigger in the temporary fixture kept `worktrees.daemon_heartbeat_at` fixed at 30 seconds old. It did not change results, keys or revisions. The same daemon answered ping with `phase: ready`. Sync first returned `revision: null`; sync-status one second later returned `revision: 0`, `error: null`, and its incarnation. The named wait still reached its deadline with `reason: lapsed`: 60.137 s on 0.1.383 and 3.162 s on 0.1.384. Removing the trigger restored passing waits in 0.418 s and 0.402 s, respectively. This is artificial fault injection, not evidence that an incident involved a trigger or a store lock.

### 2. Three different facts

**read in source code, `e59ed2260`, 0.1.384.** The relevant rules are also present in 0.1.383. `git diff squeal--v0.1.383 HEAD -- src/cli/verdict.ts src/cli/wait-liveness.ts src/cli/status-sync.ts` is empty; the changes in `status-wait-paths.ts` concern promotion lifetime, not this gate.

- `src/cli/wait-liveness.ts:236`: `listening` treats a ping reply or a request error after connection as a listening socket. It does not make that stale heartbeat `alive`. `watchDaemon` keeps the wait going as `lapsed`.
- `src/cli/status-sync.ts`: sync asks for reconciliation, then waits for its stored revision. A ping is not this answer. C6 requires revision-aware evidence so an edit not yet reconciled cannot take an older pass.
- `src/cli/status-wait-paths.ts:262`: readiness requires `daemon.state === "alive"` as well as the sync/listing condition. Even a completed sync does not bypass a lapsed heartbeat.
- `src/cli/verdict.ts:197`: `selectionResult` checks `read.lapsed` before sync and file classes. `resultCode` maps `none` to 3. Exit 3 means no verdict, not a failed test.
- `src/cli/no-verdict-lines.ts:27`: the formatter chooses the lapsed explanation before the unsynced explanation. The report that the same incident lacked a stored sync cannot be verified from the abbreviated issue text. These probes do not claim both diagnostic branches were printed together.

C9 also distinguishes a socket that accepts but never replies from a progressing daemon. Therefore “socket alive” in a wait's lapse sentence is weaker evidence than a completed reconciliation pass.

### 3. Relation to #109

**read in source code, `e59ed2260`.** C15's 2026-10-25 amendment (011-206) explicitly orders `no-daemon`, then `lapsed`, before other gates. The current `status.md` keeps that contract; its later 011-283 amendment concerns named-wait order. The board's done row 011-276 and `tasks/011-276/notes.md` record the human's 2026-10-30 choice: wording only, no new classification. The notes state:

> The liveness decision (`daemonLiveness`, alive or down) is unchanged, so are the verdicts, exit codes, news rules and ensure.

The earlier [issue-109 research](issue-109.md) used 0.1.365 and found a mismatch between hook wording and the wait's socket evidence. Its proposed choices did not themselves authorize a new verdict rule. Closing #109 with 0.1.383 therefore does not establish that this exit should have changed.

## Recommendation and open questions

**inferred from the experiments and current contract, 0.1.383/0.1.384.** Bring #130 to the human as a contract choice. The tradeoff is faster use of already-stored results versus proof that those results cover edits made before the wait. Connection acceptance alone cannot supply that proof. A successful sync and current selected results are a materially stronger case to consider, but the present rule still requires a fresh heartbeat. Do not adopt “exit 3 only when the daemon is gone”: C15 also uses it for unsynced, unlisted, pending and other cases with a running daemon.

Open: which runtime ran worker 2d7b5442; whether its socket merely accepted or replied; whether its own sync completed; what delayed its heartbeat; and whether its passes covered every preceding edit. The original full `--json`, daemon record/log and version would decide these. No evidence here identifies CPU saturation, SQLite contention or a restart as the incident's cause.

Verification: both probe processes exited 0. Assertions over the saved JSON confirmed every baseline/recovery pass, both lapsed results, socket timeouts and completed separate sync. Both daemon process groups and temporary fixtures were gone after cleanup. No build or product test suite ran. `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-130.md docs/specifications/011-core/research/probes/issue-130/probe.py` returned exit 3: neither research path is in a test closure; worktree known failures 0, all 1,347 test files current (revision 28). This is no test verdict for the research files, not a new suite run. `git diff --check` passed.

## Sources and artifacts

- [Issue #130](https://github.com/hearsay-tools/squeal/issues/130), fetched as above.
- Local spec `docs/specifications/011-core/spec.md`, C6, C9 and C15; `status.md`; `docs/process.md`, `vision.md`, `styleguide.md`, `board.md` at `e59ed2260`.
- [0.1.383 source](https://github.com/hearsay-tools/squeal/tree/2e62ee7c3), and paths cited above at [examined HEAD](https://github.com/hearsay-tools/squeal/tree/e59ed2260d21616ddd529f8a5a5dcf4dde8dc2fc).
- `tasks/011-276/notes.md`; [issue-109 findings](issue-109.md).
- [Probe script](probes/issue-130/probe.py), [commands](probes/issue-130/README.md), [0.1.383 output](probes/issue-130/output-0.1.383.jsonl), [0.1.384 output](probes/issue-130/output-0.1.384.jsonl).
- CLI SHA-256: installed 0.1.383 `39fffcd770606a6486a0601a2dac5fb64906ec14f9c58286ed40874dcda4fe2b`; committed 0.1.384 `b09ec4c9a0d00f763daa15ce775f54889fc596d6744f1e1f824e9a6fb4af821a`.
