# Probes for research 025-12 (D12): runner-host idle exit and a status-only bundle

Throwaway. Not product code, not tests. Timings ran on one boat.dev sandbox (`large`: AMD Ryzen 9 9950X, 8 vCPUs, 15.6 GiB, Linux 6.8.0-117, Node v26.13.0 through nvm, pnpm 12.15.0), on a copy of this repository at 0.1.628 (`957897ae3`) made a git repository there. The sandbox was deleted at the end. `host-phases.mjs` and `proxy-interleaved.mjs` ran on the development host against this worktree's own store, read only. Sandbox paths in `logs/` are written as `~`.

| File | What it does |
|---|---|
| `drive-host.mts` | Run with `tsx` from the clone. `latency`: a Vitest runner host started through Squeal's own proxy (the shipped `plugins/claude-code/dist/cli/squeal.mjs runner-host`), as the daemon's fast instance (`maxWorkers` 2, observe on, `test/e2e/**` excluded); per cycle start, list, one cold edit, 3 warm edits of one test file, close. `memory`: one host with 021-27's `inside.mjs` preloaded, 2 edits of each of 10 test files, then samples after the runs, after 60 s idle, after a full GC, and a heap snapshot. Adapted from `../../../../021-remote-store-and-execution/research/probes/daemon-heap/drive-host.mts`. |
| `status-bundle.mts` | Run with `tsx` from a scratch clone only (it writes `src/cli/*.probe.ts` there). Builds scratch bundles with the shipped bundle's own esbuild options (`bundleOptions`, `src/harness/build.ts`): `status.mjs` (`main` with only `status`, no `--at`), `status-at.mjs` (with `--at`), and timed copies of the full CLI and of `status.mjs` that print when the entry starts, around `readStatus`, before the write and at the end. Writes esbuild's metafile. |
| `bundle-inputs.mjs` | Top source folders by bytes in each scratch bundle, from the metafile. |
| `time-status.mjs` | Wall time of `--version`, `status`, `status --json`, `status --wait 60000 <file>` through the shipped `bin/squeal`, plain `node` on the shipped bundle, and the status bundle; compile cache off, cold (new directory per trial) and warm; with and without `NODE_USE_ENV_PROXY=1`. 15 trials each, run in sequence. |
| `host-phases.mjs` | The two timed bundles on a real store (this worktree's, 18,078 checks), warm cache, 10 trials. |
| `proxy-interleaved.mjs` | Wrapper and plain `node`, each with and without `NODE_USE_ENV_PROXY=1`, interleaved in every round, 12 rounds. |
| `host-idle-e2e.sh` | A daemon-driven warm edit, a wait past `runner.hostIdleMinutes`, a cold edit. Written, not run to the end: see the report, "Open questions". |

Logs (`logs/`): `latency.jsonl`, `latency2.jsonl` (5 cold cycles in total); `memory.jsonl` to `memory4.jsonl` and the host samples `host-vitest-<pid>.jsonl` (`inside.mjs`, every 5 s); `host-dominators.txt` (021-27's `dominators.mjs` on the heap snapshot of `memory.jsonl`'s host); `host-split.tsv` (021-27's `split.py`); `status.jsonl` (`time-status.mjs`). The heap snapshots (93 MB) were not kept.
