# Probe: source-path-selection (THROWAWAY)

Throwaway probe for `011-core/research/source-path-selection.md` (row 011-233, wave 46 W1). Not product code; nothing imports it. No live store was opened; no socket, daemon or permit pool was started. Run from the worktree root.

- `selection.probe.ts`: a fixture store (the test helpers `repoWith`, `key`, `state` from `test/cli/status-wait-fixture.ts` and `test/status/helpers.ts`, in a temporary directory) with two worktrees and 33 test files. It writes `test_files` and `test_file_keys` rows the way `storeClosures`, `rekeyContent` and `prune` write them, and reads `selectNamedFiles` and `main(["status", "--wait", ...])`. Writes `results/steps.txt`, `results/wait.txt` and `results/wait-queued.txt`. Run: `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run --root . --config docs/specifications/011-core/research/probes/source-path-selection/vitest.config.mts` (3 tests, about 11 s).
- `vitest.config.mts`: runs only the probe; the repository's include does not reach `docs/`.
- `sample.sh <n> <interval-s>`: read-only. `squeal status --json` on four source paths in one call, `n` times; `summarize.mjs` prints one line per call. `results/live-samples.txt` is 20 samples 30 s apart from 04:40 UTC, 2026-10-26.
- `reads.sh`: read-only. What three widely read sources and `start.ts` select, by state, and the 65 test files in `results/main-importers.txt` (each imports `main` from `src/cli/main.ts` by value) named by their own paths. `results/live-reads.txt`.

The first sampler run went from the probe directory, so its relative paths named nothing; it was discarded. `sample.sh` now changes to the worktree root.
