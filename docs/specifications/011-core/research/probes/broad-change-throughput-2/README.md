# Probe 011-400: where the idle CPU and the selection time go in a broad change

Throwaway. These scripts measured `research/broad-change-throughput-2.md` on 2026-11-19 and are kept only so the numbers can be re-run. They are not product code and nothing imports them. Most are 011-395's (`../broad-change-throughput/`), with the work directory changed to `~/work/011-400`; new or changed files say so in their header.

## What it ran

- Machine: the lab VM the shared notes name (`~/projects/notes/topics/apptension-lab-vm.md`; 12 vCPUs, 31 GiB, Ubuntu 24.04, Node 26.13.0). Work directory `~/work/011-400/`, deleted at the end.
- Squeal **0.1.563**: `git archive v0.1.563 plugins/claude-code`, unpacked on the VM. `src/core/scheduler/` and `src/core/capacity/` are the same at 0.1.565 (`git diff --stat v0.1.563 v0.1.565 -- src` touches neither).
- Repository: a `git bundle` of `hearsay-tools/squawk` at `c11e4edf0`, branch `probe400`, cloned on the VM, `corepack pnpm@12.11.2 install --frozen-lockfile`. Vitest 4.1.10. No credentials were copied.
- Isolation: `env.sh` gives every step a private `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `~/work/011-400/`. All daemons of this probe share that private permit pool and user config, and nothing else on the VM.

## The budget patch (question 1, arms T and TS only)

The backlog tier's wall budget is a constant, `BACKLOG_TIER_BUDGET_MS = 120_000` (`src/core/scheduler/backlog.ts:15`), bounded by half of `runner.timeoutMs`. No configuration raises it. On the coordinator's choice (request a06c9bd8), `setup.sh` copies the VM's `dist/cli/squeal.mjs` to `dist/cli/squeal-big.mjs` and changes the one line `BACKLOG_TIER_BUDGET_MS = 12e4;` to `BACKLOG_TIER_BUDGET_MS = 36e5;` (3,600 s). Arms T and TS start their daemon from that copy and set squawk's `runner` to `{"tierSize":4,"timeoutMs":7200000,"backlogTierSize":2000}` in the clone, so the budget is min(3,600 s, 7,200 s / 2) = 3,600 s and a tier may take 2,000 files. The sha256 of both files is in `results/sha256.txt`. The repository's code is unchanged.

## Steps, in order

All commands run on the VM as `bash -lc '...'` (nvm needs a login shell). `$P` is `~/work/011-400`, `$d` is `$P/probe`.

1. Copy `squawk.bundle`, `squeal-0.1.563.tgz` and this directory (as `probe/`) to `$P`; `bash $d/setup.sh`.
2. `bash $d/bg.sh warm 6000 bash $d/warm.sh`: a fresh daemon, `squeal run --fast`, idle, stop; then three copies of the warmed clone, store included (`$P/q4-1..3`, question 4).
3. Question 1, one detached arm each (`bash $d/bg.sh <label> 6000 bash $d/arm.sh ...`):
   - `arm.sh H0 orig - '{}' 1 packages/contract/src/ci-wait.ts`: defaults, run-loop held.
   - `arm.sh T big '{"backlogTierSize":2000,"timeoutMs":7200000}' '{}' 1 packages/contract/src/ci-wait.ts`.
   - `arm.sh TS big '{"backlogTierSize":2000,"timeoutMs":7200000}' '{"capacity":{"backgroundShare":1}}' 1 packages/contract/src/ci-wait.ts`.
   Held 1 means `hold.sh` registers one Claude Code consumer in turn through the plugin's own SessionStart and UserPromptSubmit hook entries, so the `run-loop` group (`at: pause`) waits, as when an agent is mid-turn; `wait-idle.sh` then leaves that group's files out. `tiers.mjs` splits each arm's idle CPU.
4. Question 2: `bash $d/bg.sh q2 3000 bash $d/q2.sh <broad> <test file> <mid> <test source>`, then `node $d/prof.mjs $OUT/prof-q2 $OUT/q2.clock $OUT/q2.edits.tsv $OUT/q2.procs.txt`.
5. Question 3: `files-of.mjs` on arm H0's window, then `bash $d/plainw.sh plain12 $OUT/H0 12` and `bash $d/plainw.sh plainW $OUT/H0 <H0's mean width>`, no daemon running.
6. Question 4: `bash $d/q4.sh <label> <2|3> '<user config>' <mid path>` for the arms below; `q4.mjs` summarises each.
7. Clean-up: `squeal stop` in every clone, kill the samplers by their pid files (`$OUT/*.pid`), `rm -rf ~/work/011-400`, check `ps` shows nothing of it.

## Files

`env.sh`, `bg.sh`, `edit.sh`, `files-of.mjs`, `queue-sample.mjs`, `timeline.mjs`, `plain.sh` (011-395's); `refusals.mjs` (row 021-19's); new: `setup.sh`, `warm.sh`, `start-daemon.sh` (011-395's, plus node args for the profile), `sample.sh` (plus `procs_running`), `wait-idle.sh` (plus `HELD`), `workers.mjs`, `run-edit.sh` (plus the worker and permit samplers), `hold.sh`, `arm.sh`, `tiers.mjs`, `q2.sh`, `refined-wait.mjs`, `prof.mjs`, `plainw.sh`, `q4.sh`, `q4.mjs`.

`results/`: RESULTS
