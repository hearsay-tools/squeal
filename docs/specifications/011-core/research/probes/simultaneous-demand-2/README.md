# Probe 011-423: two worktrees changed at once, measured again with 0.1.578

Throwaway. Written for `research/simultaneous-demand-2.md` on 2026-11-20. Not product code; nothing imports it. The `.patch` files are VM-only prototypes, never meant to land.

## The arms (one Squeal bundle each)

- `base`: the released 0.1.578 (`squeal--v0.1.578`, `9387fe8d4`), which has rows 011-417, 011-418 and 011-419.
- `q-quiet-demand.patch` (q) and `qc-ceiling-share.patch` (qc): 011-420's patches (`../simultaneous-demand/`), applied to 0.1.578 with `patch -p1`. One hunk applied at an offset of 17 lines (`src/core/scheduler/capacity.ts`); the added and removed lines are the same as 011-420's. Regenerated against 0.1.578 here.

Build as 011-420's README says, from `git archive squeal--v0.1.578`. Bundle sha256: `results/sha256.txt`. The local base build differs from the released bundle only in source-path comments (`node_modules` was a symlink).

## VM steps

The 12-vCPU lab VM, `~/work/0d5248b3/`, private `HOME` and runtime directory (`env.sh`); squawk at `c11e4edf0` (branch `probe423` in `squawk.bundle`).

1. `bash probe/setup.sh`, then `bash probe/bg.sh drive 36000 bash ~/work/0d5248b3/probe/drive.sh` (expand `~` before `bg.sh`).
2. `drive.sh`: `warm.sh` (the warm-up, then a snapshot of each copy's store), then 30 two-daemon runs (011-400's S2 shape) in ten blocks of three, alternating `base q qc` and `qc q base`, then two base runs that keep the store. Each run restores both copies' stores from the snapshot first (`q4.sh`, `RESET=1`) and waits for a quiet VM (`run-all.sh`: one-minute load under 1, no other task's `~/work` process; `results/gate.log`).
3. Stopped by the coordinator at 22:38Z on 2026-11-20, during the 22nd run (S-qc-8, incomplete, not used): 21 complete runs, 7 full blocks; the kept-store runs did not run. Daemons stopped, samplers killed, `~/work/0d5248b3` removed, no process left.

## Files

From 011-420 (`../simultaneous-demand/`), labels renamed: `bg.sh`, `edit.sh`, `env.sh`, `hold.sh`, `marks.sh`, `marks-check.mjs`, `overrun-check.mjs`, `q4.mjs`, `q4b.mjs`, `q4runs.mjs`, `queue-sample.mjs`, `run-all.sh`, `start-daemon.sh`, `wait-idle.sh`, `workers.mjs`, `analyse.mjs`, `quiet-share.ts`. Changed: `warm.sh` (store snapshots), `q4.sh` (store restore, per-file times), `sample.sh` (a steal column, deployed before S-qc-8, so no complete run has it), `setup.sh`, `summary.mjs` (lag to width, shared-window forks, end gap, file time, JSON lines). New: `filedur.mjs` (per-file times, `results/S-*.files.tsv`), `drive.sh`, `stats.mjs` (per-arm medians and ranges, unpaired and per-block comparisons; `BLOCKS=n` keeps the first n blocks).

Outputs: `results/summary.jsonl` (`JSON=1 node summary.mjs`), `results/stats.txt` (all 7 blocks), `results/stats-blocks1-5.txt` (`BLOCKS=5`), `results/runs-table.md`. Records had the VM's home path replaced with `~`.
