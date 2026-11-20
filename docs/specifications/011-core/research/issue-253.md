# Issue 253: Vitest tier reported running without a process

Recommend bounded diagnosis of running ownership before choosing recovery policy. The original incident is **not reproduced**; one synthetic Vitest-worker death was detected and recorded.

## Scope and evidence

Research on 2026-11-20 for [#253](https://github.com/hearsay-tools/squeal/issues/253). The reporter names Squeal **0.1.572**, a Claude Code Squawk worker, repeated 60-second status waits and about ten minutes in `running`; stop/start cleared it. The original worktree was destroyed. Its revision, Vitest version, policy, status JSON, logs and process snapshot were not retained. These are reporter claims, not independently verified process evidence.

Source and packaged runtime: checkout `35f89082c592cb8200d841baeb50160400204d60`, **0.1.572**, without rebuilding. Experiment: Node **v26.13.0**, Vitest **5.0.3**, Linux `apptension-host`, **24 CPUs**, **11:47:33 UTC**. `/proc/loadavg` before fixture creation: **18.27 22.78 25.83**; end: **21.30 23.15 25.88**. The one-minute load passed the brief's gate. This tiny fixture needed neither a quiet host nor HOME/environment isolation. No existing daemon was changed.

## Questions and findings

| Question | Answer, tag and version |
|---|---|
| Does killing a Vitest fork strand its original run? | **Verified by experiment, 0.1.572:** no in this probe. Its run ended UNKNOWN with a SIGKILL diagnostic. The next named wait requested a new retry. |
| Is `running` after the kill the old run? | **Verified by experiment, 0.1.572:** no. Start changed from `1795175257193` to `1795175259612`; JSON identified an environment retry with `noResult: true`. Blocking code remained. |
| Is the prior 011-71 claim leak visibly unfixed? | **Read in source code, 0.1.572:** both superseded paths call `ledger.endRunningAt(file, key)` (`record-tier.ts:102`, `scheduler.ts:1565`), the cleanup missing in 0.1.238. This does not exclude another ownership defect. |
| Does #233 establish this cause? | **Inferred from issue history/source, 0.1.572:** no. Its overrun warning and beside-tier fixes address prolonged running, not proof of a missing process. |
| What caused #253; would status-time PID checking fix it? | **Not determined:** original run ownership and process evidence are gone. Tier, runner host and fork are distinct; this probe killed only a fork. |

## One bounded experiment

**[verified by experiment; 0.1.572]** Actual launch from the checkout root:

```sh
python3 research/probes/issue-253/probe.py > research/probes/issue-253/output.jsonl
```

The identical script and output were then moved to the spec's [probe directory](probes/issue-253/README.md). About 17 seconds, one test, one fork. After a passing control the test wrote its PID and awaited an unresolved promise. Before SIGKILL the script verified the PID's working directory was the fixture and its command line was Vitest's fork worker. [Output](probes/issue-253/output.jsonl) retains every CLI command and full status JSON.

| Command/observation | Actual result |
|---|---|
| `status --wait 10000 small.test.ts`, control | Exit 0, 2.045 s; `why` recorded a 28 ms pass at revision 0. |
| Blocking edit; `status --wait 1500 small.test.ts` | Exit 3, 1.790 s; one running file and one open run. |
| SIGKILL to fixture worker | Original PID absent from `/proc` at later check. |
| `status --wait 10000 small.test.ts`, after kill | Exit 3, 10.252 s; explicitly requested a new run because the file was unknown with nothing queued. |
| `status --json`; `why small.test.ts` | One open retry; PASS -> UNKNOWN at 11:47:39.163Z; “Worker exited unexpectedly with signal SIGKILL during started state while running test file small.test.ts”. |
| Restore original bytes; named wait | Exit 0, 0.574 s, revision 2; **reused revision-0 pass**, not fresh execution. |
| `stop --until-start` | Exit 0, 0.485 s; fixture removed. |

Limits: no ten-minute observation, host kill, restart or supersession race. Replacement PID not captured; its OS liveness is not claimed. Linked dependencies caused a retained pnpm-lock mismatch note and package-manifest key fallback. This is one synthetic negative reproduction, not proof that #253 cannot happen. Probe syntax and retained-output assertions passed; no repository suite ran.

## Lifecycle, related evidence and next decision

**[read in source code; 0.1.572]** `src/runners/vitest/run.ts` makes unhandled worker errors an untrusted crashed run. Default execution timeout is 600,000 ms (`core/types/policy.ts`); local host calls get another 300,000 ms (`core/runner-host/proxy.ts`). `connection.ts` separately detects host-channel exit and rejects pending requests. `core/status/open-runs.ts` filters runs by the live daemon's start; C9 resets leftover running rows at startup. Neither these deadlines nor restart were exercised here.

**[read in source code/prior report; 0.1.572/0.1.238]** [011-71](stuck-tier.md), fixed in 0.1.245, had zero open runs, zero children and a leaked `runningKey`. #253 lacks that snapshot. [#233](https://github.com/hearsay-tools/squeal/issues/233) includes both ineffective and effective restart reports; rows 011-399/405 shipped warning/beside-tier behavior in 0.1.567/0.1.570. Its shared symptom does not prove shared cause. The 011-419 progress-clock amendment is separately approved work.

**[inferred; 0.1.572]** Preserve status text/JSON, `why` and run logs, effective timeouts, daemon/host/fork identities and `/proc` state, then stop/start exits and new starts on recurrence. Distinguish a stale claim, live blocked run, lost host and new retry before adopting the suggested PID-based recovery. No implementation follows from this report.

Sources fetched: `gh issue view 253 --repo hearsay-tools/squeal --json title,body,comments`, same for 233; [011 C4/C6/C9/C13/C14/C15](../spec.md), [amendments](../status.md), [013 V4/V7/V8](../../013-vitest-runner/spec.md), [earlier #233 research](issue-233.md), and cited source paths at the pinned commit.
