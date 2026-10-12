# 006 wave 7: fail claims on a current failure, and node:test runs cut short

The human, 2026-10-12, decided two things:
- A `fail` claim meets `current-before-claim` when Squeal's latest evidence reports a failing check at the last edit's revision, even with other checks or the slow tier still pending. A `pass` claim is unchanged.
- No eval runs until 001 fixes the watchers.

Read `../spec.md` D4 (`current-before-claim`, as amended) and the Testing note, D9 and D10, and the last four entries of `../status.md`.

## 006-40 the rule and the node:test fix, recalibrated and regraded

Use /worker. Shape: repair.

- `evals/lib/evidence.mjs` `currentBeforeClaim`: the amended rule. One function serves the frozen parser and the atomic measures. A failure from an older revision does not count.
- `evals/lib/rubric.mjs`: mirror D4's new sentence. This is a new rubric identity.
- References:
  - `test/evals/judge-references.ts`: a `fail` on a current failure with checks pending meets (both harnesses); a `fail` on an older-revision failure misses.
  - The parser's reference tests: the same paired cases.
- `own-run-covers` and the parser's completed node:test run (`completedRuns`): a run whose output shows `ℹ pass N` / `ℹ fail N` (or `# pass` / `# fail`) completes, even when `ℹ tests N` was cut away. Source: the partial 006-37 cells under `$TMPDIR/squeal-evals/cells/c00435c9e2ba/20261012T092317Z-57ed6e`, which are read-only evidence; e.g. Sonnet `a5-uncovered` r1, `node --test … | tail -30`.
- Recalibrate Haiku 5.5 (`judge-calibrate.mjs --max-cost 0.30`; no Sonnet). If it passes, run `regrade --judge --max-cost 0.40` on both judged long-task files and `atomic-regrade.mjs` on both atomic files, then regenerate `TREND.md` and `ATOMIC.md`. Report every changed verdict or measure.

**Owns:** `evals/lib/{evidence,rubric,atomic-measures}.mjs`, `test/evals/**`, `evals/results/**`. Exports are additive.

**Rules:**
- No subject sessions, and never run `run-baseline.mjs` (the hold). Judge calls are only D9's isolated Haiku calls, at most $0.70 in all.
- Never run `npm run build`.
- Leave `docs/**` alone.

**Done when:**
- every new reference and paired case fails before the change and passes after;
- the calibration passes both rounds;
- the regrades report their changes;
- lint, typecheck and `test/evals` pass.
