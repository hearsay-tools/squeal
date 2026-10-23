# Probes for 015-01 coverage collection (throwaway)

Throwaway. Nothing here is product code or a test of the product. Findings: `../../coverage-collection.md`.

Every run happened in `/tmp`: a `git archive` copy of this repository at f6f44e03 in `/tmp/sq015-cov` with `npm ci` and `@vitest/coverage-v8@5.0.3` and `@vitest/coverage-istanbul@5.0.3` added there; a hard-linked copy without those two in `/tmp/sq015-nocov`; a Python venv with coverage 7.17.0 and pytest 9.1.1 in `/tmp/sq015-py`. `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` pointed under `/tmp/sq015-home`. No daemon ran.

- `fixture/`: a three-file Vitest project (`src/math.ts`, `src/text.ts`), its tests, `detect.test.ts` (what a test sees of coverage) and `self-coverage.test.ts` (a test that measures V8 coverage itself). `vitest.thresholds.config.ts` turns coverage on with `include` and `thresholds`.
- `warm.mjs`: one warm instance with the adapter's `createVitest` options (`src/runners/vitest/adapter.ts` `#start`) plus a coverage option; captures each worker batch's raw payload at `onAfterSuiteRun`; `PROBE_CONVERT=1` maps each batch to source with the provider's `convertCoverage`. `run-modes.sh` copies the fixture to `/tmp` and runs it.
- `own-provider.mjs`: a custom provider (`coverage.provider: "custom"`), so no `@vitest/coverage-*` package is needed.
- `compare-raw.cjs`, `compare-mapped.cjs`: the same fixture run under two roots, raw and mapped records compared.
- `bench.mjs`, `bench-loop.sh`, `sample.txt`: off, v8 and istanbul alternated on 30 of this repository's test files at `maxWorkers: 4`; `bench.txt` is the raw output.
- `lines.mjs`, `selection.mjs`: per-test-file covered lines for the sample, then file-level against line-level selection over recent commits, and a compact record's size.
- `node-test-fixture/`: `node --test` with `NODE_V8_COVERAGE` and `--experimental-test-coverage`, one process per file as 003 D5 runs it.
- `pytest-fixture/`: a pytest plugin that switches a coverage.py dynamic context per test file.
