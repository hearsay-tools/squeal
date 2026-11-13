# Issue 209: directly edited tests can become catch-up work

Recommend reviewing C4's ten-keyed-path rule for concurrent test edits before choosing a queue change.

**Mechanism reproduced; original incident not reproduced.** The rule expressly includes edited tests. The current queue then removes their edited-file priority inside catch-up. This is specified behaviour, not evidence of a new scheduler regression. Existing holds stand; no implementation is authorized.

Research date: 2026-11-13. Source baseline: `b5eba8432c317fa259495873e6a223d4501cf142`, package **0.1.465**. Incident: **0.1.464**, tag `ff4c9c2f1608ec88c79c77481b976ba5e5be7575`. The examined scheduler directory, slow classifier and status files have no diff between them. Probe: Node **v26.13.0**, 24 CPUs and 24 available CPUs, one-minute load **0.89** (five/fifteen minutes 1.50/6.68). Initial load was 0.99. The load guard allowed the isolated experiment. No cezarion worktree or live daemon was touched.

`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version` returned **0.1.464**, with the notice that this Codex session stays pinned to 0.1.464 while the Claude Code plugin is 0.1.465. The experiment imports checkout source; it does not invoke either runtime.

## Questions and verdicts

| # | Question | Answer and evidence tag | Version |
| --- | --- | --- | --- |
| 1 | Can about 35 directly edited tests become catch-up? | Yes, if at least 10 keyed paths occur in one revision. 9 gives false; 10 and 35 give true. Five separate revisions of seven give false each. **verified by experiment** | 0.1.465; classifier identical to 0.1.464 |
| 2 | Can other re-keyed files precede them? | Yes, in catch-up. Shorter non-failing files precede longer edited files; unknown edited durations also sort last. An already recent entry keeps its first-group status. **verified by experiment** | same |
| 3 | Can e2e precede them? | An unmarked e2e file can sort ahead in the fast queue. A matching slow policy removes it from that queue. Its project name or suffix alone does not mark it slow. **verified by experiment** | same; `slowFiles` also unchanged |
| 4 | Did the reported wait promote the five edited tests? | The shown command has no paths. It takes the unnamed wait branch. Named promotion is a separate path; the queue probe confirms promotion moves an edited catch-up file first. **read in source code**, with promotion **verified by experiment** | 0.1.464/0.1.465 |
| 5 | Does this explain the 136 s timeout and 50 s stale heartbeat? | **Not determined, because** no incident store, revision batches, policy or run trace was supplied or inspected. The probe has no daemon and measures no execution wait. **inferred**, limited to the fetched report | incident 0.1.464 |
| 6 | Does this require a new edited-file queue? | **Not determined.** Edited-file priority and named promotion already exist. The deciding issue is whether the ten-path bulk-change policy should also apply to simultaneous agent edits. **inferred** from Q1–Q4 | 0.1.464/0.1.465 |

## Original incident

**Inferred from the fetched issue, not independently verified (0.1.464).** [Issue 209](https://github.com/hearsay-tools/squeal/issues/209) reports about 35 unit files edited in one worktree, revision 5, 226 queued files including e2e, and five edited unit files without runs. Its unnamed `squeal status --wait 120000` returned after 136.2 s with 111 of 211 re-keyed files pending and a 50 s heartbeat lapse. The body says one main agent plus three subagents; the harness field says four subagents. The exact agent count is unconfirmed and does not change the classifier, which reads paths, not agent identities. The fetched body and empty comments array are preserved in `research/probes/issue-209/issue.json`.

The aggregate count does not establish a revision of ten keyed paths. Nor does a status queue listing establish run order or that e2e occupied the fast lane. A prior recent entry can survive a later catch-up addition. These conditions must be checked before attributing the incident to Q1.

## Mechanism and experiment

**Read in official docs, repository baseline above.** C4 step 4 says a revision changing ten or more keyed paths “causes no edit's work,” including “the ones it edited.” Within catch-up, “the edited, direct and transitive classes do not divide it.” The amendment log dates this decision to 2026-10-20, row 011-22. It sought shorter bulk-change completion through backlog scheduling. C4 step 5 puts that work on the backlog route, with capacity and tier constraints.

**Read in source code, 0.1.464/0.1.465.** `revision.ts:57–85` implements that count. `rekeyContent` passes `catchUp` into `Ledger.settle`. At `ledger.ts:368–371`, a reached miss becomes recent only when it is not catch-up. `priorityOf` still calls the changed test `edited`, but `queue.ts:593–599` collapses catch-up priorities into failing versus all other files, then sorts by duration. This connects the two functions tested below; the probe does not execute this whole pipeline.

**Verified by experiment, 0.1.465, relevant source identical to 0.1.464.** The standalone probe imports the real classifier, queue and slow classifier. It uses 35 listed edited tests plus two assumed re-keyed files. No runner or filesystem events are simulated. Synthetic durations are 100 ms for edited tests, 1 ms for another test and 2 ms for e2e. Selected output:

```text
changedListedTests=9: catchUp=false
changedListedTests=10: catchUp=true
changedListedTests=35: catchUp=true
fiveRevisionsOfSevenTests=[false,false,false,false,false]
changedPaths=35, keyedPaths=9: catchUp=false
35 edits, unmarked e2e: other.test.ts, activity.e2e.ts, unit-0.test.ts
edit class control: editedRank=1
unknown edited durations: catchUpRank=3, editRank=1
e2e marked slow: fast=36, slow=1, e2eInFastOrder=false
named promotion: editedRank=1, catchUp=false
previous recent survives catch-up add: recent=true, catchUp=false
assertions=PASS, elapsedMs=9
```

Full raw output and exact commands are in the [probe README](../../../../research/probes/issue-209/README.md) and `output.jsonl`. `pnpm exec tsx research/probes/issue-209/probe.ts` exited 0. `pnpm exec biome check research/probes/issue-209/probe.ts` passed. No full suite or product tests were run for this documentation-only investigation.

Scoped verification: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-209/probe.ts docs/specifications/011-core/research/issue-209.md` exited 3: no test file's closure holds either path. Revision 10 reported zero known failures and six unknown files out of 1,771. Thus Squeal gives no verdict on these deliverables; the standalone experiment is their executable verification.

**Read in official docs and source code, baseline above.** 004 D1/D2 marks slow files by policy and keeps them out of fast tiers. `slowFiles` implements that marking. C6's unnamed wait covers files re-keyed by its revision window, excluding slow files by default; it is not a request to run only directly edited files. `status-wait.ts:471` enters named demand only with paths. C15 promotion changes order but still respects listing, claims, running tiers and slow policy. The queue control proves promotion rank, not a latency guarantee.

**Read in source code, 0.1.464/0.1.465.** `status-wait-lines.ts:492–495` prints “a busy store or a stalled daemon” for a heartbeat lapse. That text offers alternatives, not a diagnosed cause. C9 distinguishes lock/socket liveness from a fresh heartbeat. This experiment supplies no evidence for a store lock, CPU starvation or event-loop stall.

## Recommendation and open evidence

**Inferred, baseline above.** Treat the threshold as a policy question first. Bulk catch-up gains throughput but can remove edited-test priority when several agents share one revision. Preserve that tradeoff in the coordinator's decision; do not assume a missing queue. A named wait on the exact test paths uses an existing priority mechanism, but does not prove the original blocked run would finish promptly.

To attribute the incident, obtain its per-revision changed keyed paths; the five edited paths and their existing queue classes; their duration and failure history; the effective e2e group/slow policy; and tier, claim, listing and heartbeat evidence. Without these, the 226-file queue, timeout overrun and heartbeat lapse remain unreproduced. Related #181 concerns a named new file and discovery; #185 concerns unobserved edits with lapsed heartbeats. Their existing research establishes overlap, not a shared cause.

## Sources

- [Issue 209](https://github.com/hearsay-tools/squeal/issues/209), fetched with `gh issue view 209 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt`.
- [Release source](https://github.com/hearsay-tools/squeal/tree/ff4c9c2f1608ec88c79c77481b976ba5e5be7575): `src/core/scheduler/{revision,ledger,queue}.ts`, `src/core/slow/classify.ts`, `src/cli/{status-wait,status-wait-lines}.ts`.
- Project docs at `b5eba8432`: `docs/specifications/011-core/spec.md` C4/C6/C9/C15 and `status.md`; `docs/specifications/004-slow-suites/spec.md` D1/D2; `011-core/research/issue-181.md` and `issue-185.md`.
- Experiment: `research/probes/issue-209/{probe.ts,README.md,output.jsonl,issue.json}`. No external web search or product changes.
