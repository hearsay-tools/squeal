# Research brief: one CI run gives the project's coverage report and Squeal's per-file records (#189, row 020-26)

Approved by the human on 2026-11-11 ("Yes, go for the research first"). Researcher: one, `/researcher`. Budget: about 90 minutes. Read-only on the product. Own only `research/ci-coverage-both.md` and `research/probes/ci-coverage-both/`.

## The question

Today `squeal ci record` yields when the project's resolved Vitest config has `coverage.enabled` (spec 020 D13.1; `src/runners/vitest/ci-runtime/coverage.cjs`, `offCoverage("project-coverage", ...)`). A CI run then gives the project's coverage report or Squeal's per-file records, never both. Issue #189 asks for both from one run.

## Questions, in this order

1. **Wrap, do not replace (asked first by spec 018's coordinator).** Can Squeal keep the project's own coverage provider (V8 or Istanbul) and read per-file data from it, so the project's report, reporters and thresholds stay the project's own? Look at Vitest's provider API (`onAfterSuiteRun`, `takeCoverage`, per-worker coverage, `coverage.provider: "custom"`), and at what Squeal's provider does today per test file. Try it on a scratch fixture.
2. **If wrapping is not possible:** what does replacing take? Squeal's provider writes the project's report from the same data, to `coverage.reportsDirectory` in `coverage.reporter` formats, and the project's `coverage.thresholds` decide the exit code. List what would differ from the project's own provider.
3. **Files Squeal gives no record today** (`isolate: false`, batches of several files, a test name filter, unfinished files, `node:inspector` closures): does the project's report still cover them in each design?
4. **Part header:** how a reader tells which mode ran (records only; records and project report; yielded).
5. **Cost:** CPU and wall time against the project's provider alone. A scratch fixture first. A real cezarion shard only when the one-minute load is at most 24, in a copy under `/tmp`; never write in `~/projects/cezar`.

## Ownership and limits

- `ci record` and its runtime belong to spec 018 (coordinator 3739e45a). Propose; change nothing there.
- #190 (shared results carry coverage) is spec 018's row 018-35 with its own researcher. Do not study it; name any overlap.
- Skip a live probe while the one-minute load is above 24, and record the load beside every timing.

## Output

`research/ci-coverage-both.md`: answers tagged by evidence, a recommended design for a spec 020 section, the open decisions for the human in plain words, and a row split (files, order, tests per row).
