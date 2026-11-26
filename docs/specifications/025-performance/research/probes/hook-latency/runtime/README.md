# Throwaway hook runtime probes

These probes answer row 025-15. They are research fixtures, not product code or a new benchmark. Do not run timings on the developer host. Do not commit generated test copies, bundles or `node_modules`.

## Inputs and machine

- 0.1.364: `81a160214cfd16ed67381274affc49a2c936f515` (peeled release tag).
- 0.1.600: `e9c4a490cf2ebd2cf5565dfb207fb8c548905648`.
- Main: `be643e5184d236cc6b91282291fb32fb30201a2e`, package version 0.1.636.
- Runtime sandbox: `bx_8uq27a3x`, Node 24.22.1, four AMD Ryzen 9 9950X vCPUs, 8 GB. Benchmark sandbox: `bx_bbgg5m9d`, same CPU model. Both deleted on 2026-11-26; `boat list --json` returned an empty list.
- Machine/load data: `results/machine.txt`; every latency log records load. No other measurement ran concurrently in the runtime sandbox. Source transfer was permitted while tests ran. No harness credentials were forwarded (`--no-env`).

Read `~/projects/notes/topics/boat-dev.md` before reproducing. Read `bench/README.md`, past scorecards and raw synthetic session logs first. The benchmark ran before custom probes: from a scratch clone, `bench/boat-run.sh --ref squeal--v0.1.600 --ref HEAD --cells ref --steps 1`. Its unmodified output lives in `benchmark/`, with sandbox-home paths replaced and trailing blank lines removed. This short run is a fixture/real-daemon comparison, not a reliable p95 estimate.

## Reproduce in a disposable boat.dev sandbox

1. Export main's `src`, `test`, `plugins`, `scripts`, package/lock/workspace files and config files into a sandbox checkout. Export the same source/test/plugin paths at each old tag into sibling `old/364` and `old/600` directories. Keep their committed plugin bundles. Install main's pinned pnpm dependencies **in the sandbox only**. Old trees share that sandbox `node_modules` through symlinks. No dependencies were installed again in the developer worktree. The original sandbox archive omitted `pnpm-workspace.yaml`; pnpm installed dependencies but exited 1 for ignored build scripts. The required esbuild/Vitest commands then ran successfully. Include the workspace file on reproduction.
2. Copy these scripts to a separate sandbox directory, called `$probe` below. Set `$root` to its installed main checkout and `$old` to the old-tree parent. Run sequentially:

   ```sh
   bash "$probe/run.sh" "$root"
   bash "$probe/versions.sh" "$root" "$old"
   node "$probe/header.mjs" "$root" "$old"
   cd "$root"
   timeout 600 pnpm exec vitest run --config runtime-probe/vitest.config.mjs runtime-probe/header.test.ts
   node "$probe/startup.mjs"
   bash "$probe/phases.sh" "$root" "$old"
   ```

3. Fetch `$root/runtime-results`. Run `python3 summarize.py <fetched-results> <output-directory>` locally to reduce it. Delete the sandbox, including on a failed run. This session started long shell commands through Squawk `job start`; those job logs are task state, not research artifacts.

`prepare.mjs` generates test/helper copies, resolving imports back to the corresponding source tree. Cases, fixture seeding, output assertions and ordinary budgets stay intact. OpenCode gains a p50 output column. Claude probe copies print raw samples. The first harness/path batch predates that raw-sample addition and retains its complete original table. Its test config defined source version `0.0.0-test`; subsequent batches use the repository's `0.1.590` fixed test version. Every fixture daemon reports `0.0.0-test`; timed runtime bundles remain the release bundles or the original harness build helper's output. The config has one worker and no file parallelism.

Modes: `direct` is the minimal-environment `runBundle` path; `cache` adds a reusable `NODE_COMPILE_CACHE`; `launcher` calls shipped `hooks/run` with that cache; `proxy` adds `NODE_USE_ENV_PROXY=1` before the launcher. The full-hook proxy batch has no HTTP/HTTPS proxy URLs. `startup.mjs` separately uses inert proxy URLs and no HTTP calls to measure the initialization cost. `startup.json` preserves the initial no-URL variant; `startup-with-proxy.json` is the final script's output.

## Evidence files and limits

- `results/{claude,codex,pi,opencode,antigravity}.log`: all five latency assertions passed. Codex Stop needed two rounds. Pi uses 50 calls and 20 fresh workers; other harness cases use 20 fresh processes per round. OpenCode uses a relative 10 ms p95 margin, not an independent 80 ms assertion.
- `results/claude-<mode>-<1|2|3>.log`: three batches per startup mode. Fixed mode order, warm cache. Compare large differences; do not attribute small differences between cached modes to the wrapper.
- `results/{364,600,main}/direct-*.log`: three batches at each version, with every raw elapsed sample. Versions ran sequentially on one machine. This is not a randomized commit bisect.
- `results/trace-summary.json`: exact executed SQL text/counts, JS file operations, syscall counts, connect/exec records and CPU profile top frames. Separate `results/<version>/summary/*.strace-c` files retain `strace -f -c` output. Full `-tt -T` traces were reduced to avoid storing fixture stdin payloads. CPU profiles and SQL instrumentation ran under strace; their timings are diagnostic, not ordinary latency or exclusive CPU attribution. `waitSyscallMaxMs` can be a helper thread's lifetime wait. It is not a policy delay.
- `results/phase-summary.json`: after-module-evaluation samples. `phase.mjs` only reads the clock and writes one result on exit. A generated **copy** of each hook bundle stamps `performance.now()` immediately before `runMain`. No SQLite wrapper, CPU profiler or strace runs in this mode. The exit timestamp precedes the result write. It excludes module load; it includes the hook's async work until process exit. Original product bundles remain unchanged.
- Phase `case` indexes: PreToolUse 0 edit, 1 silent Bash, 2 denied command; Stop and Prompt 0 delivering, 1 silent; SessionStart 0 registered, later blocks spawn rounds. The untimed initial registration is excluded. At 364, SessionStart case 1 is the failed first spawn round (~763 ms after load), case 2 is its passing retry. The regular test reports only its best round. Other hooks have case 0 alone.
- `results/header.log`: equal header output for the same 500 states, then 100 calls per implementation; warmed microbenchmark, not full cold-hook attribution.
- `results/startup-with-proxy.json`: 60 interleaved samples after five warmups, Node 24.22.1, bare/cache/restore/native-proxy modes. Loop order reverses each iteration. No network request occurs.
- `results/exits.txt`: all harness, path, version, trace and phase runs returned 0. Trace copies change run count to one and budget to 10000 ms; those runs prove output behavior and collect operations, not latency-budget compliance. `header.log` records its separate pass. No full test suite was run.

The closing socket fixture cannot measure real writer acknowledgements, contention, active policy holds, enabled code/lint databases, interactive waiter lifetime or `stop-slow`. Existing benchmark cells cover those workloads. Findings must keep these limits.

Local verification: script syntax and all JSON artifacts passed. Squeal path status returned no closure for these research paths, zero known failures and 207 unknown test files. This is not a repository-wide test pass.
