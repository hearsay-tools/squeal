# Research brief: the benchmark's Vitest cannot load Squeal's coverage provider (row 025-22)

The human, 2026-11-26: find why. Two paired `@hooks` runs (0.1.640 vs 0.1.641) on boat.dev AMD EPYC sandboxes
failed correctness in every cell of both versions: each daemon logged `vitest could not start: Failed to load
custom CoverageProviderModule from /home/user/plugin-N/dist/coverage/provider.mjs`, so no edit got a verdict
(`bench/results/2026-11-26-0.1.640-vs-0.1.641-default-AMD-EPYC*/cells/*/logs/`). The 0.1.636 vs 0.1.638 run the same
morning (Ryzen 7 9700X) passed. `plugins/claude-code/dist/coverage`, `src/core/code/coverage`, `src/runners/vitest`
and `bench/` are unchanged between 0.1.638 and 0.1.641; the bench project pins Vitest and `@vitest/coverage-v8`
5.0.3 (`bench/gen-project.mjs`), Node 24.22.1. Main CI (full suite, coverage on) is green on 0.1.641.

Write `research/bench-provider.md`, every finding tagged `verified by experiment`, `read in source code`,
`read in official docs` or `inferred`; probes under `research/probes/bench-provider/`. Answer:

1. The real error behind the log line, reproduced on a boat.dev sandbox (`~/projects/notes/topics/boat-dev.md`;
   `bench/boat-run.sh` shows how the plugin and project are pushed): set up the bench project and plugin as
   `boat-run.sh` does, start Vitest with Squeal's provider by hand, capture the stack. Delete every sandbox.
2. Why it fails there and not in CI or on the 9700X sandbox: CPU, image, files the push dropped (`boat push`
   copies only what git tracks or does not ignore), installed packages, Node, paths. Name the difference.
3. Whether a user's machine can hit it, and whether the daemon should log the underlying error (the log line
   drops it; find where in `src/`).
4. The smallest fix: in the benchmark, in the product, or both, and how to verify it.

Do not change product code, `docs/board.md` or `plugins/*/dist`. Any direct `vitest` run gets `timeout 600`.
Commit your files on your branch. Use /researcher.
