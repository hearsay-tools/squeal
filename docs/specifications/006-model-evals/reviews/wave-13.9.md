# 006-84: kept cells regraded from raw output

PASS `7e518efe2c73368cb3f49edb6bbdb2602cd16488`. Zero blockers, zero should-fix findings, one maintenance note. Range `origin/main..7e518efe`, with `origin/main` at `627df10a8bd9bdd26bb0b0c41eb07cf94e38ca9a` when reviewed.

## Verification

Reviewed in detached worktree `/tmp/squeal-review-006-84`. This report is the only deliverable on branch `cez/07226ba2`.

```text
$ git rev-parse HEAD
7e518efe2c73368cb3f49edb6bbdb2602cd16488

$ npm ci
added 196 packages, and audited 197 packages in 10s
found 0 vulnerabilities
[exit 0]

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1298 files in 776ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  635 passed | 1 skipped (636)
      Tests  5347 passed | 10 skipped (5357)
   Start at  18:52:44
   Duration  703.33s (tests 98%, import 2%)
[exit 0]

$ git status --porcelain=v1
[empty]
```

The independent suite waited about 15 minutes for the shared lock, then ran for 703.33 seconds. During the run, one-minute load samples ranged from 6.26 to 17.13 on 24 CPUs. No file failed under load; no isolated rerun was needed. HEAD stayed at the pinned SHA and the candidate remained clean after the dry run, probes and checks.

Build omitted by the brief. No model, cell, Claude or Codex session was started. No forbidden baseline, calibration or regrade executable was run directly. The new command was run only with `--dry-run`; library probes kept their results in memory. The full-suite gate includes the repository's existing CLI regression tests.

## Blockers

None found.

## Should-fix

None found.

## What fits

### Faithful rebuilding (proven)

Compared `evals/lib/regrade-cells.mjs:29` against `evals/bin/grade.mjs` and the recording paths in `run-cell.mjs` and `run-baseline.mjs`. The same event and rollout readers, time origin, truth completion record, Vitest truth, final status, variant's plugin flag, diff and optional service record feed `gradeCell`. A throwaway source-only probe also evaluated the original grader's computation body, excluding its imports and writer, against every kept output. Its grades equal `gradeOut` for all 251 cells.

`regradedCell` refreshes the `cellRecord` mechanical fields from that grade. Long cells retain their judge transcript and checked verdicts; `parserOf` supplies the cross-check and `expectationsOf` keeps the judge as the grade of record. A synthetic long cell without a judge keeps `judge: null`, `parser: null`, and `not computable` for the applicable judged expectations. A parser pass never becomes a judge verdict. Atomic records use `pilotRecord` with the current scenario and the committed `turns`, `turnStarts` and `settle`, exactly as a new cell is graded.

Across all 251 kept cells, assertions preserve identity, original timing/load/accounting, cost, tokens, leftovers, transcript, judge and atomic usage totals. The 203 atomic cells also preserve their turn and settle records. Those fields describe the run and original judgment; rebuilding mechanical evidence should not replace them with a new transcript or inferred accounting. The 1,688 cells without kept output remain their original objects. A second in-memory regrade of every file returns the same data object and no differences.

### The note and writes (proven)

`changesOf` classifies changed claim/truth/Squeal verdict fields, expectation entries, parser entries and atomic measures as grades. The remaining stored fields are evidence. Direct probes cover each grade-bearing category. `regradeFromOut` names a cell in `changed` if any grade differs and in `evidence` only otherwise. A repeated stamp from the same row retains previously named cells and removes a cell from the evidence-only list if it later has a grade change.

Files are selected for writing by actual cell differences, not by a new date or stamp. A missing output contributes only to `missing`; it neither invents a grade nor stamps the file. Every input file is graded before the command reaches its write loop. The new command exits before every writer in dry-run mode. The candidate's CLI regressions exercise changed/unchanged file contents, unchanged-file mtime, missing output, retained judge grades, the supplied note, and no summary file on a dry run.

### dd4056's lost credit (proven)

Independently inspected the executed slow requests in all 20 Claude a8 cells through their raw timelines and shell classification. There are 16 requests, and all 16 receive `squeal: no squeal@hearsay plugin is installed`; none receives an answered Squeal slow run. These are exactly the 16 formerly credited cells. Haiku therefore goes from 6/10 to 0/10 and Sonnet from 10/10 to 0/10. The other four Claude cells already scored false. All 20 Codex cells keep their slow-run measure. No answered slow call loses credit.

### 006-80 (proven)

All runtime and test callers of `regradeAtomic` pass the newly required `{ by, note }`, and the public declaration matches. The CLI rejects a missing stamp before grading or writing. An unchanged measures pass returns the original data without a stamp; its file is not written. The ATOMIC.md directory set comes only from files with changed measures. The regression tests cover a mixed changed/unchanged pair and the all-unchanged case, including absence of ATOMIC.md.

## Historical dry run

```text
$ node evals/bin/regrade-cells.mjs --from-cells /tmp/squeal-evals-1001/cells --dry-run
```

The output matches the worker's notes after normalizing the candidate worktree prefix:

| Run | Kept | Grade changes | Evidence alone | Missing out/ |
| --- | ---: | ---: | ---: | ---: |
| dd4056 | 40 | 16 | 24 | 0 |
| 65314d | 11 | 0 | 11 | 0 |
| 9edb7b | 12 | 1 | 11 | 0 |
| e81bea | 80 | 0 | 80 | 0 |
| 99db6d | 20 | 0 | 20 | 0 |
| 320f5e | 20 | 0 | 20 | 0 |
| c94221 | 48 | 9 | 39 | 0 |
| 21c18e | 20 | 4 | 16 | 0 |

```text
24 results file(s) with no kept cell, left as they are
```

Exactly the 14 cells in 006-77's notes and review 006-83 change, plus dd4056's 16 Claude a8 cells. The c94221 changes are the eight cells resolving the 15 at-claim disagreements and Haiku r3's scope-specific rerun miss. The a9 changes are Sonnet r1 in 9edb7b; Sonnet r3/r4/r6 and Haiku r4 in 21c18e. The judge's checked verdicts stay unchanged. The new parser disagreement for Haiku r3 remains a calibration candidate.

All 251 kept timelines change, so the proposed write set has eight files, including those with evidence changes alone. The 24 other result files have no kept output and remain untouched. This matches the coordinator's recorded decision that future timeline regrades need the refreshed evidence even when the present grade stays the same.

## Notes and next input

- **N1, proven maintenance duplication:** `gradeOut` duplicates the reading/computation in `evals/bin/grade.mjs`. They agree on every kept cell now. A later change to only one reader could reopen this seam. A separate small cleanup can make the original grader use `gradeOut`; it is not needed to establish this candidate's correctness.
- The coordinator owns the actual results rewrite after landing. That write was not performed during review. Use the row and note intended for the committed provenance, inspect the predicted eight files and regenerated summaries, and keep Haiku r3 available for future judge calibration. No new live eval or model call is needed for this refresh.
