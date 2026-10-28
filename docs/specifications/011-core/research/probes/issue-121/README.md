# Issue 121 throwaway probes

Research only. This directory is outside the normal Vitest include list and Squeal coverage. It imports the real scheduler and the existing fake-runner fixture. The fixture uses temporary repositories, a temporary store and a private capacity pool. It does not start a real Squeal daemon or run Cezar tests. Fixture cleanup releases its own held runs; it does not change any real worktree hold.

From the repository root, check load and run only this directory:

```sh
node -e 'const os=require("node:os"); const x={at:new Date().toISOString(),load:os.loadavg(),cpus:os.cpus().length}; console.log(JSON.stringify(x)); if(x.load[0]>x.cpus) process.exit(75)' > docs/specifications/011-core/research/probes/issue-121/load.json && pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-121/vitest.config.ts > docs/specifications/011-core/research/probes/issue-121/output.txt 2>&1
```

The second run used the same command with `load-rerun.json` and `output-rerun.txt`. It added direct snapshot output and assertions on the 133-second cut and 175-second remainder. Both runs passed 3 checks. `observed.jsonl` is from the second run. Re-running replaces it.

The scheduler clock advances without waiting those seconds. The fake runner holds three files with 308-second estimates. A fourth file waits behind them. Case 1 repeats an identical selection after 30 seconds across deadline expiry. Case 2 drops the running files from a later selection after expiry. Case 3 expands an overlapping selection before 30 seconds and repeats it after the cut. Each case checks unchanged keys and revision and finishes with all four files current.

This is a scheduling probe, not a measured latency benchmark or a reproduction of the full 56-file incident. See `../../issue-121.md` for the limits and source comparison.
