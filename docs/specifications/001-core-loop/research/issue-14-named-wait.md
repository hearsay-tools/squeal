# Issue 14: explicitly awaited queued tests

2026-10-16. **Recommendation: treat issue 14 as a scheduling-policy change distinct from 001-381.** The controlled reproduction succeeds on 0.1.199 and 0.1.200. It matches the current read-only named-wait contract; it does not reproduce the original Cezarion session. Automatic versus opt-in promotion remains a human decision.

Sources and code below are at `80bad645b2263aea878499f1336c28d9eef0c6c9` (0.1.200), unless marked 0.1.199. [Probe and exact commands](probes/issue-14/README.md), [0.1.199 output](probes/issue-14/0.1.199.ndjson), [0.1.200 output](probes/issue-14/0.1.200.ndjson), [issue snapshot](probes/issue-14/issue.json).

## Questions answered

| Question | Answer and evidence tag |
| --- | --- |
| 1. Does the reported behavior reproduce? | **verified by experiment**, 0.1.199 and 0.1.200: a short selected file stays queued while an unrelated queued tier starts, despite an active named wait. The original edited-policy-test session is **not determined**, because its store, run trace and workspace were not supplied or replayed. |
| 2. Does this fit the vision and existing contract? | **read in source code**, 0.1.200: named waits select evidence but send no scheduling intent. **inferred**, from the vision and 005 D2: prioritizing explicit demand fits fast relevant feedback, but changes an intentional policy boundary. |
| 3. Is it already covered by a board row? | **read in source code** (repository docs at the base commit): 005-11 explicitly excludes reordering; 001-381 concerns an in-flight tier. Neither implements promotion ahead of unrelated queued tiers. |
| 4. Which delay does the probe establish? | **verified by experiment**, both versions: the initial running-tier wait and a subsequent unrelated queued-tier wait are distinct. Both timeout results are truthful; this is not a false-pass reproduction. |
| 5. What needs a human decision? | **inferred**, from the explicit prior decision: whether to revise the read-only contract, automatic versus opt-in promotion, and how promoted demand ranks against edits, failures, fairness and shared claims. No option is chosen here. |

## Reproduction and its limits

**verified by experiment**, 0.1.199/0.1.200, Node v24.21.0, Vitest 5.0.3. A fresh Git fixture has three independent files, one Vitest worker, `runner.tierSize: 1`, `runner.backlogTierSize: 1`, `baseline.onStart: "lookup-then-run-missing"`, and runtime observation disabled. A and B wait on externally released gates. Z only checks `1 + 1 === 2`; its body took 1 ms in each saved run. No file has a previous duration or result. There are no edits during the scenario, no forced reruns, no slow-class files and no shared fixture keys.

The probe starts a real daemon. Once A is running, it starts `status --wait 60000 z-selected.test.mjs`, which stays active through the tier boundaries. Concurrent one-second waits provide bounded snapshots. SQLite is read only, to distinguish queued from running; no store records are injected.

| Observation | 0.1.199 | 0.1.200 |
| --- | --- | --- |
| Before waiting | A running; B and Z queued | Same |
| First `status --wait 1000 z-selected.test.mjs` | Exit 3, 1 selected file pending | Same |
| A released; next tier begins | B running; Z still queued | Same |
| Second one-second named wait | Exit 3, 1 selected file pending | Same |
| B released; Z completes | Long wait exits 0 after 3.4 s | Long wait exits 0 after 2.8 s |
| Repeated named wait after current result | Exit 0 after 0.5 s; no new test events | Same |
| Actual test start/end order | A start/end, B start/end, Z start/end | Same |

The timeout output in both versions was:

```text
Named test files have no verdict: the deadline passed after 1.0 s: 1 test file still pending at revision 0
Selected: z-selected.test.mjs
```

0.1.200's eventual output was:

```text
Named test files at revision 0: no known failures; 1 test file, each with a current result, after 2.8 s
Selected: z-selected.test.mjs
```

A finishes normally, establishing the already-running delay. The next snapshot proves the additional queue-order delay: B had been queued when demand for Z was expressed, yet B starts first. Z remains queued until B finishes. The gates control delay, so these are not estimates of production latency. The configured one-file backlog tiers expose a boundary that a default 200-file backlog might not have between these files. Unknown durations avoid the existing shortest-known-duration ordering. A selected file already admitted to the current tier is a different case; this experiment does not show that promotion could shorten that tier.

The original report describes an edited file with repeated 60-second deadlines and a several-minute delay. Those timings, its priority class, which files shared its tier, any claimed keys, and its capacity constraints remain unknown. This probe establishes the missing named-demand scheduling mechanism, not the causal breakdown of that session.

## Source trace and overlap

**read in source code**, 0.1.200:

- `src/cli/status-wait.ts:400` routes paths to `namedWaitCommand`. `src/cli/status-wait-paths.ts:174` reads selection and current-key verdicts until settled, unmatched, no daemon or timeout; `namedCode` returns 3 on timeout. It does not change queue entries.
- `src/cli/status-sync.ts:73` sends `sync`, then `sync-status`, with no selected paths. The handler at `src/core/daemon/handlers.ts:202` reconciles the workspace and records activity. Thus the spec's phrase “no daemon request” in 005 D2 must be read as no scheduling request: reconciliation traffic does exist.
- `src/core/scheduler/queue.ts` orders recent work, priority class (failing/direct/transitive/never-run), known duration, enqueue sequence, then project/path. It has no named-demand class. After four recent-only tiers while backlog waits, backlog gets a turn.
- `src/core/scheduler/tiers.ts:137` skips busy lanes, reuses current results before running, respects claims and tier limits, and requests backlog capacity. These are distinct reasons a future promoted file might still wait. `src/cli/status-wait-lines.ts:139` currently names selected pending counts, not a per-file queue position or cause; the preserved output shows aggregate running/queued counts only.

**read in source code** (repository docs), base commit:

| Existing work | Relationship to issue 14 |
| --- | --- |
| 005-11, shipped 0.1.133; 005 D2/status amendment 2026-10-13 | Named selection already exists. Human decision: “a named-file wait does not move the file forward in the queue, not for now.” A change belongs to 001's scheduler, with 005 adding the CLI over its request. This is the direct policy overlap. |
| 005-22, shipped 0.1.134 | Repairs false exit 0 before sync at deadline. Probe exits 3 correctly; a different issue. |
| 001-381, planned | Research on splitting an already-running backlog tier for an edit. Issue 14 expressly keeps running work intact and asks for queue promotion. Related user wait, different trigger and boundary. |
| 001-100/001-107, shipped | Edit-first scheduling and backlog fairness exist. An explicit wait is not an edit, and these do not add named demand. |
| 001-124, 001-140/001-150, 001-184, shipped | Backlog batching/cancellation, separate runner lanes and comparable-duration edit tiers reduce other waits. They do not promote selected queued files within one lane. |
| 006-55, done | Eval credit for named results only, not the whole suite. No scheduling change. |

001 D5 already describes cancellation of certain running backlog tiers on edits; the still-planned 001-381 row also proposes splitting running work. Their exact remaining overlap needs that row's research. It does not make issue 14's named-demand gap a duplicate.

## Alignment and decisions left open

**inferred**, from `docs/vision.md` principles 2, 3 and 4 and 005 D2: prioritizing an agent's explicit dependency can improve fast feedback without weakening current-key truth. The tradeoff is scheduling fairness: named demand could outrank work from newer edits or other consumers. The existing deliberate read-only boundary and cross-worktree claim rules make this a policy change, not just a CLI timeout fix.

Human decisions for a later spec:

1. Revise the prior “not for now” decision; if so, promote automatically on a named wait or require a separate explicit option?
2. Where does explicit demand rank relative to failing files, edit-first work and the backlog fairness turn? Does its lifetime end with the wait, or persist until selected keys settle?
3. Does promotion apply to source-path selections, slow-class files and keys claimed by another worktree? Which constraints remain binding, and what should output say when they hold a selected file?

No design or product change is made. No claim that queue promotion alone would have removed the original several-minute delay.

## Verification and sources

**verified by experiment**, base checkout: both probe processes exit 0 and stop their own daemons; lint, typecheck and build exit 0, with no tracked bundle drift. The repository Squeal full-suite checkpoint exits 1 with two current baseline failures in unchanged recorder-fidelity checks (`run-reads-fidelity.test.ts:116`, `observe-fidelity.test.ts:119`). This research does not diagnose or repair those failures. [Verification output](probes/issue-14/verification.txt).

- [Issue 14](https://github.com/hearsay-tools/squeal/issues/14), fetched with `gh`; its original-session account is reported evidence, not independently verified here.
- [001 spec D5/D7](../spec.md), [001 status](../status.md), [board](../../../board.md), [vision](../../../vision.md).
- [005 spec D2](../../005-agent-adoption/spec.md), [005 status](../../005-agent-adoption/status.md).
- Source paths above and the version hashes/commands in the [probe README](probes/issue-14/README.md).
