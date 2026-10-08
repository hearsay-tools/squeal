# Probes: observed-runtime-inputs (THROWAWAY)

Throwaway experiments for `research/observed-runtime-inputs.md`. Not product code; nothing here is imported by Squeal. `node_modules` is ignored by git; install with `npm i` in `fixture/` (Vitest 5.0.3) and `v4/` (Vitest 4.1.11), then copy `fixture/` without `node_modules` into `v4/fx/` and set its `vitest` to `4.1.11`; it resolves `vitest` from `v4/node_modules`.

- `recorder/observe.cjs`: the probe recorder, loaded with `--require`. Wraps `fs` (sync, callback, promises), `child_process` (`ChildProcess.prototype.spawn`, `spawnSync`, `execSync`, `execFileSync`), `worker_threads.Worker`, and a `module.registerHooks` resolve hook. It re-injects itself into every child's env (`NODE_OPTIONS`, `SQUEAL_OBSERVE_DIR`, `SQUEAL_OBSERVE_TEST`), whatever env the caller passed. It attributes events to `globalThis.__vitest_worker__.filepath`, or to the inherited `SQUEAL_OBSERVE_TEST`.
- `fixture/`: five test files covering an import, `fs` reads of every form, `spawn` with inherited and `{}` env plus a grandchild with `{}`, `execFileSync`, a shell script, a worker thread and a computed `import()`.
- `run.mjs <vitestDir> <root> <pool> <isolate> <execArgv|projectExecArgv|nodeOptions|rootEnv|none> [file...]`: runs Vitest through `createVitest` with the recorder and prints the observed project paths per test file.
- `graphcheck.mjs`: whether Vite's module graph holds a computed `import()` target after a run.
- `full.mjs <root> <mode> <out.json> [substring...]`: a full or partial suite with per-file durations, observed paths and the post-run Vite import graph. `analyze.mjs` and `peek.mjs` read its output.
- `bench.mjs`: per-call overhead of the `fs` wrappers.
- `blind/blind.mjs`: reads the recorder misses (`node:sqlite`, a shell `cat`).

The cezar runs used a fresh clone of `/home/agent/projects/cezar` at `1c97556a`, outside this repository, with `npm ci`.
