# Probe 011-413: a background run that holds CPUs idle at a fixed width

Throwaway. Written for `research/run-width-design.md` on 2026-11-19. Not product code; nothing imports it. The `.patch` files are VM-only prototypes, never meant to land.

## Local probe (this host, no VM)

`stale-cores.ts` drives the real `createPermitPool` (`src/core/capacity/pool.ts` at 0.1.570) with fake tree and host readers, as `test/capacity/host-gate.test.ts` does, on the lab VM's numbers (12 CPUs, 11 slots, ceiling 9). Run from the repository root:

    pnpm exec tsx docs/specifications/011-core/research/probes/run-width-design/stale-cores.ts

`stale-cores.base.txt` is its output at 0.1.570; `stale-cores.d.txt` and `stale-cores.b.txt` with `d-fresh-reading.patch` or `b-wait-fair-grant.patch` applied (applied, run, reverted).

## The arms (one Squeal bundle each, built from 0.1.570 at `7d02e6671`)

- `base`: 0.1.570 as released.
- `a-second-instance.patch`: (a) while a lane's backlog tier holds at most 4 permits (a narrow grant or a wide tier's tail) and files wait, the scheduler looks every 2 s and starts a backlog tier, with its own grant of at least 3, in the lane's second Vitest instance (the one row 011-269 made for a tier beside a batch).
- `b-wait-fair-grant.patch`: (b) a backlog tier granted under half its fair share is refused and looks again every 2 s, for at most 10 s (one mark refresh) since the first such narrow look; then it takes what it is offered. (A first version counted from the start of the daemon's wait and could not help a daemon that had waited long; replaced before any VM run.)
- `c-narrow-short-tier.patch`: (c) a backlog tier's 120 s wall budget is cut in proportion to its offer (and again to its grant) against the ceiling's 9 workers: a 1-wide tier selects about 13 s of files.
- `d-fresh-reading.patch`: (d) when a lease ends or returns permits, the pool forgets its own last measured CPU and starts a new window; every backlog gate reads the host's busy CPUs since the last read once it is 1 s old (0.1.570 keeps a reading up to 30 s).
- `cd`: (c) and (d) together. Arm (c) alone was dropped on the coordinator's choice (request 573db6b4).

Build (scratch copy, not the worktree): `git archive HEAD src plugins/claude-code package.json tsconfig*.json | tar -x`, `patch -p1 < <arm>.patch` (not `git apply`: inside the main checkout's tree it skips every path silently), symlink `node_modules`, `node_modules/.bin/tsx src/harness/claude-code/build.ts`, `tar -czf squeal-<arm>.tgz plugins/claude-code`.

## VM steps

The 12-vCPU lab VM, `~/work/796e796e/`, private `HOME` and runtime directory (`env.sh`). Keep one ssh session open for the whole run (the notes' Linger warning).

1. Copy `squawk.bundle` (squawk at `c11e4edf0`, branch `probe413`), the six `squeal-<arm>.tgz` and this directory as `probe/`; `bash probe/setup.sh`.
2. `bash probe/bg.sh warm 6000 bash probe/warm.sh` (base bundle).
3. Two daemons (011-400's S2 shape, default capacity config), per arm and run: `bash probe/bg.sh <label> 3000 bash probe/q4.sh <label> <arm> 2 packages/contract/src/live.ts`.
4. One daemon (011-400's H0 shape): `bash probe/bg.sh <label> 3000 bash probe/arm.sh <label> <arm> packages/contract/src/ci-wait.ts`.
5. Clean-up: `squeal stop` in every clone, kill the samplers by their pid files, `rm -rf ~/work/796e796e`, `ps` shows nothing of it.

## Files

From 011-400 (`../broad-change-throughput-2/`), unchanged: `bg.sh`, `wait-idle.sh`, `sample.sh`, `start-daemon.sh`, `queue-sample.mjs`, `timeline.mjs`, `refusals.mjs`, `tiers.mjs`, `q4.mjs`, `q4b.mjs`, `q4runs.mjs`, `files-of.mjs`. Changed: `env.sh` (work directory, `ARM`), `setup.sh`, `warm.sh` (two copies), `arm.sh` (arm instead of CLI and config; reverts earlier edits), `q4.sh` (arm, default config, reverts, runs `q4b.mjs` and `q4runs.mjs`), `run-edit.sh` (absolute probe path), `edit.sh` and `hold.sh` (labels), `workers.mjs` (each scope's `memory.current`).

## The VM round (2026-11-19 23:03Z to 2026-11-20 03:00Z)

- `run-all.sh <q4|one> <label:arm>...` ran the timed runs in order, each after the one-minute load was under 1 and no other task's process ran (`results/gate.log`). Ran: `q4 S-base-1:base S-a-1:a S-b-1:b S-d-1:d S-cd-1:cd S-cd-2:cd S-d-2:d S-b-2:b S-a-2:a S-base-2:base`, then `one O-base-1:base O-cd-1:cd O-cd-2:cd O-base-2:base`.
- Fixed at the first start: `run-all.sh` rebuilt `P` from `HOME`, which `bg.sh` had already moved through `env.sh`, so the first ten "runs" found no clone and ran nothing (2.4 min each, no daemon). It now keeps the exported `P`, checks the clones and stops on a run under 2 min.
- `analyse.mjs`: per two-daemon run and copy, its Vitest runs with the copy's mean and peak forks (`results/S-tiers.txt`). `overrun-check.mjs`: the 4-file tiers that start beside a backlog tier and their delay (`results/S-overrun.txt`).
- `workers.mjs`'s `memory.current` column read empty in these scopes: memory was not measured.
- Clean-up done at 03:00Z: daemons stopped, samplers killed, `~/work/796e796e` and the temp archives removed, no process left.
