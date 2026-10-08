# Probes for `slow-suite-policy` (throwaway)

Throwaway. Nothing here is product code or a fixture to keep. Every script runs against copies under one scratch directory, `SCRATCH=/tmp/r004-01-XXXXXX`, never against this repository's Squeal store or `/home/agent/projects/cezar` itself. `node_modules` stays out of git (the copies have their own).

| Script | What it measures |
| --- | --- |
| `setup.sh` | Clones this worktree and cezarion into `$SCRATCH`, copies this worktree's `node_modules`, `npm ci` in the cezarion copy, builds `@wjarka/cezarion`. Points the copy's `test/e2e/install.ts` cache at `$SCRATCH/e2e-cache` instead of the host-wide `/tmp/squeal-e2e-cache`. cezarion's `package-cli` test also needs `npm run build:web` in the copy. |
| `time-squeal.sh` + `summarise.mjs` | This repository's `test/e2e` under `vitest run`, file-parallel (`MODE=all`) or `--no-file-parallelism` (`MODE=serial`); per-file wall time from the JSON reporter. |
| `time-cezar.sh` | cezarion's `test:package` command, one file at a time (`MODE=files`) or as the script runs it (`MODE=all`). |
| `time-rest.sh` | Everything else, for the duration-threshold question: this repository's Vitest suite minus `test/e2e` and cezarion's `test:unit`, at most 4 workers. |
| `static-closure.ts` | Squeal's own node:test graph builder (spec 003 D3) over cezarion's `test/e2e/*.test.ts`. Run from the Squeal copy with `npx tsx`. |
| `observed-cezar.sh` + `observed.mjs` | Each cezarion e2e file with Squeal's recorder (`src/runners/node-test/runtime/recorder.cjs`) in `NODE_OPTIONS`, so every Node process the test spawns records what it loaded. |
| `dist-to-src.mjs` | Maps the observed `dist/` modules back to `src/` through their `.js.map` `sources`. |
| `history-select.mjs` | Replays cezarion's last 300 commits against those source sets: which slow files a source-closure rule would select and their share of the tier's time. |
| `vitest-closure.ts` | Squeal's own Vitest adapter (spec 001 D4) in the Squeal copy: `closure()` of every test file and `affected()` for sample edits. |
| `vitest-tags/` | Vitest 5.0.3 test tags: does `--tags-filter '!slow'` skip a file tagged `@module-tag slow` before importing it? |

Results are summarised in `../../slow-suite-policy.md`. Raw outputs stayed in `$SCRATCH/out` and were removed with the scratch directory.
