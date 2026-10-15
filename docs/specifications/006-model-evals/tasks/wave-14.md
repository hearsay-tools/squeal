# Wave 14: the quality follow-ups of 006-85

The human, 2026-10-15, "Quality: All": row 006-86 and slices 1 to 4 of `quality/2026-10-15.md`. There are two workers on disjoint seams. They meet only in `evals/lib/atomic-measures.mjs` (006-86 the stamp, 006-87 the comment at `:49`) and in the `evals/lib/index` exports, where the coordinator keeps both. One candidate and one review cover both rows.

## 006-86 regrade.mjs stamps only what it changed; one stamp, one TREND.md writer, one `out/` reader

Use /worker. Shape: slice (unify). Outcome: every regrade command writes only files whose grade changed, under the row and note given, through one stamp helper and one `TREND.md` writer. The grader reads a cell's `out/` in one place.

Read `quality/2026-10-15.md` row 006-86 and slice 1, spec D4 "Retained evidence", and `reviews/wave-13.9.md` N1.

Steps, as the row says:
1. `regrade.mjs` takes `--by` and `--note` for its claim pass, and writes a file only where a claim, an expectation or a judge verdict changed.
2. One stamp helper in `results.mjs` replaces the four merges.
3. One `writeTrendMarkdown(dir, declared)` serves the three writers.
4. `atomic-regrade.mjs` reads `.atomic-variant.json` too.
5. Slice 1: `bin/grade.mjs` calls `gradeOut`, which reads `STARTS_FILE`.

Turn `regrade.test.ts:188` to "writes nothing" (the human's word). Never run `--judge`.

**Owns:**
- `evals/bin/{regrade,atomic-regrade,regrade-cells,trend,grade}.mjs`;
- `evals/lib/{results,trend,regrade-cells}.mjs`;
- `atomic-measures.mjs`'s stamp lines, and its own `index` exports;
- `test/evals/{regrade,regrade-expectations,atomic-regrade,regrade-cells,trend,failing-builtins,malformed,squeal-state,truth}.test.ts`;
- `tasks/006-86/notes.md`.

Leave 006-87's files alone.

**Done when:**
- `grep -rn 'earlier?.changed' evals` finds one hit;
- one function writes `TREND.md`;
- on a copy of `evals/results` outside the repository, `regrade.mjs` (no `--judge`) and `atomic-regrade.mjs` write no file where no grade changed. Notes list any of the seven files a real change touched;
- the named tests pass, plus lint, typecheck and `squeal run --all --wait`. Name any file that fails under load and passes alone.

## 006-87 one hook unwrap, one rule for a run that could pass the file, the retry fixtures once

Use /worker. Shape: slice (unify). Read `quality/2026-10-15.md` slices 2, 3 and 4, spec D10's a9 row, and `reviews/wave-13.8.md` B1.

1. **Slice 2:** export `hookText` from `squeal-text.mjs`, and have `judge-references.ts`'s `unwrapped` call it. `judge-coverage.test.ts` must pass with the committed calibration hashes unchanged.
2. **Slice 3:** in `retry-evidence.mjs`, use `ranFile` at `:56` and `:128`, drop `forcedRun`, and drop the repeated `statusPass`. Fix `atomic-measures.mjs:49`'s comment: a11's `cause` is `null`.
   - Contract: no committed cell changes. Check it in memory over every committed retry cell, both measures. A change stops the work and asks.
   - Write regressions for the new rule both ways: a `squeal run --slow` neither forces a heal nor closes (b)'s window, and a run selecting `file` does both.
   - Notes give the D10 sentence; the coordinator amends the spec.
3. **Slice 4:** export `AT`, `REGISTERED_FAIL`, `SOURCE`, `TESTS` and `PASSED` once from `retry-texts.ts`.

**Owns:** `evals/lib/retry-evidence.mjs`, `squeal-text.mjs` (the export only), `atomic-measures.mjs:49`, its own `index` exports, `test/evals/judge-references.ts`, `test/evals/retry-*.test.ts`, `test/evals/retry-texts.ts`, `tasks/006-87/notes.md`. Leave 006-86's files alone.

**Done when:** those regressions pass; the in-memory check finds 0 of the committed retry cells changed; `judge-coverage` passes; lint, typecheck and `squeal run --all --wait` pass. Name any file that fails under load and passes alone.

**Both rows:** never run `run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs`, `regrade-cells.mjs` or `regrade.mjs --judge`. Never write `evals/results/` in the repository. No model call; no `npm run build`.
