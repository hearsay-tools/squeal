# Probe: the per-edit cost of three provider bindings (016-34)

Throwaway. Nothing here runs in Squeal's suite: no file is named `*.test.ts`, and `count.probe.ts` runs only as a copy in a scratch clone. ESLint is installed under `/tmp/bc34/tools`, never in the repository. Every run sets `HOME`, `XDG_*` and `TMPDIR` under `/tmp/bc34`; no daemon runs and no live store is opened.

One provider (`provider.mjs`) behind every binding. Two checks with the same calls (`invalidate`, `affected`, `closure`, `run`, and the hint `tierWidth`): `trivial` reads a check file that imports one source; `eslint` lints one 236-line source with ESLint 9.39.5's Node API (one `no-unused-vars` error), one instance per provider, loaded on the first run.

- `bindings.mjs`: the host side. `inproc` imports the provider into the host's thread. `worker` runs it in a worker thread (structured clone). `rpc` runs it in a persistent child process, JSON-RPC 2.0 with `Content-Length` framing over stdio (`framing.mjs`, `rpc-server.mjs`). `command` starts `command.mjs` per run and reads its report file; the host selects with the same provider code, as a core would from a manifest. `command-cc` adds `NODE_COMPILE_CACHE`. `command-cli` (eslint only) runs ESLint's own CLI, `-f json -o report`; that CLI enables Node's compile cache in `TMPDIR` by itself (`bin/eslint.js` line 15).
- `exit-cpu.mjs`: preloaded into each per-run command; writes its own `process.cpuUsage()` (getrusage, fork to exit, all threads) and peak RSS at exit.
- `sample.mjs <job>`: one host process. One edit = write `src/a.js`, then from the timed start: `invalidate`, `affected`, `closure` of each selected unit, `run`, the verified result. Wall by `performance.now()`; CPU = host `process.cpuUsage()` plus the provider process's own (rpc: `$/cpu` read before and after, outside the span; command: `exit-cpu.mjs`). `childTicksMs` cross-checks the command's CPU from `/proc/self/stat` (10 ms ticks). Every timed sample waits, asleep, until the one-minute load is below 24 and stores the load it read. Modes: `smoke` (no time), `cold` (one sample per fresh process, from `open()`: module load, process start, ESLint load), `warm` (all bindings open, 3 warm-up edits, then rounds of one sample each, order rotated), `hint` (per-call cost of `tierWidth`: 100,000 sync calls in-thread, 1,000 awaited round trips otherwise).
- `measure.mjs [n]`: every timed job, `nice -n 10` (as Squeal's check processes run), into `/tmp/bc34/out/samples.jsonl`. Each cold sample gets a fresh `TMPDIR` and compile cache.
- `summarize.mjs <samples.jsonl>`: median, p10 to p90 and min to max per configuration.
- `contain.mjs`: question 4. Each binding x fault (`throw`, `throw-async`, `block` = `Atomics.wait` 3 s, asleep, `hang`) in a fresh host with a 50 ms heartbeat and a 1 s guard; on the guard the host kills the provider where it can, then runs a fresh one.
- `count.probe.ts`, `count.sh <commit> FILES=n SHAPE=tiers|slots`: question 3. The real scheduler (`createScheduler`, the 016-18 probe's setup and virtual clock) with a counting runner that defines every hint, as `afterEachRun` (`src/core/daemon/escaped.ts`) does. Counts calls per edit; no timing.
- `results/`: `count-*.jsonl` (question 3), and after the measuring turn `samples.jsonl`, `summary.md`, `contain.jsonl`, `measure-log.txt`.

Rerun:

```sh
docs/specifications/016-extensions/research/probes/binding-cost/setup.sh
node docs/specifications/016-extensions/research/probes/binding-cost/measure.mjs 25
node docs/specifications/016-extensions/research/probes/binding-cost/contain.mjs
node docs/specifications/016-extensions/research/probes/binding-cost/summarize.mjs /tmp/bc34/out/samples.jsonl
NODE_MODULES=$PWD/node_modules docs/specifications/016-extensions/research/probes/binding-cost/count.sh HEAD FILES=6 SHAPE=tiers
```

Clean up: `git -C /tmp/bc34/repo worktree prune` after `rm -rf /tmp/bc34`.
