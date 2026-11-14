# Vitest loaded-modules probes (throwaway)

Throwaway scripts for row 022-01 (topic loaded-modules), Vitest part. They answer whether a recorded
"loaded set" (the modules a test file's worker evaluated) is sound for selection, and how to record it.
Not product code; nothing imports them. Results: `results.md` (tables) and `results.json` (raw).

Measured with Vitest 5.0.3, Vite 8.3.2, Node v26.13.0, at Squeal commit 2856d26e8, 2026-11-14.

## Files

- `lm-recorder.ts`: a setup file. In `afterAll` it writes `globalThis.__vitest_worker__.evaluatedModules.idToModuleMap`
  (id, file, evaluated flag, externalize, importers) to `$LM_OUT/<test path>.json`.
- `lm-runner.ts`: the same record from a custom runner (`test.runner`), in `onAfterRunFiles`, which also
  runs when the test file failed to import.
- `lib.mjs`: helpers: make a fixture (with `node_modules` symlinks to the worktree's vitest, vite and
  @vitest), run `node node_modules/vitest/vitest.mjs run --reporter=json` with `HOME` in scratch, read the records.
- `cases.mjs`: the soundness cases. Each: fresh fixture, run 1 (records the set), edit, run 2; it writes
  `results-cases.json`. `node scripts/cases.mjs 1a 2c` runs only the cases whose names start so.
- `isolation.mjs`: three test files in one worker under forks/threads with `isolate` true and false,
  `fileParallelism: false`, vmThreads and vmForks, recorded both ways.
- `server-graph.mjs`: Vitest node API run, then dumps each Vite environment's server module graph.
- `cost.mjs`: generated fixture (300 modules, 20 test files, maxWorkers 4), alternating runs with and
  without the recording runner; skips a run while the one-minute load is above 24.
- `native-mode.mjs`: `experimental.viteModuleRunner: false`, to see what the map holds then.

## Re-run

```sh
S=$TMPDIR/lm-vitest; W=<this worktree>
mkdir -p $S/scripts $S/node_modules $S/home
cp $W/docs/specifications/022-selection-strategy/research/probes/loaded-modules/vitest/*.{mjs,ts} $S/scripts/
R=$(readlink -f $W/node_modules/vitest)/..
for p in vitest vite @vitest; do ln -sfn $R/$p $S/node_modules/$p; done
cd $S && node scripts/cases.mjs && node scripts/isolation.mjs && node scripts/server-graph.mjs && node scripts/cost.mjs 300 20 5
```

Never `pnpm exec` or `npm install` in the scratch copy. One Vitest run at a time; check `uptime` first.
