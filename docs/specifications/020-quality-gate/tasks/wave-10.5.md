# Wave 10.5: repair of candidate 0.1.444 (review `reviews/0.1.444.md` FAIL)

Base: `w10/int` at the commit that adds this file (candidate 2d1df96f6 plus the review). One repair each, then one narrow re-review. Read the review file first; each finding names its location, its probe and a one-worker fix.

## 020-28 R1 (B1, B2): gate files

Use /worker. Shape: repair.
- B1: a `--json` child that ends on a signal exits 3, as before 0.1.444, also after a whole report; keep the early report on stdout; the stderr line says whether the report came before the signal. Update `test/cli/code-gate-relaunch.test.ts` (it now expects 143): whole-frame and partial-frame cases.
- B2: recheck each queued file's keyed inputs after every busy pause and just before its results are written (also after its coverage record waited), outside any transaction; a changed file is not kept and counted apart, so "kept" and the rerun count stay true. Add the review's busy-note edit case beside the existing pre-flush case.
Owns: `src/core/code/gate/keep*.ts`, `stored.ts`, `src/cli/code-gate*.ts`, their tests. Leave alone: `src/core/store/*` (use `lockHolders` only), `src/runners/**`, `src/core/ci/*`, `src/core/keys/*`.

## 020-27 R1 (B3, S1): ci-runtime files

Use /worker. Shape: repair.
- B3: carry "no coverage provider" to the test workers outside the user environment (for example a marker file under the run's raw directory that `installWatch` reads), so no env capture sees it. Remove `SQUEAL_CI_NO_PROVIDER`. Do not filter it in `runDifferences` or `src/core/keys/*` (no key format change). Test with a literal allowlist entry of the old name: equal keys, equal part descriptors, export succeeds.
- S1: do not install the watch's hooks in the Vitest controller when no provider will run, or remove them at the provider decision; test controller and worker hook state without a provider.
Owns: `src/runners/vitest/ci-runtime/*`, `src/runners/vitest/ci-coverage.ts`, `src/runners/vitest/ci-runs.ts` only if needed, their tests. Leave alone: `src/core/code/gate/*`, `src/cli/code-gate*`, `src/core/keys/*`, `src/core/store/*`.

Done when (both): the review's probes now give the compatible result; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
