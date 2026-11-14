# Wave 1: phase 1 of spec 022

Approved by the human 2026-11-14 ("Spec 022: Approve, build phase 1"). Two rows in parallel on disjoint seams. Contract: `src/core/store/loaded-modules.ts` (D3 table and record type), on the coordinator branch before dispatch. Neither row changes its shape; ask the coordinator.

Both rows: read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `spec.md` and `status.md` of spec 022, and the two findings files in `research/`. Verify with `squeal status --wait 60000 <changed-path>...`, lint and typecheck. No full suite, no `pnpm run build` in your tree (the coordinator builds the bundles at integration). Commit on your branch.

## 022-03 Recorder, union and the loaded-list table (D1, D2, D3) — slice

Outcome: a Vitest test file's loaded modules are recorded in its worker, join its key when outside its closure and environment, and are stored per result key.

- Read: spec D1, D2, D3; `research/loaded-modules.md` 2 and 3; 011 C3 and C4 (observed paths); 016 D4.
- Starting seam: `src/core/code/coverage/provider.mjs:107` `takeCoverage` reads `__vitest_worker__.evaluatedModules` by node presence. Then carry the list through `src/runners/vitest/coverage.ts` to `adapter.ts:747`, where `observed` is assembled, into `ObservedInputs.paths` and `.modules`. Drop paths the closure or the environment hash already holds where the core joins observed paths (`src/core/scheduler/record-tier.ts`, `src/core/keys/observed.ts`).
- Owns: `src/core/code/coverage/provider.mjs`, `src/runners/vitest/{coverage,adapter,observe}.ts`, `src/core/keys/observed*.ts`, `src/core/scheduler/record-tier.ts`, `src/core/store/loaded-modules.ts` (add the write, the table creation and the prune; keep the contract), `src/core/store/prune*.ts`, new tests under `test/`.
- Leave alone: `src/core/reach/**`, `src/cli/reach*.ts` (022-04).
- Done when: the spec's Testing cases for the recorder, union, no-loss and store pass; `pnpm exec vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts` passes or its alarm is explained in your summary.
- Use /worker.

## 022-04 The reach estimate (D4) — slice

Outcome: `squeal reach` shows per project what narrowing by loaded modules would save, in text and JSON.

- Read: spec D4; 015 D11 (`../015-coverage-complexity/spec.md`); `research/loaded-modules.md` 1 and 4 (the population method).
- Starting seam: `src/core/reach/read.ts` and `pairs.ts` already label each closure path's kind; add the avoidable-pair rule there, then a section in `src/cli/reach-format.ts`. Read lists from `loaded_modules` (contract file); a store without the table reads no lists.
- Owns: `src/core/reach/**`, `src/cli/reach*.ts`, `test/reach/**`.
- Leave alone: `src/core/store/loaded-modules.ts` (import its types only), the coverage provider, the Vitest adapter, keys (022-03).
- Done when: the spec's Testing cases for reach pass against a fixture store, each "no list" reason shown; D11's rules hold (no test, no daemon, no write).
- Use /worker.
