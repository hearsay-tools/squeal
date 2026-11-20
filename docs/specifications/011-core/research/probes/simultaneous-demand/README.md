# Probe 011-420: a daemon in its catch-up quiet claims its fair share

Throwaway. Written for `research/simultaneous-demand.md` on 2026-11-20. Not product code; nothing imports it. The `.patch` files are VM-only prototypes, never meant to land.

## The arms (one Squeal bundle each)

Every arm is built from main `294c8ac41` plus row 011-417's commit `33c46c323` (fresh CPU readings, branch `cez/b7aab7d9`, not on main yet), cherry-picked as `git format-patch -1 33c46c323` and `patch -p1`. Rows 011-418 and 011-419 are not in any arm.

- `base`: main + 011-417.
- `q-quiet-demand.patch` (q): while a lane's wait for quiet (the 120 s catch-up quiet, or the 20 s quiet after a cancel) holds queued backlog files and ends within 30 s (`QUIET_DEMAND_LEAD_MS`), the daemon's pool mark states that demand: `want` the held files (at most 64), `grant` 0, `since` null. It is written at each pump look (every 1 s while the quiet holds), at most every 5 s when unchanged, and ends when a tier asks or the quiet ends. The other daemons' fair shares (`fairShares`, over the 11 slots) count it.
- `qc-ceiling-share.patch` (qc): q, and a backlog tier's fair share divides the background ceiling's CPUs (`floor(9)` = 9 on the VM) instead of the 11 slots.

Build (scratch copy, not the worktree): `git archive origin/main src plugins/claude-code package.json tsconfig*.json | tar -x`, `patch -p1 < 011-417.patch`, then `patch -p1 < <arm>.patch`, symlink `node_modules`, `node_modules/.bin/tsx src/harness/claude-code/build.ts`, `tar -czf squeal-<arm>.tgz plugins/claude-code`. Bundle sha256 of `dist/cli/squeal.mjs`: base `0e7c64b1…`, q `0b546489…`, qc `991e459d…` (`results/sha256.txt`).

## Local probe (this host)

`quiet-share.ts <arm source root>` drives the arm's real `createPermitPool` with fake tree and host readers on the VM's numbers (11 slots, ceiling 9). Daemon A asks for a backlog tier while daemon B's quiet holds 64 files; then B asks. Outputs: `quiet-share.<arm>.txt`.

## VM steps

The 12-vCPU lab VM, `~/work/0d5248b3/`, private `HOME` and runtime directory (`env.sh`). squawk at `c11e4edf0` (branch `probe420` in `squawk.bundle`), as row 011-413.

1. Copy `squawk.bundle`, the three `squeal-<arm>.tgz` and this directory as `probe/`; `bash probe/setup.sh`.
2. `bash probe/bg.sh drive 14400 bash ~/work/0d5248b3/probe/drive.sh` (expand `~` before `bg.sh`: `env.sh` moves `HOME` and changes directory). It runs `warm.sh`, then `run-all.sh q4` (two daemons, 011-400's S2 shape: 290 files per copy, `packages/contract/src/live.ts`, both copies edited within a second) and `run-all.sh one` (one daemon, H0 shape: 892 files, `packages/contract/src/ci-wait.ts`). Each timed run waits until the one-minute load is under 1 and no other task's `~/work` process runs (`results/gate.log`).
3. Clean-up: `squeal stop` in every clone, kill the samplers, `rm -rf ~/work/0d5248b3`.

## Files

From 011-413 (`../run-width-design/`), with the work directory and labels renamed: `bg.sh`, `wait-idle.sh`, `sample.sh`, `start-daemon.sh`, `queue-sample.mjs`, `timeline.mjs`, `refusals.mjs`, `tiers.mjs`, `q4.mjs`, `q4b.mjs`, `q4runs.mjs`, `files-of.mjs`, `env.sh`, `setup.sh`, `warm.sh`, `arm.sh`, `run-edit.sh`, `edit.sh`, `hold.sh`, `workers.mjs`, `run-all.sh`, `analyse.mjs`, `overrun-check.mjs`. New: `marks.sh` (every pool mark each second, `results/S-*.marks.tsv`), `q4.sh` starts it, `drive.sh`, `quiet-share.ts`, `marks-check.mjs`.

## The VM round (2026-11-20 11:10Z to 14:30Z)

- `drive.sh` ran the warm-up (11:10 to 11:30Z), then `q4 S-base-1:base S-q-1:q S-qc-1:qc S-qc-2:qc S-q-2:q S-base-2:base`, then `one O-base-1:base O-q-1:q O-qc-1:qc O-qc-2:qc O-q-2:q O-base-2:base`. Gate readings: 0.80 to 0.99, no other task (`results/gate.log`).
- Fixed at the first start: `bg.sh` sources `env.sh`, which changes directory, so a relative `probe/drive.sh` was not found and nothing ran; restarted with the absolute path within a minute.
- `summary.mjs` (two daemons), `o-summary.mjs` (one daemon), `marks-check.mjs` (the pool marks around the quiets' ends) and `overrun-check.mjs` read `results/`.
- Records had the VM's home path replaced with `~`; empty sampler logs removed.
- Clean-up done at 14:33Z: daemons stopped, samplers killed, `~/work/0d5248b3` removed, no process left.
