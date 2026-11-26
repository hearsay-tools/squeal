# Probes for research 025-22: the benchmark's Vitest cannot load Squeal's coverage provider

Throwaway. Not product code, not tests. Run on one boat.dev sandbox (`default`: "AMD EPYC", 4 vCPUs, Node v24.22.1, pnpm 10.34.5) on 2026-11-26 between 20:55Z and 21:05Z, deleted at the end. The plugin was `git archive squeal--v0.1.641 plugins/claude-code`, pushed to `~/plugin-0` as `bench/boat-run.sh` does; `bench/gen-project.mjs` from this branch. Sandbox paths in `logs/` are written as `~`.

| File | What it does |
|---|---|
| `repro.sh` | Makes two 3-file bench projects with `gen-project.mjs` and `pnpm install` (no lockfile, as `run-all.mjs` does): `proj-float` takes the newest Vite, `proj-pin` pins Vite through `pnpm.overrides` (8.3.8). Runs `probe.mjs` in each. |
| `probe.mjs` | Starts Vitest through its Node API (`createVitest`, `standalone`, one test file) with Squeal's provider, as `src/runners/vitest/adapter.ts` `#start` does, but without Squeal's Vite hooks. Prints the error with its whole `cause` chain. |
| `repro-daemon.sh` | Starts Squeal's daemon from the plugin's `bin/squeal` in each project, with its own `HOME` and `XDG_RUNTIME_DIR` as `run-cell.mjs` does, and prints the daemon log. |
| `repro-run.sh` | A fresh copy of one project, coverage on or off, `squeal start`, `squeal run --all --wait`, `squeal status`, the daemon log, `squeal stop`. |
| `overload-check.ts` | Runs here, not on the sandbox: whether `tsc` rejects Squeal's `load` wrapper against Vite 8.4.0's declared overloads (reduced copy). |

Two more steps ran by hand on the sandbox and are not kept as files, because they patched throwaway copies:

- `plugin-dbg`: a copy of the 0.1.641 plugin whose `createRecoveringRunner` catch (bundle line 20164) and runner-host `errorOf` append the error's `stack` and `cause` chain to `~/cause.log` (`logs/3-cause-chain.log`).
- In `proj-float` only, Vitest's `ServerModuleRunner` transport catch (`vitest/dist/chunks/index.DpLw24bj.js`) appended the server-side error's stack (`logs/4-vite-fetch-error.log`). Restored before step 5.
- `plugin-fix`: a copy of the 0.1.641 plugin whose `SourceStamps.attach` wrapper (bundle line 49564) passes every argument on: `container.load = async (id, ...rest) => { await this.#stamp(reads2, id); return load(id, ...rest); }`.

| Log | Step |
|---|---|
| `logs/1-plain-vitest-api.log` | `repro.sh 8.3.8`: both Vite versions load the provider through Vitest's own API. |
| `logs/2-daemon-start.log` | `repro-daemon.sh float pin`: 0.1.641's daemon fails with Vite 8.4.0, starts with 8.3.8. |
| `logs/3-cause-chain.log` | `plugin-dbg` in `proj-float`: the cause Vitest wraps, `Cannot read properties of null (reading 'code')` from Vite's module runner. |
| `logs/4-vite-fetch-error.log` | The server-side stack: Vite 8.4.0 `loadAndTransform`. |
| `logs/5-run-all.log` | `repro-run.sh`: 0.1.641 + Vite 8.4.0 coverage off (every test file fails with the same error); `plugin-fix` + Vite 8.4.0 and + 8.3.8, coverage on (21 passed each). |
| `logs/6-run-all-control.log` | 0.1.641 + Vite 8.3.8, coverage on: 21 passed. |
