# Probes for research 013-05 (the Vitest instance a close leaves alive)

Throwaway. Not product code, not tests. Everything ran in scratch directories under `/tmp` (`/tmp/vcl-matrix`, `/tmp/vcl-src`, `/tmp/vcl-bc`, `/tmp/vcl-d-*`, `/tmp/vcl-c-*`). The daemons ran with their own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `TMPDIR` under the scratch, on a copy of the installed Squeal 0.1.238 bundle. The cezar copy is a shallow `git clone` (never a worktree of the live repository). No live daemon's socket or store was opened, and no live process was signalled or reniced. Run Python with `-I`.

| File | What it does |
|---|---|
| `fixture/` | A four-file Vitest project: `src/m1..3.ts`, `test/m1..3.test.ts`, `test/slow.test.ts` (the slow lane's file in the daemon runs). |
| `matrix-setup.sh` | Installs each Vitest, Vite and Rolldown combination into `/tmp/vcl-matrix/<combo>` with npm (`overrides` pin Vite and Rolldown; npm's cache under the scratch). |
| `matrix-leak.mjs` | Question 2: N cycles of `createVitest` (the adapter's V1 options), `standalone`, one run, `close`; a `WeakRef` on each instance; after two GCs, how many are alive. With `break`, `break.mjs` runs after each close. |
| `vite-repro.mjs` | Vite alone: N cycles of `createServer`, one SSR transform, `close`. The upstream reproduction. |
| `rolldown-repro.mjs` | Rolldown alone: `viteResolvePlugin` with an `onWarn` whose closure holds 64 MiB, with and without a path back to the plugin. The upstream reproduction. |
| `issue-repro.mjs` | The Rolldown snippet of the issue text, as given; `nocycle` drops the path back to the plugin. |
| `run-matrix.sh` | Runs the three above over every combination, each once the load is below 24. |
| `break.mjs` | Question 3's first fix candidate: after `close()`, empty the closed instance, its logger, projects, Vite servers, their plugins and environments. |
| `break-cezar.mjs` | `break.mjs` on a cezar-size instance: the keying walk over the first K test files, close, with and without the break; a last-resort GC at the end. Optional heap snapshot. |
| `snapshot.mjs`, `retainers.py` | Two cycles on the fixture (optionally with the break), a heap snapshot, and the shortest strong path from the GC roots to each `Vitest` (`retainers.py` copied from 011-53). |
| `inside.mjs` | Loaded with `--import` into the research daemon only. A `module.registerHooks` hook wraps the project's `createVitest`, so each instance gets a `WeakRef`; a control file `count-<label>` runs two GCs and logs instances created and alive, heapUsed and private memory. |
| `env.sh` | The isolated environment, `sq` (the copied CLI), `start_daemon`, `ctl`, `wait_load`, `edit_and_wait`. |
| `fixture-setup.sh`, `run-fixture.sh` | Question 1 on the fixture: baseline, 3 config edits, 3 touches (each carried by an edit), 3 slow passes. |
| `cezar-setup.sh`, `run-cezar.sh` | Question 1 on cezar (`97ac340`): 4 host slots, browser e2e out, one light server test in the slow lane; baseline (cezar's `lookup-only`), 1 warm edit, 3 touches, 3 slow passes. |
| `logs/` | The outputs: `matrix.jsonl` (the break rows there are void: `break.mjs` changed during the run), `matrix-break2.jsonl` (the break rows again), `break-cezar-150.jsonl` (150 test files walked), `break-cezar-full.jsonl` (all of them, then a last-resort GC), `fixture-daemon/`, `cezar-daemon/`, `retainers-*.txt`. |

Clean-up: both daemons stopped with `squeal stop` (`logs/cezar-daemon/stop.txt`); at 15:13Z `/tmp/vcl-matrix`, `/tmp/vcl-src`, `/tmp/vcl-bc` and the daemon scratches were removed, `ls -d /tmp/vcl-*` found nothing, and no process named them. Heap snapshots were deleted with the scratch; the retainer paths are kept in `logs/retainers-*.txt`.
