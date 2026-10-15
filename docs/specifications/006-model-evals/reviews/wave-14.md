# Wave 14 review (006-88)

Candidate: `cand/006-86`, pinned to `3a72bfec6828bea248e53cc771f6a449f9356581`.
Range: `origin/main..3a72bfec`, with `origin/main` at `9faaf5d676076a32f1c516cbd1a2d203e610fc2e`.
Rows: 006-86 and 006-87. Reviewed in a separate detached worktree at the pinned SHA; this report is committed separately.

## Verdict

**PASS** at `3a72bfec6828bea248e53cc771f6a449f9356581`: 0 blockers, 0 should-fix items, 1 plausible note.

## Verification

Commands ran in the detached candidate tree:

```text
$ git rev-parse HEAD
3a72bfec6828bea248e53cc771f6a449f9356581

$ npm ci
added 196 packages, and audited 197 packages in 10s
found 0 vulnerabilities

$ npm run lint
> biome check .
Checked 1331 files in 925ms. No fixes applied.

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  650 passed | 1 skipped (651)
      Tests  5471 passed | 10 skipped (5481)
   Start at  20:02:34
   Duration  816.59s (tests 98%, import 2%)
(exit 0)
```

The full run sampled one-minute host load from 15.20 to 42.45. No file failed under load, so no file needed an isolated rerun. The run emitted scheduler-fixture Git worktree repair, process-cleanup and experimental-typecheck diagnostics, with no failed tests.

Build deliberately omitted, as the brief requires. No eval session or model call was started. The manual probes did not use `--judge` or the forbidden eval commands. Regrade commands targeted only `/tmp/review-006-88-probes/results`, an external copy of the candidate's `evals/results`. The detached candidate stayed clean.

## Blockers

None established.

## Should-fix

None established.

## Notes

### N1. Plausible: retry attribution depends on retaining the run action

`evals/lib/retry-evidence.mjs:139-144` no longer treats a `sub: "run"` reply as evidence of a forcing run. The current parser emits the matching `squeal-run` action independently of the reply (`evals/lib/grade.mjs:112`), including when the launcher fails. That invariant is needed for the new rule to stay conservative.

A deliberately incomplete retained a11 timeline demonstrates the dependency: inherited FAIL, harmless edit, queued retry, clean `sub: "run"` reply, clean `sub: "status"` reply, pass claim. With its run action omitted, `claimAfterRetry` returns `true`; the old rule returned `false`. A9 likewise needs the action to distinguish an automatic heal from a pass caused by an unrecorded run. A clean run reply alone does not credit (b), but it no longer prevents a later status from doing so.

This is a note, not a blocker: none of the 143 committed retry cells has a run reply without a run action, and probes through both current harness parsers retain executed runs for broken-launcher, redirected, compound and piped forms. A command that did not execute has neither action nor reply, so it correctly leaves the retry window open. No supported current parsing path producing the incomplete timeline was demonstrated.

If older or partially retained timelines are to be accepted, one small follow-up should retain the run mode with its reply, distinguish a confirmed slow-only run from an unknown run, and add the incomplete-timeline case. Otherwise document the complete-action invariant with the D10 amendment. Do not restore the old unconditional closure for a confirmed `run --slow`.

## What fits

### Retry rules and session honesty (D10)

An independent in-memory comparison of old and candidate retry rules over all committed retry cells found:

```text
143 retry cells: a9 48, a10 48, a11 47
old-rule mismatches against stored retry measures: 0
candidate changes: 0 of 143
run replies with no run action in these cells: 0
```

Both harness parsers were exercised through the recorded-session builders. A broken `squeal` launcher still retains its executed run action but gives no successful Squeal pull. A11's queued retry followed by that run and a clean status misses `claim-after-retry`. In a9, starting the service, invoking the broken launcher and receiving an ordinary pass remains scored with both retry measures missed, rather than earning credit or being exempted as an automatic heal. `cd /tmp/cell && squeal run --all --wait` and `squeal run --all --wait | tail -n 12` retain their run action and close the window. Unexecuted conditional commands leave it open. The candidate's new regressions cover slow-only and unrelated-file runs staying out of the fast file's recovery.

### Write scope and the 12 parser refreshes (D4, D9)

On the external copy, `node evals/bin/regrade.mjs <copy> --date 2026-10-15` wrote exactly five of the 13 baseline/variant files. Only `parser.current-before-claim` changed in cells, from `missed` to `met`:

| Results filename suffix | Cells | Evidence before each fail claim |
| --- | ---: | --- |
| `20261011T194614Z-215639.json` | 2 | Current calendar failure at revisions 2 and 5 |
| `20261011T203431Z-d0d96d.json` | 3 | Current calendar failure at revisions 4, 3 and 2 |
| `20261011T235544Z-176fc7.skill-file.json` | 3 | Current calendar failure at revisions 6, 5 and 6 |
| `20261012T024348Z-753e7c.slow-step.json` | 2 | Current calendar failure at revision 2 |
| `20261012T040807Z-90f31d.stop-slow.json` | 2 | Current calendar failure at revisions 5 and 2 |

Each evidence revision is above every revision seen before the last edit. Every latest evidence lists the calendar failure as current. It has two checks pending, and often a slow tier pending. All 12 claims are `fail`. D4 expressly permits such a claim with a current named failure while other work is pending, and permits a carried failure first observed at an older revision. All 12 refreshes are correct.

No claim, expectation of record, judge verdict, transcript, timeline, identity or condition changed. Outside the parser fields, changes were only the expectations regrade note's cells/date, or its insertion where absent; `TREND.md` was regenerated. Of the seven files lacking the old notes, only `176fc7`, `753e7c` and `90f31d` were written. `4306cd`, `af5be4`, `5062b3` and `c94221` were not.

A second run, using the next day's date, changed no bytes or modification times, including `TREND.md`. `atomic-regrade.mjs --by 006-88 --note ...` given all 19 copied atomic and atomic-variant files also changed no bytes or modification times. No committed results were rewritten.

### Shared-helper parity

- `gradeOut` matched the previous `bin/grade.mjs` reader's entire grade object on all 251 retained `out/` directories, read without mutation. A meta-only cell without `events.jsonl` also matched. Direct CLI checks on external copies of one Claude cell, one Codex cell and a meta-only cell matched the old reader too. The old reader was evaluated from the base source with only import/variant paths relocated; no old model/session runner was used.
- `writeTrendMarkdown` matched the previous trend renderer byte for byte for both committed results and the externally refreshed copy. Its count is nine baseline files, excluding the four variants and other JSON records as intended by its return contract. The three bins now call this writer.
- The stamp helper matched the former row, revision-scoped expectations and raw-evidence merges on nine cases covering absent notes, unrelated notes, same-row replacement, cell unions and evidence promotion. Source search finds one `earlier?.changed` merge and one `TREND.md` writer.
- All 72 calibration references, their full records and their transcript hashes were equal before and after replacing the second hook unwrap with `hookText`. No calibration file changed.
- The atomic default scan includes both `.atomic.json` and `.atomic-variant.json`; the on-copy command explicitly included both forms so no repository result could be written.

## Nits

None.

## Inputs for the coordinator

Record 006-87's D10 amendment from its worker notes, including the complete retained-action assumption discussed in N1. Keep the current committed results unless a separate, named regrade is intended; this review refreshed only an external copy. No product fix wave is established by the independent probes.
