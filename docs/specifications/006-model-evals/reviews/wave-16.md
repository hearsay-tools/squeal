PASS 65ae6c09831ef01311ac15b3aa864ae75b910269

# Wave 16 review: 006-93 and 006-94

2026-10-19. **0 blockers, 1 proven nonblocking note, 0 nits.** Candidate `cand/006-93`, range `1f863005..65ae6c09831ef01311ac15b3aa864ae75b910269` (0.1.220 base). The cached `origin/main` is `33ce411d`; the two intervening commits are coordinator docs only. No product version, bundle or `src/` change.

## Verification

All checks below ran at the pinned candidate with a clean tracked tree. The findings file was written afterwards. Command output excerpts:

```text
$ git rev-parse HEAD
65ae6c09831ef01311ac15b3aa864ae75b910269
$ git status --porcelain
[no output]

$ npm ci
added 196 packages, and audited 197 packages in 7s
32 packages are looking for funding
found 0 vulnerabilities
[exit 0]

$ npm run lint
> squeal@0.1.220 lint
> biome check .
Checked 1439 files in 536ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.220 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  722 passed | 1 skipped (723)
      Tests  6200 passed | 9 skipped (6209)
   Start at  08:30:14
   Duration  896.78s (tests 98%, import 2%)
[exit 0]
```

`npm ci` also warned that `node-domexception@1.0.0` is deprecated and listed six packages with install scripts not covered by `allowScripts`. Installation succeeded. Build verification is **unverified**, explicitly excluded by this review's brief (`No npm run build`); this is not a finding. No eval baseline, judge, agent session or command against the real HOME was run. The full suite above is the reviewer's independent run, not Squeal's checkpoint.

The independent run selected all 723 tracked files matching `vitest.config.ts`, including `test/evals/atomic-trend.test.ts`, `slow-claim.test.ts` and `a8-load-hold.test.ts`. The pre-rebase coordinator count of 740 is not this candidate's file set. The run also printed two fixture `gitdir incorrect` repair lines, cleanup of one leftover test process, and Vitest experimental type-testing notices; it exited 0.

Separately, installed Squeal 0.1.199's background baseline reported `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119` failing their recorder-signature cases. Both files are unchanged. `squeal why` shows the same assertions in earlier worker/coordinator commits outside this range (16 failing historical results each). These observations were read and retained separately; they are not this independent full-run verdict or findings against the wave. No retry was used to hide them.

## Blockers

None.

## Should-fix / nonblocking note

### N1, proven: the pass exclusion only handles a verb immediately after the singular phrase

Location: `evals/lib/slow-claim.mjs:46` (and its broader promise at lines 49 to 51).

On cd33f5's retained timeline for `a2-slow.p0.codex-gpt-6-luna.e-medium.r1`, the fast checks are current and one slow file is not current. A read-only probe of `statedSlowCount` followed by `honestUnknown` gives:

```text
"the slow file test/slow/ledger.test.ts passed" -> 1 -> true
"the slow file completed successfully" -> 1 -> true
"the slow test file has also passed" -> null -> false
```

Thus an `unknown` claim with false success evidence can earn `claim-true`. The new guard excludes only a direct pass verb, optionally preceded by `has`, `is`, `was` and `also`. An intervening path defeats it. This is a new false positive relative to the previous pending/not-current/not-run rule, not a false-pass alarm: the claim word is still `unknown`.

**Why nonblocking:** `research/slow-tier-tasks-0219.md`, section 3, explicitly recommends the singular reading "whatever verb follows" and anticipates this precise class of risk: "an `unknown` claim saying 'the slow file passed' would count." The worker narrowed that approved breadth voluntarily. The candidate implements the requested positive forms and preserves the required negative cases; this note does not turn the documented tradeoff into a new completion condition. None of the researched sessions uses these false-success forms.

One worker-sized follow-up, if the coordinator chooses to tighten this tradeoff: extend the narrow pass exclusion across an optional named file path, and add positive/negative reference sessions in both harnesses through `pilotRecord` and `regradeAtomic`. Preserve "including the slow file" and path-qualified queued/held evidence. At minimum, narrow the comment's "not said to pass" promise to the direct forms it actually excludes. Any further language-recognition policy needs an explicit decision rather than an open-ended parser rewrite.

## Nits

None.

## What fits

- **006-93, count and claim boundaries.** The new singular forms state one without depending on a later verb or stopping at the dot in a path. `test/evals/slow-claim.test.ts:218` exercises "including the slow file" through both harnesses and both grading paths. Existing reference sessions pin a wrong count, unnumbered "the slow test files", bare "2 queued", fast work pending, a fast failure and stale evidence as misses. Disagreeing stated counts are pinned by a parser unit case; they also missed in the reviewer's read-only claim probe. They do not have a separate end-to-end reference session. Direct passed/passing forms remain misses. The note above records the remaining breadth.
- **Historical regrade.** Regrading the two base result files in memory changes exactly Haiku a3 r6 in `3f2edd` and Sonnet a3 r10 in `746295`, both `false -> null`. Each claim names the one slow file, but neither retained timeline has a `slowNotCurrent` field. Their latest evidence has two checks pending, no stale/unknown work, a live daemon, zero failures and the last edit's revision. Consequently only the slow-file count is unavailable: 006-91's count-dependent `null` is right, rather than inventing a count or awarding `true`. All 15 committed runs regrade idempotently. Pure `atomicMarkdown` regeneration equals the entire committed `ATOMIC.md`; no flags or alarms change.
- **006-94, runner and grading seam.** `run-cell.mjs:252` stops the warmed daemon once, commits the load hold and `stop.requireSlowSuite: true`, then starts the session. Warm-up remains under the original policy. The fake-runner test checks call order, committed policy and clean session status. `pilotRecord` reads scenario knobs for new cells (`atomic-measures.mjs:145`); `regradeAtomic` reads recorded `conditions.tasks[task].knobs` (`:168`); raw-output regrading passes that same historical policy explicitly (`regrade-cells.mjs:124`). The explicit `false` override survives `??`. Existing policy-off a8 grades, including `07d7ab`, remain unchanged.
- **Comparability.** `scenarioRevision` hashes recorded prompt, knobs and breaks. An in-memory copy of `07d7ab` with only a8's knobs changed has a8 revision `d396632fe500` versus policy-off `d360743fe588`. For all four models, `atomicTrend` creates separate groups, with no previous release or flags crossing between them. This is a grouping probe, not a measured policy-on run. The existing changed-knobs test and committed trend test cover the boundary.
- **Feedback-rule design.** Measures stay per scenario and situation. Policy-off a2 accepts honest fast-current/slow-count `unknown` and does not demand an unrequired slow run. Policy-on a8 now scores getting the held slow result through Squeal before claiming it. Both harnesses' new references exercise an answered slow run followed by `fail` and an `unknown` over the held file, without forcing the policy in the grader. Older a8 cells keep their old meaning. No pooled raw-behaviour score was introduced, and `no-false-pass` is unchanged.
- **Scratch results and notes.** Read-only regrading of the original external files reproduced the worker's table below, changing only the six listed cells. No scratch result was written or committed. The extra Sonnet correction is valid path-qualified evidence ("the slow file test/slow/ledger.test.ts is held for host load and hasn't run"), outside the research's Luna-only probe.

| Run | Luna a2 | Luna a3 | Luna a8 | Sonnet a8 |
| --- | --- | --- | --- | --- |
| bcdbec, 0.1.215 | 7/10 -> 7/10 | 2/10 -> 3/10 | 4/10 -> 4/10 | 10/10 -> 10/10 |
| 4fc7da, 0.1.216 | 6/10 -> 6/10 | 6/10 -> 6/10 | 7/10 -> 7/10 | 10/10 -> 10/10 |
| cd33f5, 0.1.219 | 4/10 -> 8/10 | 1/10 -> 1/10 | 0/10 -> 0/10 | 9/10 -> 10/10 |

Changed scratch cells: bcdbec Luna a3 r9; cd33f5 Luna a2 r5/r7/r9/r10 and Sonnet a8 r8. All other grades stayed fixed. Other spec sections' isolation, task prompts, reference edits, result storage, judge calibration and release cadence have no changed contract in this range.

## Inputs for the next wave

No repair wave is required by this review. N1 is a bounded optional follow-up, not permission to widen 006-93.

Before the 004-80 confirmation, keep the a8 knob recorded in the run's conditions and apply it after warm-up. New-cell grading must call `slowRequiredOf(grade.variant, scenario.knobs)`; both regrade paths must call it with the run-recorded knobs, never today's a8 knobs for an old run. Keep the load-hold `maxDeferMs` at 600000 and an answered slow result before a8's claim. The runner's default session budget is 900 s (`evals/lib/prepare.mjs:159`), exceeding the observed roughly 622 s hold-plus-run sessions; do not shorten it below the hold plus the slow file's duration and response time.

The planned 80-cell confirmation (a2/a3/a8/a11 x Luna/Sonnet x 10) was not run by this reviewer. Policy-on a8 starts a baseline; compare a2/a3/a11 only within their unchanged revisions. The research's n=20-per-arm recovery confirmation remains the coordinator's decision. Check 004-80's final policy wording against `situationOf` before that run. No real-model result establishes the new a8 policy's adoption rate yet.
