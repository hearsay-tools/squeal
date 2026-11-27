# Wave 5: the bench's module-list cells after 0.1.591 (row 022-10)

The human, 2026-11-22 ("Add a row for updating the bench"); started 2026-11-27 (session bca5dbc3): "Start the approved rows". Coordinator b468025e. Bench only, no product change: lands on main after coordinator verification without a candidate review (`docs/process.md` step 6 gates `src/`, tests, `evals/` code, bundles and versions; earlier `bench:` commits landed the same way).

## Row 022-10 (worker; shape: slice)

**Outcome.** After 0.1.591 no release stores loaded lists, and 0.1.593 prunes `loaded_modules` in short slices; the bench stops measuring that one-time cleanup in every `store-7g` cell.

**Read.** `bench/README.md` (cells, `@lists` at line 41, text near line 110, "Subsets first"); `bench/age-store.mjs` (`--lists`, default `7d`); `bench/run-cell.mjs` (`--age-lists`, default `7d`); `bench/boat-run.sh`; `~/projects/notes/topics/boat-dev.md`; spec 022 D3 and D4 as amended; board rows 022-05 and 022-08.

**Change.** Default `--lists none` in both scripts; keep one named upgrade cell that ages a store with lists; rewrite the `@lists` group and its text; replace or drop the `squeal reach` list-read metric (gone since 0.1.591); in `bench/README.md` or `bench/results/TREND.md`, name the past `store-7g` runs whose stores held lists.

**Owns.** `bench/` only. Not `src/`, `test/`, `docs/board.md`, `package.json`.

**Done when.** A boat.dev pair on `squeal--v0.1.593` (or the latest release) vs itself, cells `store-7g` plus the upgrade cell, through `bench/boat-run.sh` only (never on this host or the lab VM): `store-7g` shows no list cleanup, the upgrade cell shows it. Results directory and TREND line committed. Commits on the worker branch; the final message lists the run id, cost and any cell renamed.

Use /worker.
