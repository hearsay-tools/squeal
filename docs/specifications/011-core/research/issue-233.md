# Issue 233: a small Vitest file remains running

Recommend an evidence-led lifecycle investigation, with #233 linked to 011-210; the original stall and failed restart are not reproduced.

## Scope and versions

Research on 2026-11-17, within the brief's 20-minute bound. Incident: Squeal **0.1.531**, reported revisions about 14–16, `packages/cezar/src/worktree-skill-cleanup.test.ts`. The issue reports earlier 40–51 ms passes, minutes in `running`, two 60-second waits returning 3, an initially ineffective restart, and a later passing revision. These are reporter claims, not independently verified incident evidence. The issue has no attached status JSON, daemon log, effective policy or process snapshot.

Experiment: installed **0.1.531**, Node **v26.13.0**, Vitest **5.0.3**, Linux, **24 CPUs**. Source examined at release tag `squeal--v0.1.531`, commit `daf50f82e48e697545cfb7a378f4d46b03ce8a27`. Checkout: **0.1.543**, `b0da5d149d445ea92c8517497141a7ed6dbbcc96`. The cited run, gate, host proxy/connection, open-run, tier-text, stop and runner-part-bound files have no diff between those commits.

Initial one-minute load: **13.06**. The retained short probe began at **8.89** and ended at **10.13**, below 24. A later attempt with the incident's 60-second waits was **skipped at 31.08 > 24**, before creating a fixture or daemon. No full suite ran. Only disposable repositories' daemons were stopped. No product, board, spec or status file changed.

## Questions and answers

| # | Question and method | Answer, tag and version |
|---|---|---|
| 1 | Can a previously fast file show this wait symptom? Run a fast control, then deliberately block its test. | **Verified by experiment, 0.1.531:** a 22 ms control became `running`; both selected waits exited 3. Waits were 1,500 ms, not 60,000 ms. This is a synthetic surface reproduction only. |
| 2 | Does stop/start clear the old run? Compare status before and after a scoped restart. | **Verified by experiment, 0.1.531:** stop exited 0 in 0.402 s; restart began a new run at the same revision. Unchanged blocking code blocked again. A later edit passed. The incident's failed request acceptance was not reproduced. |
| 3 | What bounds execution? Read release source. | **Read in source code, 0.1.531:** adapter timeout defaults to 600 s; the local host's run deadline defaults to 900 s. These are separate from the CLI wait and from historical file duration. Neither long deadline was exercised. |
| 4 | What can `running since` prove? Inspect status and its source. | **Verified by experiment, 0.1.531:** selected text names lane/start; JSON names the open run's start and batch, but this standing supplies no worker PID. **Read in source code, 0.1.531:** a multi-file tier need not have started every file. |
| 5 | Is this stuck listing, admission, or quiet delay? Compare the probe with related rows and #235. | **Inferred, 0.1.531:** not established for the incident. Probe JSON had `runnerPartPending: false`, `refinedRevision: 1`, one running file and no queued file. The related issues name different states and are not proven duplicates. |
| 6 | What caused the original stall? Seek incident evidence. | **Not determined, because** the report supplies neither its effective timeouts and Vitest version nor a run/daemon timeline. A deliberate unresolved promise does not prove its cause. |

## Experiment evidence

**[verified by experiment; 0.1.531]** Run from the Squeal checkout:

```sh
python3 research/probes/issue-233/probe.py
python3 research/probes/issue-233/probe.py --wait-ms 60000
```

The second command was launched through Squawk job `issue-233-60s`; it exited 1 at the load guard. The first exited 0. [Probe, commands and limitations](../../../../research/probes/issue-233/README.md), [sanitized command output](../../../../research/probes/issue-233/output.jsonl), [skipped attempt](../../../../research/probes/issue-233/attempt-60s.txt).

The fixture uses one fork worker, default Squeal run timeout, and a 600 s Vitest test timeout. The fast test asserts `1 === 1`. Its next revision writes an ignored entry marker, then awaits a promise that never resolves. The marker confirmed test entry before either wait. The default `tests` group supplies `run tests`.

| Command or observation | Actual result |
|---|---|
| `status --wait 10000 small.test.ts` | Exit 0, 2.031 s command wall time; `why small.test.ts` recorded 22 ms file duration at revision 0. |
| `status --wait 1500 small.test.ts` after blocking edit | Exit 3, 1.691 s; revision 1, `running since 15:58:16` (Europe/Warsaw). |
| `run tests small.test.ts --wait 1500` | Exit 3, 1.717 s; explicitly says its runs continue in the daemon. |
| `status --json` | One open run, one running file; listed/refined revision 1; no pending runner part. |
| `stop --until-start`, then `start` | Both exit 0, 0.402 s and 0.410 s. |
| `status --wait 1500 small.test.ts` after restart | Exit 3, 1.676 s; new start `15:58:21`, still revision 1. JSON `since` changed from `1794927496429` to `1794927501878`. |
| Restore passing code; `status --wait 10000 small.test.ts` | Exit 0, 1.469 s; revision 2 current. `why` records a 34 ms pass. |
| Final `stop --until-start` | Exit 0, 0.319 s; fixture removed after confirmed cleanup. |

This demonstrates that similar text after restart can describe a **new** run. It does not show an old run surviving restart. It also does not exercise the original file, monorepo, process leak, event-loop stall, or a request timing out before acceptance. Dependencies were linked from this checkout, not reinstalled. The retained output reports a pnpm lock mismatch and fallback to package manifests for dependency keys; no config problem was reported. An exploratory run with an invalid custom default-group name was discarded and repeated with the default group.

## Lifecycle facts

**[read in source code; 0.1.531]** `src/core/types/policy.ts` sets `runner.timeoutMs: 600_000`. `src/runners/vitest/run.ts:execute` races the run against that timeout or an abort. It requests cancellation, waits 1 s, waits at most 500 ms for `beforeForce`, requests cancellation again, then waits 5 s. A still-unsettled run is marked `hung`; `abandon` starts a close without awaiting it. These are fixed execution controls, not a historical-duration alarm. Timer progress depends on the executing process remaining responsive.

**[read in source code; 0.1.531]** There is also an outer control. `src/cli/daemon.ts` supplies a runner-host launch. `src/core/runner-host/proxy.ts` gives a local run `timeoutMs + 300_000` (900 s by default), start/ordinary calls 300 s, cancel 60 s and close 30 s. With null run timeout, the run instead has a renewable 1,800 s no-file-end deadline. `connection.ts:#lose` kills the host and rejects its pending requests. Thus saying that Squeal has no hung-host bound would be wrong; these controls do not prove the incident reached or exceeded its actual bound.

**[read in source code; 0.1.531]** `Gate` separates run calls from runner-part calls; recreation and close take both lanes exclusively (013 V7). `runner-work-bound.ts` separately bounds a runner-part call at run timeout plus 66 s, 666 s by default, abandons its answer and rejects the remaining calls of that part. It is not an end-to-end bound across earlier queued work or several successful calls. This is the relevant distinction for 011-210, not evidence that #233 was unlisted.

**[read in source code; 0.1.531]** Daemon shutdown cancels tiers, waits for loop/runner closure, reaps marked children, clears its record, closes the socket and releases its lock. `src/cli/stop.ts` checks socket closure (60 s), lock release (30 s), and leftovers (10 s). `status/open-runs.ts` reads only runs since the live daemon's start; `store/repos/runs.ts` filters `end_state IS NULL AND started_at >= ?`. Restart is therefore more than deletion of a stale status row. Its exit code, new daemon identity, and new run start must be kept when diagnosing a failed recovery.

## Recommendation and related work

**[inferred; incident 0.1.531]** Keep #233 open as unproven cause. First obtain selected status JSON/text, `why` output, run IDs/logs, effective timeout settings, host process identity and start times, and exact stop/start exit codes before changing recovery policy. Distinguish test execution, an unresponsive runner host, runner-part listing, startup, and queue admission. Reporting an overrun relative to past duration may help, but choosing a warning or cancellation threshold requires a separate decision; duration alone does not prove deadlock.

| Related item [read in source code; checkout `b0da5d149`] | Relation; not a duplicate finding |
|---|---|
| **011-210 / gh-87**, planned research | Revision listing blocked behind older runner work; shared lifecycle/recovery question. #233 only establishes reported `running` text. |
| **gh-95 / 003-50**, research approved, row planned | node:test runs outlive completed tests; possible child-lifetime analogy, different adapter and completion evidence. |
| **gh-139**, proposed | Queued files without a recorded blocker; relevant to diagnosing the post-restart wait, not proof of the running stall. |
| **gh-225**, proposed | CPU admission despite free test slots; moderate load alone does not exclude this mechanism. It explains queued admission, not a confirmed active test. |
| **#235**, incident 0.1.531 | Explicit `run tests` waits behind a 120 s quiet period, then passes without an edit. Its retained text names a queued file and quiet deadline; #233 supplies neither. |

No implementation or change to these rows' approvals follows from this research. Open questions: which process held the original run, whether its test body had begun or finished, whether its configured bounds elapsed, whether restart actually completed, and whether the later pass reused evidence or ran afresh. None can be answered from this synthetic probe.

## Verification

**[verified by experiment; checkout 0.1.543, session CLI 0.1.531]** Python AST parsing and assertions over the retained JSONL passed: control/recovery/stop exits, deliberate wait exits, different run start times and successful cleanup. Local Markdown links and home-path redaction passed. `squeal status --wait 60000 docs/specifications/011-core/research/issue-233.md research/probes/issue-233/probe.py research/probes/issue-233/README.md` returned **3**: no test file's closure holds those paths; worktree known failures 0, **119 unknown of 1,923 test files** at revision 29. This is not a suite pass. No product code changed, so no build, typecheck or full suite ran.

## Sources

- Fetched with `gh issue view 233 --repo hearsay-tools/squeal --json number,title,body,comments,url`: [issue 233](https://github.com/hearsay-tools/squeal/issues/233). Same read for [issue 235](https://github.com/hearsay-tools/squeal/issues/235).
- Release source read with `git show squeal--v0.1.531:<path>`; [pinned source tree](https://github.com/hearsay-tools/squeal/tree/daf50f82e48e697545cfb7a378f4d46b03ce8a27/src). Relevant paths/functions are above. `git diff squeal--v0.1.531 HEAD -- <cited lifecycle paths>` was empty.
- Contracts: [011 C4/C6/C9/C10/C14/C15](../spec.md), [011 amendments](../status.md), [013 V4/V7/V8/V10](../../013-vitest-runner/spec.md), [013 amendments](../../013-vitest-runner/status.md), [board rows](../../../board.md).
- Related evidence read: [issue 139](issue-139.md), [issue 225](issue-225.md). Related rows retain their own evidence versions; this research does not re-verify their experiments.
