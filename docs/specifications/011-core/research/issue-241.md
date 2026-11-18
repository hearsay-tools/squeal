# Issue 241: source-dependent latency and incomplete commit evidence

Recommend bounded incident diagnosis before changing the source-dependent priority or commit-report contract. Existing holds stand; this triage authorizes no implementation.

## Verdict and scope

**Partial synthetic reproduction; original incident not reproduced, because** the reporting worktree, revision batches, queue trace, effective policy and gate implementation were not supplied. No live 25-minute run was attempted. One researcher wrote the component probe before a provider interruption; the coordinator verified its saved output and completed this report. No second researcher was dispatched.

Reported Squeal: **0.1.550**. Examined checkout: **0.1.560**, baseline `56aac56355ab8f6c2a5641f985a960d790f164ca`. Installed session runtime: 0.1.550. The examined scheduler and commit-report modules have no diff from tag `squeal--v0.1.550`. Node v26.13.0, 24 CPUs. Intake one-minute load was 6.71; the research run recorded 4.42 (five/fifteen minutes 6.94/6.96). Coordinator verification recorded 5.53/6.68/6.88. All were below 24; the probe also checks load and skips above CPU count.

## Findings

| Question | Evidence and answer |
| --- | --- |
| Can the named dependent miss priority below the bulk threshold? | **Verified by experiment**, 0.1.560 source, unchanged since 0.1.550: with one source, four shorter transitive consumers and one longer transitive target, real `fetchEditCut`/`editWork` keep the four short files. `demote` makes the target catch-up. Real queue order puts a shorter declared-input-only file ahead of it. A direct-import fallback control keeps the target. The supplied graph and durations are synthetic. |
| Is the issue necessarily a direct-import priority defect? | **Inferred** from the fetched issue: its chain is `provider-auth.test.ts -> provider-auth.ts -> agent-profiles.ts`; that is transitive relative to the edited source. The actual Vitest graph and any other import paths are unknown. C4 already limits priority using namesakes and a shortest-file cut. |
| Can concurrent edits affect catch-up? | **Verified by experiment**: ten keyed paths classify as a bulk catch-up revision; a virtual `BacklogQuiet` clock requeued at 60/120/180 seconds waits until 300 seconds. **Read in source code**: lane availability and edit-tier exceptions affect actual execution. This is no measured latency or proof of starvation in the incident. |
| Does a named test wait change rank? | **Verified by experiment**: promoting the target puts it first in the synthetic queue. No claim of an execution-time bound follows. |
| Can a pending dependent disappear from report counts? | **Verified by experiment**: real `testTally` given one queued test, a known closure, no current state and `asked=false` returns files=1 but failures/running/unknown all zero. Real text is `Commit 1234567: 0 known failures`. With `asked=true`, it adds `1 test file still running`. **Read in source code**: `compute.ts` counts pending work as running only when the commit asked for it; the commit report is not a complete pending-work count. |
| Can the exact reported line be produced? | **Verified by experiment**: the formatter produces the reported `Commit 301fc63` line from synthetic counts, including 124 unknown test files. Those unknowns are not proof that every other affected file is validated. A normal wait-verdict control with 124 unknown files exits 3, not pass. |
| Did Squeal or the repository gate wrongly pass the incident? | **Not determined, because** the `prepr` implementation and its read path were not inspected. The issue says `pass, incomplete`; neither the formatter probe nor a normal wait control establishes what that gate consumed. The 25-minute delay, revision-26 failure and 505-minute age remain reporter evidence only. |

The intake `friction` label identifies agent-reported experience; it is not independent reproduction evidence.

## Commands and results

Run from the repository root:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
pnpm exec tsx docs/specifications/011-core/research/probes/issue-241/probe.ts
pnpm exec biome check docs/specifications/011-core/research/probes/issue-241/probe.ts
git diff squeal--v0.1.550 HEAD -- src/core/scheduler/edit-cut.ts src/core/scheduler/queue.ts src/core/scheduler/quiet.ts src/core/scheduler/revision.ts src/core/commit/compute.ts src/core/commit/text.ts src/core/commit/report.ts src/cli/verdict.ts
```

The standalone probe passed its assertions in 10 ms in the saved researcher output and 9 ms on coordinator verification. It runs real component functions on synthetic data, with no daemon, runner or repository gate. Biome exited 1: this docs path is excluded and no file was processed. The source diff was empty. No product test suite was run for this documentation-only triage. See [probe source](probes/issue-241/probe.ts) and [saved output](probes/issue-241/output.jsonl).

Scoped verification: `squeal status --wait 60000` with all five changed paths exited 3: no test closure holds any deliverable. Worktree revision 8 had zero known failures and 17 unknown of 1,964 files. Squeal gives no test verdict for these docs or the probe. No full-suite pass is claimed.

## Fit, ownership and duplicates

**Inferred from vision and specs**: this passes the decision filter through timely feedback, useful check order and explicit uncertainty. Owner **011 C3/C4/C6/C15**; related **019 D5/D6** owns commit reporting and **005 D1/D6** owns verdict wording.

No existing #241 or named incident-file row was found on fetched `origin/main`. The open-issue list, including the `triaged` list, has no exact duplicate. Partial overlaps: #209 concurrent-edit priority and the ten-path threshold; #225 CPU admission; #237 and #170 incomplete lint summaries. They do not establish a shared cause. Keep `gh-241` separate until the human decides whether to merge the evidence.

Human decision: approve bounded incident evidence collection and decide whether source-dependent priority, commit completeness, or both need a revised contract; or defer. Preserve fairness, unknown outcomes and the existing held retry-priority policies. Before attributing the incident, obtain per-revision keyed paths, actual graph/classification, queue classes/durations, tier and admission history, repeated key changes and the gate's exact consumed output.

## Sources

- [Issue 241](https://github.com/hearsay-tools/squeal/issues/241), fetched with `gh issue view 241 --repo hearsay-tools/squeal --json state,title,body,labels,url`; no comments at triage.
- `docs/vision.md`; 011 `spec.md` C3/C4/C6/C15 and `status.md`; 019 `spec.md` D5/D6; 005 `spec.md` D1/D6.
- Checkout modules listed in the diff command; `src/core/commit/report.ts` explains commit-only running work.
- Existing [issue-209 research](issue-209.md); GitHub open and `triaged` issue lists and fetched `origin/main:docs/board.md` searches for the number, files and symptom.
