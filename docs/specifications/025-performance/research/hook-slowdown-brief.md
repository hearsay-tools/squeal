# Research brief: what made hooks and `squeal status` slower between 0.1.640 and 0.1.645 (row 025-26)

The human, 2026-11-27: find the change and the cause. The paired `@hooks` benchmark 0.1.640 vs 0.1.645 on one
boat.dev EPYC sandbox, both on Vite 8.3.8, correctness PASS, one run per cell
(`bench/results/2026-11-26-0.1.640-vs-0.1.645-default-AMD-EPYC/`), shows 0.1.645 slower: `ref` PreToolUse p95
64→94 ms, PostToolBatch 77→118, session start 84→131, `squeal status` p95 90→141, CPU per edit 0.8→1.1 s; `wt-3`
PreToolUse p95 111→325, hook write wait max 46→1476 ms, lock holds over 250 ms 1→13. The hook bundles are 90 KB
smaller in 0.1.645, so the cost is run-time work (hook, daemon or store), not load. The void 0.1.640 vs 0.1.641 run
(no tests ran, Vite 8.4.0) also showed `ref` PreToolUse 59→78 and status 98→126. The developer-host latency test
did not see it: its socket only accepts and closes, with no real daemon (`research/hook-runtime.md`).

The range holds wave 4 (0.1.641: `src/core/daemon/config-file.ts` and `policy.ts` config reuse,
`src/harness/shared/stop-states.ts`, `src/core/state/file-class.ts`, `src/harness/shared/context.ts`), specs 027
and 028 (0.1.642 to 0.1.644: Docker execution, the Jest runner, `src/core/daemon/runner.ts`,
`src/core/runner-host/protocol.ts`) and wave 5 (0.1.645: the Vite `load` wrapper, error causes).

Write `research/hook-slowdown.md`, every finding tagged `verified by experiment`, `read in source code`,
`read in official docs` or `inferred`; probes under `research/probes/hook-slowdown/`. Answer:

1. **Bisect, then confirm.** In one boat.dev sandbox (`bench/boat-run.sh` with several `--ref`; read
   `~/projects/notes/topics/boat-dev.md`), compare `squeal--v0.1.640`, `squeal--v0.1.641`, `6e79c9e3d` (0.1.644),
   `squeal--v0.1.645` and current main (`83825f040`, 0.1.653) on the `ref` cell with `--repeat 3`. Pin Vite 8.3.8
   for every ref by a local, uncommitted edit of `BENCH_DEPS` in `bench/lib.mjs` in your tree (0.1.644 and older
   cannot start Vitest on 8.4.0). Name the step where hook p95, `status` p95 and CPU per edit move, with the
   spread across repeats. Then run `wt-3` on that pair only.
2. **Cause.** At that step, profile with a real daemon (CPU profiles of hooks, `squeal status` and the daemon;
   SQL and file counts like `research/probes/hook-latency/runtime/`) and name the code that costs the time and why.
3. **Fix.** The smallest change that removes it, what it costs, and how to verify it (a benchmark pair and a test
   that would have caught it, ideally one that runs hooks against a real daemon).

Do not change product code, `docs/board.md` or `plugins/*/dist`; restore `bench/lib.mjs` before you commit.
Delete every sandbox you create. Any direct `vitest` run gets `timeout 600`. Commit your files on your branch.
Use /researcher.
