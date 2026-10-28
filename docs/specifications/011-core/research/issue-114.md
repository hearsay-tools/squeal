# Issue 114: a retry receipt promises an immediate run

Recommend describing an accepted retry as queued and reporting its actual wait without changing slow-tier scheduling.

## Scope and verdict

**Reproduced in a bounded synthetic probe.** The real CLI command prints “runs once more now” while the real scheduler keeps the slow retry queued, first behind fast work and then behind an occupied slow slot. Releasing both constraints produces exactly one retry and a pass. This proves the timing mismatch, not the reported 68-minute duration.

Examined on 2026-10-28: Squeal **0.1.369**, commit `e53a017aa667f538a8b38e3033ad31876933122d`; Node **24.22.1**; Vitest **5.0.3**. Issue [#114](https://github.com/hearsay-tools/squeal/issues/114) reports **0.1.368**, revisions 13–20, in Codex. The session's installed plugin is also 0.1.368; the probe imports checkout source, not that plugin. Initial measured one-minute load was **1.28 on 24 CPUs**; the preserved successful probe measured **0.68 on 24 CPUs**. All probe launches were below the CPU count.

The brief has no numbered questionnaire. These questions cover its requested evidence:

| Question and method | Answer, evidence tag and version |
| --- | --- |
| 1. Does the receipt promise an immediate retry? Run `retryCommand` against a failed slow file. | Yes: exit 0, “Retry queued … runs once more now.” **verified by experiment**, 0.1.369. |
| 2. Can that retry wait behind fast work and a slot? Hold a fake fast run and a real private slow-slot lock. | Yes, in both states; no retry run starts until both are released. **verified by experiment**, 0.1.369. |
| 3. Why can acceptance differ from execution? Read CLI, retry queue and slow selection source. | Acceptance stores a request; `takeRetries` enqueues a forced run at normal priority. The slow lane still checks fast work and its slot. **read in source code**, 0.1.369; these files match 0.1.368. |
| 4. Does this justify bypassing those constraints? Read 011 C4/C5/C6/C10/C15, 004 D2/D3/D8 and 005 D2/D6. | No. Accurate receipt and wait wording fit the existing contract; a scheduling change needs its own decision. **inferred**, specs at the examined 0.1.369 commit. |
| 5. Was the historical 68-minute delay caused entirely by these gates? | **Not determined**, because the issue contains neither the complete receipt nor status JSON, and this probe does not replay the external browser project. |

## Findings

### 1. Receipt and blocked execution

**verified by experiment — 0.1.369.** The probe first runs two synthetic files through the real scheduler. `test/f00.test.ts` is slow and fails. `test/f01.test.ts` is fast and passes. It then holds a new fast run, takes the only slow-slot permit in a private directory, and clears the fake runner's external failure condition without changing the slow file's key.

The command entry receives `test/f00.test.ts --reason environment`. Its full receipt is:

```text
Retry queued (reason: environment): test/f00.test.ts runs once more now. Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.
```

The probe then calls the real scheduler's `requestRetries`, as a daemon notification would. The saved [evidence.json](probes/issue-114/evidence.json) records:

| Time since command began | Observed state | Slow runs, including the initial failure |
| --- | --- | --- |
| 157 ms | Fast run active; slow file queued; retry pending; failure current | 1 |
| 359 ms | Fast run ended; slow activity `waiting` for `slot`; retry pending; failure current | 1 |
| 410 ms | Slot released; retry ended `passed`; current check passes | 2 |

The fake runner cannot cancel. During its fast run, the stored slow activity is `null`, not `waiting: fast`; the evidence for that wait is the active fast run, queued slow key and unchanged slow run count. Once fast work ends, the scheduler explicitly records the slot wait. The probe asserts all these facts and a single extra slow run. It does not assert an invented start time from request acceptance.

### 2. Source of the timing claim

**read in source code — 0.1.369, unchanged from 0.1.368 for the cited files.** `src/cli/retry.ts:243` chooses “runs once more now” from `reason === "environment"`; it reads no lane or permit state. `src/core/scheduler/retries.ts:104` claims due requests and enqueues them with `priorityOf(file, NOTHING_CHANGED)`. It does not make a slow request exempt from slow eligibility. `src/core/scheduler/slow-tier.ts:279` checks fast work; lines 239–244 take the slow slot or wait.

The same wording risk reaches status. `src/core/retry/text.ts:56` returns “runs at once” for an environment retry with no running timestamp. `src/core/status/outstanding-text.ts:229` uses that function for the retry group. **This status finding is read in source code, not verified through a rendered status command.** The low-load branch of `loadRetryWhenText` also says “runs once more now”; load retries were not exercised here.

The source comparison against release tag `squeal--v0.1.368` (`c723fd1a963b1d4e09822eee31c72e84f47d84de`) produced no diff for those six files or the two fixture helpers. **inferred — 0.1.368:** the reported version has the same causal mechanism. The probe was not run on a complete 0.1.368 checkout; other code changed in 0.1.369.

### 3. Contract and recommendation

**read in official docs — repository specs at the 0.1.369 commit.** 011 C5 says `--reason environment` “queues it at once” and keeps its failure counted until a pass. It does not promise immediate execution. 004 D2 requires slow work to wait behind fast work and the per-user slow slot. C10 adds shared worker capacity. C15 keeps slow-tier constraints even for named demand. C6 and 004 D8 require status to name waits. 005 D2 defines named waits; D6 keeps instruction text aligned with actual results. These sections must be read together: accepting a retry is not evidence of its execution.

**inferred — 0.1.369.** The deciding tradeoff is truthful feedback versus changing the priority and capacity policy. Recommend a bounded wording/status correction that reports queued acceptance and the known current blocker. Do not make immediate execution the repair by default. Keep the failure counted and preserve existing holds. This is separate from focused slow execution in #78 and the proposed named-slow priority change `gh-110` on the board. No board, spec, status, skill, product code or existing hold was changed by this research.

## Verification and limits

Exact reproduction command, from the checkout root:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-114/vitest.config.ts docs/specifications/011-core/research/probes/issue-114/probe.test.ts
```

Result: **1 file, 1 test passed**, 2.32 s total; [saved output](probes/issue-114/result.txt). This probe is outside the repository's configured Squeal/Vitest include paths, so it was run directly. Two construction attempts failed before the final probe: one selected the file-load pass instead of its failing test; one expected a slow-activity marker while the non-cancelling fast lane still ran. Both probe assumptions were corrected. A passing run preceded the preserved run, which added machine-readable evidence output. No full suite, browser installation or product build ran. `pnpm exec biome check --write` on the two probe TypeScript files processed no files because repository policy excludes these documentation paths; no lint pass is claimed.

Affected-check command: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-114.md docs/specifications/011-core/research/probes/issue-114/probe.test.ts docs/specifications/011-core/research/probes/issue-114/vitest.config.ts`. It returned exit 3, **No verdict**: the probe is not a listed test and no test closure holds the report or config. Worktree status reported 0 known failures, 1 queued and 5 unknown test files. Those checks are not claimed passed.

The probe uses real CLI logic, scheduler, SQLite store and slow-slot locks. The runner and daemon socket acknowledgement are stand-ins; `requestRetries` is called explicitly. It uses a private temporary repository and slot directory, removes them at teardown, and touches no shared production slot or daemon. The slow load guard receives a calm synthetic reading of 0.5 on one CPU. General worker-pool contention, long queue fairness, Chromium sandbox behavior, daemon restart effects and historical 68-minute duration remain unverified.

## Sources and commands

- Issue fetched with `gh issue view 114 --repo hearsay-tools/squeal --json number,title,body,comments,url,createdAt`; [issue URL](https://github.com/hearsay-tools/squeal/issues/114). The report lacks complete receipt/status evidence.
- Source links at the examined commit: [CLI receipt](https://github.com/hearsay-tools/squeal/blob/e53a017aa667f538a8b38e3033ad31876933122d/src/cli/retry.ts#L243), [retry queue](https://github.com/hearsay-tools/squeal/blob/e53a017aa667f538a8b38e3033ad31876933122d/src/core/scheduler/retries.ts#L104), [slow selection](https://github.com/hearsay-tools/squeal/blob/e53a017aa667f538a8b38e3033ad31876933122d/src/core/scheduler/slow-tier.ts#L279), [shared wording](https://github.com/hearsay-tools/squeal/blob/e53a017aa667f538a8b38e3033ad31876933122d/src/core/retry/text.ts#L56).
- Local contracts: [011 C4/C5/C6/C10/C15](../spec.md), [011 amendment log](../status.md), [004 slow scheduling](../../004-slow-suites/spec.md), [005 waits and texts](../../005-agent-adoption/spec.md).
- Version comparison: `git diff squeal--v0.1.368 HEAD -- src/cli/retry.ts src/core/retry/text.ts src/core/scheduler/retries.ts src/core/scheduler/slow-tier.ts src/core/status/outstanding-text.ts src/core/status/outstanding.ts test/scheduler/claims-fixture.ts test/cli/fake-daemon.ts` returned no differences.
- Host check: `node -p 'JSON.stringify({load:require("node:os").loadavg(),cpus:require("node:os").availableParallelism()})'`. The probe repeats the load check and refuses execution above the CPU count.
