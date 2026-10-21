# Research: issue 63, a current named wait behind a superseded running tier

Researcher, 2026-10-21, worktree `cez/7e9e9606` at 894238b11 (`package.json` 0.1.234). [Issue #63](https://github.com/hearsay-tools/squeal/issues/63), reported on Squeal 0.1.233 during hearsay-tools/cezarion#1270: a unit regression failed at revision 2 (22:56:47Z); revision 3 saved the fix; a Vitest tier of four files started 22:56:49Z; repeated `squeal status --wait 60000 packages/cezar/src/workflows/waits.test.ts packages/cezar/src/workflows/waits-claude-parity.test.ts` timed out with `queued, promoted, behind the vitest tier ... no command runs them sooner (a running tier is not interrupted)`; the regression went FAIL to PASS at 23:03:35Z with a 0 ms duration. About 6 min 46 s of wait for a 0 ms test. The daemon stayed alive.

Environment: host 24 CPUs (`nproc`). One-minute load 12.57 at the start, 16.17 before the first probe run, 15.99 before the recorded run, 24.21 after it (`probes/issue-63/results.txt`). Each live run started below the CPU count, so the brief's skip rule allowed it. `npm ci --ignore-scripts`, node v24.21.0, Vitest 5.0.3. No build, no suite. The probe is synthetic and in-process: a fake runner, a real store and a real scheduler, no Vitest child processes. The original cezar store, daemon log and test durations were not available.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a current named wait stay blocked behind a superseded running tier? | **Yes.** An edit's tier of four slow files in flight, superseded by the next revision, is not cancelled. It runs all four files to the end; the promoted regression at the new revision starts 8 ms after the tier ends; then the four files run again at the new key. | verified by experiment (0.1.234 tree) |
| 2 | Is that the designed behaviour? | Yes. C4 step 5: "A tier with any work an edit caused in the queue ... is never cancelled by a new revision." C15 Rank: "A running tier, whether an edit's or the backlog's, is never cancelled or split for promotion: that question belongs to 001-381." Only a backlog tier (`tier.cancel !== null`) is cancelled by a revision (`cancelsBacklog`). | read in official docs (spec 011 C4 step 5, C15), read in source code |
| 3 | Was the cezar tier an edit's tier? | Most likely. Four files is `runner.tierSize`'s default. Revision 3 re-keyed the regression, so it queued an edit's work in the Vitest lane; a backlog tier there would have been cancelled (forced after 1 s). Only an edit's tier explains a 6 min 46 s wait without a cancel. | inferred |
| 4 | Is the work duplicated? | Yes, when the new revision re-keys the tier's files (case A): the tier's results are discarded as superseded (`supersededIn`) and all four files run again. When it does not (case B), the wait is the same but nothing reruns. | verified by experiment |
| 5 | Overlap with 001-381, gh-51, gh-61 | 001-381 owns splitting a running tier, but its wording names only the backlog tier; this is an edit's tier, which 001-381 does not name. gh-51 is the queued-file promotion; #63 starts where it ends (already promoted). gh-61 names running files; it would let the caller see the four holders. | read in repository docs and issues |
| R | Reproduction verdict | **Reproduced in synthetic form, not as the original.** The block, its cause and the duplicate rerun reproduce at 3 s scale. Not reproduced: cezar's four files, their real durations, whether revision 3 re-keyed them, and the Vitest cancel path on real child processes. | verified by experiment / not determined |

## 1. The probe

**Verified by experiment.** `probes/issue-63/superseded-tier.probe.ts`, output in `probes/issue-63/results.txt`. Files: `test/reg.test.ts` (1 ms known, 0 ms real; imports `src/waits.ts`, `src/shared.ts`) and `test/slow1..4.test.ts` (100 s known, 3 s real). Policy `tierSize` 4, `hostSlots` 8. After a baseline, revision 2 edits `src/waits.ts` and `src/shared.ts`. The scheduler runs `reg` alone, then `slow1+slow2+slow3+slow4` (001-184 keeps a 1 ms file out of a 100 s tier). With the slow tier in flight, revision 3 edits again and `scheduler.promote([reg], 60_000)` runs, as a named wait does.

| Case | Revision 3 edits | Slow tier cancelled | Slow files completed | Slow tier end (from rev 3) | `reg` rev-3 start | Slow files rerun |
|---|---|---|---|---|---|---|
| A superseded | `src/waits.ts` (input of all five) | no | 4 of 4 | 2975 ms | 2983 ms, alone | 4 (one tier) |
| B not superseded | `test/reg.test.ts` only | no | 4 of 4 | 2961 ms | 2967 ms, alone | 0 |

All files current at the end in both cases, so no superseded result counts as current. Command (repository root):

```
npx vitest run -c docs/specifications/011-core/research/probes/issue-63/vitest.config.ts --reporter=verbose
```

Limits against the cezar incident: the fake runner ends a run at its slowest file's `realMs`; real Vitest tiers carry startup, transform and load. The fake runner honours a cancel, as Vitest's adapter does; that the scheduler never sends one to an edit's tier is what the probe shows, not the cancel's cost. The scale is 3 s, not 6 min 46 s; the order does not depend on the scale.

## 2. Why the tier is not cancelled

**Read in source code** at 894238b11:
- `src/core/scheduler/scheduler.ts` `#cancelBacklogs` (line 328): aborts only tiers with `tier.cancel` set; the pump's comment (line 539): "An edit's tier in flight is never cancelled by a new revision; a backlog tier is".
- `src/core/scheduler/tiers.ts` line 71: `cancel` is "`null` for an edit's tier".
- `src/core/scheduler/backlog.ts` `cancelsBacklog`: a revision cancels a backlog tier when it queues an edit's work in the lane or changes an input of the tier ("its results ... the stability check would discard"). The same condition holds for the superseded edit's tier in case A, but the rule is not applied to it.
- `src/core/scheduler/store-decision.ts` `supersededIn`: a newer key for the file discards the run's outcome, which is why case A reruns all four.
- `src/core/status/next-step.ts` line 54 and line 214: a named wait on a queued file behind a running tier prints `no command runs {it} sooner (a running tier is not interrupted)`, the issue's text.

**Read in source code**: `src/runners/vitest/gate.ts` runs one Vitest `run` at a time per instance, so an edit's tier cannot start beside another in the same Vitest lane. Cutting the wait in Vitest needs the cancel; node:test and pytest could instead start the edit beside (011-21 slice 1).

## Recommendation for Squeal

The issue is real and by design. A decision for the human, not a triage fix:
1. **Cancel a superseded edit's tier** (C4 step 5 amendment): apply `cancelsBacklog`'s input test to an edit's tier in flight when the new revision changes an input of the tier, so its results would be discarded anyway. Files that ended before the cancel keep their results under the stability check, as for a backlog cancel. This bounds case A by Vitest's cancel (forced after 1 s) and removes the duplicate rerun. It meets the issue's "no duplicate test work" and "superseded results cannot count" criteria. Tradeoff: an edit that saves often can cancel the same slow tier again and again; a fairness bound (for example, no more cancels of the same files than the four-tier rule allows) would be needed.
2. **Case B stays bounded by the running tier.** Its results are still valid, so cancelling them is waste. Leave it to 001-381's split, or to an honest active-holder line (gh-61's file names, plus the tier's start and estimated end).
3. **Route under 001-381**, widening its wording from "an edit splits its own daemon's running backlog tier" to any running tier a newer revision supersedes. Do not fold into gh-51.

Holds preserved: no implementation; 001-381 keeps the running-tier question; the eval hold, `lookup-only` (011-33) and the 011-25 cut are untouched; nothing moves a key.

## Open questions

- Whether cezar's revision 3 changed an input of the four running files (case A) or only the regression's closure (case B): not determined, because the cezar store and daemon log were not read. It decides whether recommendation 1 would have helped this incident.
- Which four files ran and their durations: not determined, same reason. gh-61's file names would have answered it.
- Cost of Vitest's cancel on real child processes for an edit's tier: not measured; C4 step 5 records forced after 1 s for the backlog cancel.
- How often a save lands mid edit-tier: not measured; 001-381 plans that measurement for the backlog tier.

## Sources

- Issues: `gh api repos/hearsay-tools/squeal/issues/63`, `/51`, `/61`.
- Spec: `docs/specifications/011-core/spec.md` C4 step 5 (line 123), C4 step 4 amendment (line 154), C15 Rank (line 335); C2 (revisions, line 72) and C6 (status, line 183) for the revision and wait vocabulary only.
- Board rows: 001-381, gh-51, 011-17, 011-21, 011-24 (`docs/board.md`).
- Prior research: `research/issue-51.md`, `research/streaming-lanes.md`.
- Source at 894238b11: `src/core/scheduler/scheduler.ts`, `backlog.ts`, `tiers.ts`, `store-decision.ts`, `queue.ts`; `src/core/status/next-step.ts`; `src/runners/vitest/gate.ts`; fixture `test/scheduler/catch-up-fixture.ts`.
- Probe: `probes/issue-63/` (README, probe, config, `results.txt`).
