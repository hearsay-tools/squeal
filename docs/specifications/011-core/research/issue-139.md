# Issue 139: queued files with no recorded blocker

Recommend retaining #139 as an explanation gap with capacity as a candidate dependency; do not assign the original incident a cause.

2026-11-03. Research baseline: `4f939b1d6b22b584c6eb180ed8f0f12986fa9521`, Squeal 0.1.393. Also probed exact release source `squeal--v0.1.390`, commit `5d93ab1720d4e457739168e8b59cf2ae113f22c1`. Node v24.22.1; installed dependencies reused. Documentation and throwaway probes only. Existing holds stand.

## Answers

| # | Question from the brief | Answer and evidence tag |
| --- | --- | --- |
| 1 | Is the original cezarion incident reproduced? | **Not determined, because** no incident JSON, pool snapshot or daemon trace is supplied and its workload was not replayed. **Inferred, incident 0.1.390:** the reported timeout establishes incomplete verification, not a scheduler cause. |
| 2 | Can an isolated scheduler produce the reported queue wording? | **Verified by experiment, 0.1.390 and 0.1.393:** yes. One held node-test lane uses the only capacity permit. Four Vitest files stay queued with no open run in their lane and the reported fallback reason. Three scenarios pass per version. |
| 3 | What dependency can status omit, and does another lane alone cause the delay? | **Verified by experiment, both versions:** a shared-capacity wait can be omitted. Without a pool, the four files settle while the node file remains held. An edited Vitest file starts without a permit in the constrained control. **Read in source code, both versions:** selection asks capacity before opening a run; the status reason path does not read the capacity pool. |
| 4 | Do gh-87, gh-95 or gh-127 establish a cause or existing dependency? | **Inferred, board/spec at 0.1.393:** they are related work, not proven duplicates. Research rows 011-210 and 003-50 may matter if a blocked runner part or lingering node process is established. Retry priority remains held; #139 records no retry. |

## 1. Original evidence and limits

Fetched with `gh issue view 139 --repo hearsay-tools/squeal --json title,body,comments,url,state,createdAt`. The issue records a Codex session retained on 0.1.390, despite the CLI also listing Claude Code 0.1.392. At cezarion commit `4876af621`, revision 2, the baseline had run for 35 minutes with 29 of 123 files done. One node-test file was running. Four `server` Vitest files were queued with “no run is open and nothing recorded holds them”. The unqualified `status --wait 60000` returned after 61.2 s with all four selected files pending. The incident daemon was stopped for cleanup; restart recovery was not tried.

**Inferred, incident 0.1.390, reporter evidence only:** “no run” is scoped to the queued files' lane. It does not contradict the separate running node-test file. Neither the node file's completed-test state nor its owned children, capacity allocation, queue classes, listing state or intervening scheduler errors were captured here. A 35-minute baseline is not proof of one 35-minute run. The original timeout and startup duration were not reproduced.

## 2. Bounded experiment

**Verified by experiment, both versions.** Initial host check: one-minute load 11.94, 24 CPUs. At the final runs' own load gates: 11.92 for 0.1.393 and 11.86 for 0.1.390, each below 24. The probe uses the real scheduler, store, capacity and status functions with a scripted runner. It starts no live daemon or application test runner. Each case owns an isolated Git repository, database and pool. Each invocation is bounded by `timeout 45s`.

| Scenario | 0.1.390 | 0.1.393 |
| --- | --- | --- |
| No pool, node file held | All four Vitest files current before node release | Same |
| One slot, node file held | Four queued; exact fallback wording; no Vitest run across 2.2 s | Same |
| Edit one Vitest file while node holds sole slot | Edit tier starts with no grant; all four Vitest files share it and settle | Same |
| Release node after capacity-only wait | All five current after 31 ms | All five current after 29 ms |

Both invocations exit 0 with `PASS`, three scenarios, no scheduler errors and empty stderr. The fallback is `queued; no run is open and nothing recorded holds {it}`; `{it}` is the renderer's substitution token. The pool mark records demand 5 and grant 1 while the node file holds the slot. Its `since` is null; a waiting timestamp alone would miss this case.

This is a **partial synthetic reproduction**. It uses five baseline files, not the original 123-file baseline and revision-2 edit selection. The four queued files are backlog work. The edit control is a material limit: it shows that this capacity case does not explain why the incident's four re-keyed files remained queued. Their actual queue classes are unknown. No 60-second CLI wait, leaked child or 35-minute run was simulated.

## 3. Source evidence and contract

**Read in source code, 0.1.390 and 0.1.393:** `scheduler/tiers.ts`, `selectTier`, calls `capacity.take` before `startTier`. `WAIT_FOR_CAPACITY` returns without opening a run. `scheduler/capacity.ts` keeps a refusal flag in memory; the pump rechecks within 2 s. `capacity/pool.ts` records process-wide demand and grants, outside the repository store. `status/standing.ts`, `queuedReason`, checks claims, an open run in the same lane and slow policy, then returns `{ kind: "queued", lane, behind: null }`. `status/next-step.ts`, `queuedStep`, emits the fallback when no promotion or quiet reason applies. The inspected scheduler, status and capacity directories have no diff between the two source versions.

**Read in source code, spec/board at 0.1.393:** C4 separates lanes and queue classes. C10 requires backlog permits before a run claims keys; edit tiers bypass permits. C6's unqualified wait covers re-keyed files and does not itself wait for the entire startup baseline. C15 gives named files promotion subject to constraints and permits the honest “nothing recorded” fallback. The incident's unqualified wait is not evidence of a named promotion.

**Inferred, both versions:** the decisive tradeoff is truthful reasons without bypassing capacity or declaring queued work passed. A capacity-held queue is valid scheduling in this fixture; its missing explanation is the demonstrated gap. The fallback should not be treated as proof that work is runnable immediately. No implementation or contract change follows from this report.

## 4. Related work and open questions

**Inferred from the board at 0.1.393:** gh-87's view shipped in 011-209; its stuck-listing research 011-210 remains planned. gh-95's node-process completion research 003-50 also remains planned and overlaps 011-210. These are possible investigative dependencies if the original running node file blocked refinement or outlived its tests. Neither fact is established. gh-127 was partly addressed by 011-283 in 0.1.384; explicit retry priority stays held. This incident names no retry. The issue intake bot's closed-#40 suggestion is an overlap only: #40's research did not reproduce its unexplained queue, and 011-27 supplied the fallback now seen here.

Open: the original pool allocation and host load; the four files' queue classes; whether runner refinement was pending; whether the node file had finished its test bodies; whether capacity release or restart would have cleared the queue. These require incident evidence or a new authorized reproduction. Keep existing holds and research scope intact.

## Research verification

**Verified by experiment, session Squeal 0.1.390:** the path-scoped `status --wait 60000 research/probes/issue-139/probe.ts docs/specifications/011-core/research/issue-139.md` exited 3: no test closure holds either research file. The unqualified `status --wait 60000` then returned on timeout after 60.5 s with `test/policy/repository-inputs.test.ts` queued. A final `status --wait 60000 test/policy/repository-inputs.test.ts` exited 0 after 32.5 s at revision 20: one selected file current, no known failures, all 1,385 test files current. Commands used the session launcher `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`. These are research-worktree results, not the cezarion incident. No full suite ran. Squeal flags the standalone probe as untested by its suites; its explicit assertions are the experiment evidence. Local report links and `git diff --cached --check` pass.

## Sources and reproducibility

- [Issue 139](https://github.com/hearsay-tools/squeal/issues/139), fetched 2026-11-03; reporter evidence, not an independently observed incident.
- [0.1.390 source](https://github.com/hearsay-tools/squeal/tree/5d93ab1720d4e457739168e8b59cf2ae113f22c1/src/core): paths and functions above. Current baseline `4f939b1d6b22b584c6eb180ed8f0f12986fa9521`.
- [Probe and exact commands](../../../../research/probes/issue-139/README.md), [0.1.390 output](../../../../research/probes/issue-139/v0.1.390.jsonl), [0.1.393 output](../../../../research/probes/issue-139/v0.1.393.jsonl). Source extraction uses `git archive squeal--v0.1.390 src package.json`; runs use `pnpm exec tsx` under a 45 s shell timeout.
- [Spec C4/C6/C10/C15](../spec.md), [amendments](../status.md), [board](../../../board.md), [gh-87](issue-87.md), [gh-95](../../003-node-test-runner/research/issue-95.md), [gh-127](issue-127.md), [gh-40](issue-40.md).
