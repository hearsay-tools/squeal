# Issue 148: setup lease timeout and retry

Recommend a bounded explicit recovery path for setup-blocked files, with status that states whether the request can run.

**Verdict:** reproduced synthetically on Squeal **0.1.402**, in both fast and slow lanes. The original cezarion incident is **not reproduced**. Its commands and logs were not included in [issue 148](https://github.com/hearsay-tools/squeal/issues/148), fetched with `gh issue view 148 --repo hearsay-tools/squeal` on 2026-11-04. The issue reports workers on 0.1.390, revision 176 in one case, and 90 unknown files. This experiment uses two files and a real exclusive file lock, without a browser or coverage collector.

## Questions and answers

| Question | Answer | Evidence and version |
| --- | --- | --- |
| 1. Does a globalSetup lease timeout leave files unknown after release? | Yes. Two files become unknown, with one setup failure. Releasing the lease causes no new setup attempt during the observation window. | **verified by experiment**, Squeal 0.1.402 / Vitest 5.0.3, both lanes |
| 2. Can an environment retry recover them? | Retrying `setup.ts` exits 1: “no inputs to retry at.” Retrying `a.test.ts` exits 0 and prints “Run queued,” but the request stays pending and the file stays unknown. | **verified by experiment**, 0.1.402, both lanes |
| 3. Does a named wait recover another blocked file? | No. A wait on `b.test.ts` asks its one run, then expires after 15 seconds. Setup attempt count stays at one. | **verified by experiment**, 0.1.402, both lanes |
| 4. What explains the failure and what proves recovery is possible? | Setup failure blocks the files; the retry selector skips blocked files. An edit to setup creates revision 1, setup runs a second time, and both files pass. | **read in source code**, 0.1.402, for the mechanism; **verified by experiment**, 0.1.402, for recovery |
| 5. Does this prove the original incident or its version? | No. Original lease code, setup logs, configuration and exact retry target are not supplied. The setup refusal and blocked-file retry guard also exist in the 0.1.390 source. | Original: **not determined**, because incident artifacts are absent. Historical mechanism: **read in source code**, 0.1.390 |

## Experiment

**Verified by experiment, 0.1.402.** Source commit `4204b3d479ec241424d1ba629f904caf95076c15`; committed Claude Code CLI bundle reports `0.1.402`; Node `v24.22.1`; Vitest `5.0.3`; Linux; 24 CPUs. Initial host load was 1.72. The preserved fast run began at one-minute load **7.49** and the slow run at **6.61**, both below 24. Recovery-control loads were **7.27** and **7.62**. The driver checks load before starting and exits 77 above CPU count.

Run from the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-148/probe.py . > docs/specifications/011-core/research/probes/issue-148/output.jsonl
python3 docs/specifications/011-core/research/probes/issue-148/probe.py . --slow > docs/specifications/011-core/research/probes/issue-148/output-slow.jsonl
```

The driver creates a temporary Git repository, links the installed dependencies, and generates only `a.test.ts`, `b.test.ts`, their config and `setup.ts`. Each test asserts `1 === 1`. The driver holds `fcntl.flock(LOCK_EX)` on a file outside that repository. The real Vitest globalSetup invokes `flock -w 0.2 <lease> true` and throws a timeout error when it cannot acquire the lock. The setup records each attempt outside the repository too. Release changes no watched input.

The CLI is `node --disable-warning=ExperimentalWarning <checkout>/plugins/claude-code/dist/cli/squeal.mjs`. Each log records the exact argument list, working directory, exit code, duration and output. The sequence is:

1. `start`; in the slow variant, also `run --slow --wait 15000`.
2. Read `status --full` after setup failure; release the lease; read it again after three seconds.
3. `retry setup.ts --reason environment` returns 1. `retry a.test.ts --reason environment` returns 0 and “Run queued.”
4. `status --wait 15000 a.test.ts` returns 3 in about 0.4 seconds, with no verdict and a setup-failed reason.
5. `status --wait 15000 b.test.ts` asks a run and times out with exit 3 after 15 seconds. Both files are still unknown, with pending retry requests and only one setup attempt. This extends observation beyond the three-second release check.
6. Append a comment to the generated setup file. In the slow variant, also request `run --slow --wait 15000`. The named wait on both files returns 0: revision 1, both current, no known failures. Setup attempt count is two. Final named waits take 1.425 seconds fast and 0.549 seconds slow. `stop` succeeds in each fixture.

Both driver commands exit 0; each asserts that the final named wait passes. No full-suite command was run. The first exploratory fast run had the same failure at load 1.31; the preserved fast run adds the positive recovery control.

## Mechanism and contract

**Read in source code, 0.1.402.** `src/core/scheduler/setup.ts:failStartup` calls `block`, removes affected files from the queue, and records the setup failure. `failures.ts:block` sets `file.blocked` and `ledger.broken`. `retries.ts:dueOf` explicitly does `if (file.blocked !== null) continue`. `scheduler.ts:requestRetries` calls `takeRetries` without retrying the broken runner. Thus accepting a request in the CLI does not make that blocked file runnable. `src/cli/retry.ts:askLine` nevertheless prints “Run queued”; status then says “the daemon queues its run at its next look.” The logs show neither occurs before a new revision.

**Read in source code, 0.1.390.** Local release tag `squeal--v0.1.390` resolves to `5d93ab1720d4e457739168e8b59cf2ae113f22c1`. `git show squeal--v0.1.390:src/core/scheduler/retries.ts` has the same blocked-file guard. `git show squeal--v0.1.390:src/cli/retry-unlisted.ts` has the same setup retry refusal. This is source evidence only; no 0.1.390 runtime was exercised.

**Read in official docs, repository commit 4204b3d4.** 011 C4 deliberately leaves a failed start unknown until a new revision or checkpoint restarts the runner. C5 permits an agent-requested environment retry and one run of an unknown file; it also forbids guessing external recovery on a timer. C6 requires honest status; C15 makes a named unknown-file wait ask one run. The setup block prevents those file requests from advancing here. 013 V1 and V4 describe instance ownership and reporter-based results; 013 V8 requires closing a failed-start instance before its next run. `src/runners/vitest/startup.ts` explains why: reusing that instance could skip setup. The 011-211 amendment in both status logs releases slow instances on hold or idle; it does not provide recovery from an already failed setup.

## Recommendation and limits

**Inferred, from 0.1.402 evidence.** Prioritize explicit recovery for setup-blocked files and truthful request state. Preserve unknown until execution supplies a result, and preserve a fresh setup instance. The deciding tradeoff is recovery after an agent repairs external state versus repeated setup attempts against a real failure. The explicit retry is already authorized by that agent; automatic lease-release recovery needs a defined signal and policy. A generic setup error alone cannot prove that the lease became available. No implementation or spec design is proposed here.

Open questions: how the original lease reports ownership/release; the exact original retry target; behavior with multiple Vitest projects, a real browser provider and the original 90-file workload; whether the original failure used this precise path. The slow log also records `run --slow --wait` saying its files “have their results” while they remain unknown, with exit 0. That command is not used as proof of passing; the final named wait and full status supply the recovery verdict.

## Sources and verification

- [Issue 148](https://github.com/hearsay-tools/squeal/issues/148), fetched issue report, not independent incident evidence.
- [Probe and reproduction instructions](probes/issue-148/README.md), [fast transcript](probes/issue-148/output.jsonl), [slow transcript](probes/issue-148/output-slow.jsonl).
- [011 spec](../spec.md), C4/C5/C6/C15; [011 amendments](../status.md); [013 spec](../../013-vitest-runner/spec.md), V1/V4/V8; [013 amendments](../../013-vitest-runner/status.md), as of `4204b3d4`.
- [Scheduler retry source at examined commit](https://github.com/hearsay-tools/squeal/blob/4204b3d479ec241424d1ba629f904caf95076c15/src/core/scheduler/retries.ts); adjacent `setup.ts`, `failures.ts`, `scheduler.ts`; `src/cli/retry.ts`, `retry-unlisted.ts`; `src/core/status/next-step.ts`; `src/runners/vitest/startup.ts`.

Research artifacts only. No product tests, product code, specs, status logs or skills changed. Repository Squeal reports no closure for the research paths (exit 3), zero known failures and four pre-existing unknown test files. No product-suite pass is claimed.
