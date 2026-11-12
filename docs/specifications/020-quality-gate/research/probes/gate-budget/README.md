# Row 020-41 probes (the gate's budget across runners): throwaway

Evidence for `../../gate-budget.md`. Not product code and not tests; nothing imports them. Scratch lives under `/tmp/gate-budget/`; no `node_modules` here.

- `simulate.mjs`: a list-scheduling model of five budget rules on #196's numbers (cases A and B in its header). No run, no store. Output `simulate.out.json`, table `simulate.out.txt`.
- `estimate-error.mjs <runs dir>`: read-only over a daemon's `runs/*/report.json`. Per file, the next run's duration over the previous run's (the stored value), and the same summed over runs of 20 or more files. Run 2026-11-12 on `~/projects/squeal/.git/squeal/runs` (11,813 runs). Output `estimate-error.out.json`.
- `fixture.mjs <dir> <slowSeconds> <a,b,c> <node_modules>`: a git repository shaped like #196. node:test entry `slow` (one file sleeps, three quick files) and entry `quick` (two files), eight Vitest files of 1 s. Base on `main`; the working tree edits the named sources.
- `hooks.mjs <dir> <node_modules> <n>`: a Vitest project whose reporter logs when `onTestModuleQueued`, `onTestModuleStart` and `onTestModuleEnd` fire, n files of 2 s, one worker.
- `steps.sh <setup|starve|control|long|hooks>`: runs one step. The released 0.1.457 bundle is copied to `/tmp/gate-budget/squeal`. Every call runs under `env -i` with `HOME=/tmp/gate-budget/home`, `TMPDIR=/tmp/gate-budget/tmp`, at `nice 10` on 8 vCPUs (`taskset -c 0-7`). stderr lines get seconds since start (`stamp.mjs`). Outputs `/tmp/gate-budget/out/<step>.{stdout,stderr,load}`, copied to `out/` (run 2026-11-12 22:42Z; `out/queue.log` is the queue job log).
- `queue.sh`: hooks, control, starve, long in turn. `guard.sh` starts each step only at a one-minute load of 24 or less and waits up to 4 hours.

Cleanup: `rm -rf /tmp/gate-budget`. No daemon is started.
