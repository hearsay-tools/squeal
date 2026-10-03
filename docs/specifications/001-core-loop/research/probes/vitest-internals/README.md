# vitest-internals probes (THROWAWAY)

Throwaway experiments for `../../vitest-internals.md`. Not product code. Do not import from here.

- Vitest 5.0.3, Vite 8.3.2, Node 24.21.0, Linux, 24 cores.
- `npm install` here, then `node <probe>.mjs`. `node_modules/` and the generated `fixture50/` are git-ignored.
- `fixture/`: small project (setup file, JSON import, variable dynamic import, runtime fs read, snapshot).
- `gen-fixture50.mjs`: generates `fixture50/` (50 test files x 6 tests, 25 chained source modules) for timings.

| Probe | Question |
|---|---|
| `probe1-warm-instance.mjs` | Q1, Q5: warm instance, watcher off, repeated runs, stale result without `invalidateFile` |
| `probe2-affected-graph.mjs` | Q2, Q3: graph before/after run, `related` walk, static parse, collect, closures |
| `probe3-result-shape.mjs` | Q4: per-test result shape, id stability (runs, inserted test, worktree copy) |
| `probe4-invalidation.mjs` | Q5: changed imports, deleted file, deleted/new test file, changed config |
| `probe5-cost.mjs [pool] [isolate]` | Q6: timings on `fixture50/` |
| `probe6-sharp-edges.mjs` | Q3, Q7: snapshot files, `update: 'none'`, projects, `process.exitCode` |

Probes edit fixture files and restore them in `finally`. If one crashes, `git checkout fixture/`.
