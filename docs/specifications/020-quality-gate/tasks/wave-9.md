# Spec 020 wave 9: records beside the project's coverage (#189)

Approved by the human on 2026-11-12: "Build it"; versions: tested only (Vitest 4.1 and 5.0); Cezar proof "Yes, after release". Spec D19. Spec 018's coordinator (3739e45a) owns `ci record` and agreed that this wave builds it; send them the candidate SHA before its review.

## 020-26ab wrap the project's V8 provider in `ci record`, and read the collector

Use /worker. Shape: slice.

Outcome: spec D19. With the project's V8 coverage on, one `ci record` run gives the project's report and Squeal's per-file records; the gate and `ci export` reuse such parts.

Read: spec D13 and D19; `research/ci-coverage-both.md` (Q1 to Q4 and its row split); `research/probes/ci-coverage-both/` (`probe.mjs tee` shows the wrap working).

Starting seam: `src/runners/vitest/ci-runtime/coverage.cjs`, where `offCoverage("project-coverage", ...)` yields today. First failing test: a fixture with V8 coverage on, run under `ci record`: the project's `coverage-final.json` equals a run without `ci record`, the threshold exit code is the same, and the part holds records equal to a run with Squeal's own provider. Use Vitest 5.0 and 4.1 if the test kit has both.

Then:
- the tested-version check (D19.2), with a test that an untested version yields and the part names why;
- the added rules (D19.3): `isolate: false` and child-process entries give no record;
- the header field (D19.4) in `src/core/ci/parts.ts` and `src/runners/vitest/ci-coverage.ts`, and the `ci record --help` text;
- the readers (D19.5) in `src/core/ci/export-check.ts` and `src/core/code/gate/parts.ts`: a `v8` part is reused, an unknown collector is not;
- D19.6: `ci export` leaves out `node:inspector` files whenever any provider ran.

Owns: `src/runners/vitest/ci-runtime/*`, `src/runners/vitest/ci-coverage.ts`, `src/core/ci/{parts,export-check,export}.ts`, `src/core/code/gate/parts.ts`, `src/cli/ci*.ts` (help text), their tests, and the `ci record` lines of `commands.md` (with copies).

Done when: the tests above pass; existing `ci record`, `ci export` and `--parts` tests pass; `test/keys/key-format.test.ts` passes with keys unchanged; lint and typecheck are clean. Do not run `pnpm run build` or a full suite.
