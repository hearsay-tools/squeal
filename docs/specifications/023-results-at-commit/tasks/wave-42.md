# Wave 42 (row 023-93): the CI import tests pass with any CI variable set. Use /worker.

The human, 2026-11-26 (coordinator 0fb097d5, from the lab investigation of task 877f10a7). Test-only change. One row.

## 023-93: hermetic CI environment in `test/ci/` import tests

Shape: repair.

Outcome: `test/ci/glob-import.test.ts` (row 023-13) and every test with the same pattern pass whatever CI variables the outer shell sets.

Evidence: the file passes with `CI` unset and with `CI=true GITHUB_ACTIONS=true`, and fails with `CI=true` alone (4 of 4 on lab guests, reproduced on this host): `squeal ci export: refused: ... ran project "" in another environment than this job's: config fields allowOnly differ`. `exported()` records and exports with `CI: ""`, but Vitest sets `allowOnly: !isCI` from `std-env`, which also reads `GITHUB_ACTIONS` and other provider variables, and one side of the comparison reads the test process's own environment. On GitHub both sides count as CI and agree by accident.

Seam: `exported()` in `test/ci/glob-import.test.ts` and the same function in `test/ci/resolution-import.test.ts` (row 023-14). Lead: one helper that gives every process and every comparison in the test the same CI-free environment (remove `CI` and every variable `std-env` uses to detect CI, not set `CI` to `""`), shared by both files. Find the side that reads `process.env` and cover it too. Grep `test/` for other `CI: ""` or `recordVitest`/`ci export` uses with the same pattern and fix those in the same way.

Owns: `test/ci/`, a helper under `test/` if you add one. Leave alone: `src/` (a product change here is a new row; report it), `docs/board.md`.

Done when: each changed file passes with `CI` unset, `CI=true`, `CI=1` and `CI=true GITHUB_ACTIONS=true` (direct `pnpm exec vitest run <file>` with a timeout, the four runs listed in your final message). Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite. Leave no orphan processes. Do not run `pnpm run build`.
