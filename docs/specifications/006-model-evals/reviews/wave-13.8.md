# Wave 13.8: 006-81 review of 006-77

FAIL `7da121b6bfd4cb8a9cdf995e9f46e919c6c8d609`: 1 proven blocker, no separate should-fix, 1 plausible note.

## Verification

Reviewed `origin/main..7da121b6`, with `origin/main` at `a8fedcc15c3c1d363bdcdce1e8a7f9a20694a50a`.
The detached candidate worktree is `/tmp/squeal-review-006-81`. The report alone is written in the reviewer's worktree.

```text
$ git rev-parse HEAD
7da121b6bfd4cb8a9cdf995e9f46e919c6c8d609

$ npm ci
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1294 files in 388ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /tmp/squeal-review-006-81

 Test Files  634 passed | 1 skipped (635)
      Tests  5333 passed | 9 skipped (5342)
   Start at  17:35:30
   Duration  732.79s (tests 98%, import 2%)

    Isolate  635 workers spawned · ~119ms startup each (spawn + environment, per file)
[exit 0]
```

Build unverified, omitted by the explicit brief. No cell, subject session, judge or model was started. None of the forbidden CLI scripts was run. The historical checks below import library functions and write no results files.

`git status --porcelain=v1` was empty after the checks, at the pinned SHA. The independent run waited for the host lock, then ran for 732.79 s. One-minute load sampled during it ranged from 6.49 to 30.33 on 24 CPUs. No test file failed under load, so there was no alone rerun. The run also printed temporary-worktree repair lines, an earlier-process cleanup message and Vitest's experimental type-testing warnings; its final verdict was passing.

## Blockers

### B1 (proven): JSON fields that Claude never receives become current evidence

Location: `evals/lib/squeal-text.mjs:87` to `:90`, particularly the unconditional array at `:88`. The regression at `test/evals/header-forms.test.ts:164` even treats `permissionDecisionReason` on a `PostToolBatch` object with no deny decision as a delivered reason.

D4 requires “Squeal evidence the agent saw” at the claim, and goal 3 requires “the right behaviour at the right moment.” `hookText` instead takes every string from `additionalContext`, `permissionDecisionReason` and top-level `reason`, without checking the event or decision. It consequently promotes diagnostic JSON into live evidence.

A valid `PreToolUse` hook may return `permissionDecision: "allow"` and a `permissionDecisionReason`. Claude's [documented decision control](https://code.claude.com/docs/en/hooks#pretooluse-decision-control) says that for allow and defer the reason is “written to the debug log only.” Only deny, and a refused ask in a headless run, send that reason to Claude. A stop's top-level reason likewise requires a blocking decision. These are distinctions between fields the agent saw and fields merely recorded in the stream, not an assumption about a model's interpretation.

Source-only reproduction, through `claudeTimeline` and `gradeCell`, at the pinned candidate:

```js
import { claudeTimeline } from './evals/lib/transcript.mjs';
import { gradeCell } from './evals/lib/grade.mjs';
import { currentBeforeClaim, claimedOnEvidence } from './evals/lib/evidence.mjs';

const text = 'SQUEAL · registered at revision 2\n' +
  'Revision 2: 30 current (23 tests, 7 test files loaded), 0 pending, 0 stale, 0 unknown.\n' +
  'Known failures: 0';
const output = JSON.stringify({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'allow',
  permissionDecisionReason: text,
}});
const final = 'TESTS: pass, evidence: status';
const timeline = claudeTimeline([
  { t: 1, type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'src/money.ts' } },
  ] } },
  { t: 1.5, type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'e', content: 'ok' },
  ] } },
  { t: 2, type: 'system', subtype: 'hook_response', hook_name: 'PreToolUse:Bash', output },
  { t: 3, type: 'assistant', message: { content: [{ type: 'text', text: final }] } },
  { t: 4, type: 'result', result: final },
]);
const { retained } = gradeCell({ timeline });
console.log(currentBeforeClaim(retained, 'pass'), claimedOnEvidence(retained, 'pass'));
```

```text
origin/main parser: false false
candidate parser:   true true
```

There is an edit and a pass claim but no delivered validation at those inputs. Both expectations must stay missed. The same false credit occurs with a non-blocking top-level `reason`, or an unrelated hook's JSON `reason` holding a quoted Squeal status. This is new credit from the unwrap, not merely a pre-existing unparsed form.

**One-worker fix:** choose only fields the hook's event and decision deliver to the model. Keep ordinary JSON fields out of the evidence path; returning the entire unrecognized JSON to the loose text parser is insufficient once its counts can match. Preserve real additional context, actual denies and actual stop blocks. Add negative regressions for allow-only reasons and root reasons without a block, alongside positive tests with the actual deny/block schema. Re-check the named 14-cell comparison. No rubric or retry-rule change is needed.

## Should-fix

None separate from B1.

## Notes

### N1 (plausible reach): unrelated hooks can quote Squeal inside real additional context

The transcript's upstream `SQUEAL_TEXT` test is a substring search; `hookText` does not establish that the context is Squeal's own report. A synthetic unrelated hook with `additionalContext: "Example SQUEAL output for documentation, not current validation:\n" + text` earns both at-claim expectations after the change. The cell setup isolates plugin hooks, and I found no such event in the kept raw cells, so this is a note about the boundary, not another blocker. Keep an explicitly quoted example as a negative case if tightening that boundary. A normal `cat sample-hook.json` tool result, with no Squeal command, is **not** evidence: `gradeCell` never sends it to the unwrap. That control passed.

## What fits

- **Counts with parts.** All four outer counts remain distinct. Source inspection of `partsSuffix`/`countsText` shows the parentheses name tests and file-level checks, not a second state. Twenty source-only checks cover plain and wrapped headers, nonzero pending/stale/unknown counts, slow pending/queued/running/not-run, and revision precedence. No pending state disappeared. Additional probes preserved pending/unknown test files without checks and a pending runner part.
- **Actual Claude deliveries.** Unwrapping real `additionalContext` exposes the line-anchored `FAIL`/`PASS` blocks, slow-tier state, known failures and retry notes together. A wrapped failure still misses `no-overclaim`; a wrapped pending slow tier still misses a pass claim's currency. The new tests cover these near variants.
- **Cut-status revision.** The checkpoint's “the counts are for revision 5” beats a check first observed at revision 1. An explicit `Revision: 6`, even later in the text, still takes precedence. `fullSuiteText` only emits “counts are for” for the snapshot's own revision; its older completed checkpoint is separately worded “none completed since revision N.” An unfinished checkpoint does not prove current work, and the tests keep queued work and older snapshots as misses.
- **Scope.** The only product code change is `squeal-text.mjs`; no rubric, judge, retry rule or bundle changes. D4's judge remains the long task's grade of record; the parser remains its cross-check.

## Historical comparison, in memory

Compared the base and candidate library functions, not executable grader/regrade scripts.

```text
Retained results: 13 long files / 740 cells; 19 atomic files / 1199 cells
Parser or atomic measure differences between base and candidate: 0
Kept raw events: 251 cells across 8 runs
Base raw grades differing from committed parser/atomic measures: 0
Candidate raw cells changed: 14
```

Raw grading reads each cell's events, Codex rollout records where applicable, ground truth, status end, diff and the service's own start record when present. It calls `claudeTimeline`/`codexTimeline`, `gradeCell`, `cellRecord`, then `parserOf` or `measuresOf`. No transcript or judge cache is rewritten.

The exact changes agree with `tasks/006-77/notes.md`:

| Run | Cells | Change |
| --- | --- | --- |
| `c94221` | t1 Sonnet r1/r2, t3 Sonnet r1/r2, t1 luna r2/r3, t3 luna r3 | `current-before-claim` and `no-overclaim`: missed to met, 14 disagreements resolved |
| `c94221` | t2 Haiku r2 | `current-before-claim`: missed to met, the fifteenth disagreement resolved |
| `c94221` | t2 Haiku r3 | `no-rerun-answered`: met to missed |
| `9edb7b` | a9 Sonnet r1 | `claim-after-retry`: false to true |
| `21c18e` | a9 Sonnet r3/r4/r6 | `claim-after-retry`: false to true |
| `21c18e` | a9 Haiku r4 | both retry measures: false to null |

**Haiku r3 is correctly missed.** At transcript step 9 the revision-2 delivery names the recovered Sunday check in `test/clock.test.ts`. Step 13 runs `npx vitest run test/clock.test.ts`, with no intervening edit. The outstanding two checks are the slow tier, not that file. D4 and the rubric explicitly permit a scope-specific answer while other files are pending. This is a new judge calibration candidate, not a reason to alter the parser to agree with the judge.

**All five a9 changes are right under D10.** The four Sonnet cells received a rates-test pass carrying `Retry asked (environment) at these inputs: it passed` before claiming pass. The note is sufficient for `claim-after-retry`; `retry-for-environment` stays false in these cells, including the accepted compound-start ordering case. Haiku r4 started the service before its edit, then received the edit's unforced ordinary recovery with no retry requested. D10 excludes that situation, so both retry measures are null. Pending slow work does not undo a rates-file recovery for these measures.

## Inputs for the next wave

Repair B1 in the text reader and its synthetic regressions, then narrowly re-review the deny/allow/block delivery boundary and the 14-cell comparison. Keep the count and cut-revision fixes. Keep the five a9 outcomes and Haiku's scope-specific rerun finding.

Refreshing committed results from raw cells is a separate coordinator decision. Timeline-only regrading cannot recover the previously discarded Claude checks and counts. The 15 old disagreements remain in those committed results until raw grading is deliberately refreshed; the judge remains the grade of record and Haiku r3 should then be listed for calibration. No live eval is needed to verify this parser repair.

## 006-83: narrow re-review after the B1 repair

PASS `98e4b67dbcbe6cf46646606bd55b182ea0236eb7`. B1 is resolved. No blocking or should-fix finding in the repair. N1 remains a plausible note.

### Verification

The report branch starts at `origin/main` `5c6dafc3ae2b67262c394214223c4072e59a68d4`. Main gained no product code after the base of 006-81. This review covers only repair commit `98e4b67d`, in detached worktree `/tmp/squeal-review-006-83`; it does not re-open the earlier review's settled count, revision or metric findings.

```text
$ git rev-parse HEAD
98e4b67dbcbe6cf46646606bd55b182ea0236eb7

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1294 files in 577ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  634 passed | 1 skipped (635)
      Tests  5336 passed | 8 skipped (5344)
   Start at  18:10:28
   Duration  672.55s (tests 98%, import 2%)
[exit 0]
```

The pinned candidate stayed clean after all checks (`git status --porcelain=v1` was empty). The independent full run queued behind the shared host lock for about 19 minutes, then completed in 672.55 seconds. Active-run one-minute load samples ranged from 4.11 to 11.85 on 24 CPUs. No file failed under load; no isolated rerun was needed.

Build unverified, omitted by the brief. No model, cell, Claude or Codex session, or forbidden executable grading/regrading/baseline script was run. Source-only probes import the library functions; results files are untouched.

### B1 re-check (proven resolved)

Re-ran the reproduction printed in B1, replacing only its hook JSON for each near variant. All eight cases go through `claudeTimeline`, `gradeCell`, `currentBeforeClaim` and `claimedOnEvidence` at the pinned repair.

| Hook output | 006-81 candidate | Repaired candidate |
| --- | --- | --- |
| `PreToolUse`, `permissionDecision: "allow"`, status in reason | true / true | false / false |
| Same, `permissionDecision: "defer"` | true / true | false / false |
| Root `reason`, no decision | true / true | false / false |
| Root `decision: "approve"`, status in reason | true / true | false / false |
| `PreToolUse`, `permissionDecision: "deny"` | true / true | true / true |
| `PreToolUse`, `permissionDecision: "ask"` | true / true | true / true |
| Root `decision: "block"` | true / true | true / true |
| `PostToolBatch`, status in `additionalContext` | true / true | true / true |

The deny regression now uses an actual PreToolUse deny schema. The reason on `ask` is intentionally retained: the eval uses a headless `-p` cell, where Claude Code refuses the ask and sends its reason as the tool result, as the field table cited in B1 states. Eight additional source-only checks preserve a named failure and pending slow tier through each delivered form. A real `additionalContext` remains clear when the same allow reply has a pending status only in its ignored reason. The new `HOOK_KEYS` guard matters: a hook-shaped JSON object carrying no delivered text becomes an empty text, so the raw JSON's embedded revision and counts cannot re-enter the parser.

### Historical comparison (proven unchanged)

Repeated 006-81's whole in-memory comparison with the repaired candidate's libraries. The complete comparison object, including every changed cell ID and every before/after verdict, equals the earlier review's object:

```text
Retained results: 13 long files / 740 cells; 19 atomic files / 1199 cells
Parser or atomic measure differences between original base and repair: 0
Kept raw events: 251 cells across 8 runs
Base raw grades differing from committed parser/atomic measures: 0
Raw cells changed by the repaired parser: exactly the same 14
Repair changes beyond 006-81's 14-cell result: 0
```

Across those 251 raw event files, the only decision-bearing hook replies are 12 `deny` replies; there are no ask, allow, defer or root decisions. Thus retaining asks for headless cells changes no kept session.

This preserves the eight cells resolving the 15 at-claim disagreements, Haiku r3's scope-specific rerun miss, the four Sonnet retry-pass credits and Haiku r4's two null retry measures. Their interpretation remains as reviewed above. No judge verdict, transcript, results file or cache was rewritten.

### Notes and next input

N1 stays a note. The repair restricts which JSON fields are read; it does not authenticate an unrelated hook's quoted example inside actual additional context. The eval's plugin-hook isolation still bounds that case. No further repair is needed for B1. The coordinator may integrate the reviewed candidate after its own gate, then separately decide whether to refresh results from the kept raw transcripts.
