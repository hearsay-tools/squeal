# Probe 011-400: where the idle CPU and the selection time go in a broad change

Throwaway. These scripts were written for `research/broad-change-throughput-2.md` on 2026-11-19 and **ran the same day, 13:15Z to 15:30Z**, on the lab VM, after the human gave it back. They are not product code and nothing imports them. Most are 011-395's (`../broad-change-throughput/`), with the work directory changed to `~/work/011-400`; new or changed files say so in their header. Run: warm-up, q2, arms T and H0, `plainW9`, question 4's S2, C2, S3 and C3. Not run, for time: arm TS, `plain12`, and a plain run with coverage (`plainw.sh plainW9c $OUT/H0 9 --coverage.enabled`).

## What it ran

- Machine: the 12-vCPU lab VM the shared notes name (its topic note under `~/projects/notes/topics/`; 31 GiB, Ubuntu 24.04, Node 26.13.0), or any quiet machine of that size. Work directory `~/work/011-400/`, deleted at the end. Read the note's Linger warning: keep one ssh session open for the whole run.
- Squeal **0.1.563**: `git archive v0.1.563 plugins/claude-code`, unpacked on the VM. `src/core/scheduler/` and `src/core/capacity/` are the same at 0.1.565 (`git diff --stat v0.1.563 v0.1.565 -- src` touches neither).
- Repository: a `git bundle` of `hearsay-tools/squawk` at `c11e4edf0`, branch `probe400`, cloned on the VM, `corepack pnpm@12.11.2 install --frozen-lockfile`. Vitest 4.1.10. No credentials were copied.
- Isolation: `env.sh` gives every step a private `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `~/work/011-400/`. All daemons of this probe share that private permit pool and user config, and nothing else on the VM.

## The budget patch (question 1, arms T and TS only)

The backlog tier's wall budget is a constant, `BACKLOG_TIER_BUDGET_MS = 120_000` (`src/core/scheduler/backlog.ts:15`), bounded by half of `runner.timeoutMs`. No configuration raises it. On the coordinator's choice (request a06c9bd8), `setup.sh` copies the VM's `dist/cli/squeal.mjs` to `dist/cli/squeal-big.mjs` and changes the one line `BACKLOG_TIER_BUDGET_MS = 12e4;` to `BACKLOG_TIER_BUDGET_MS = 36e5;` (3,600 s). Arms T and TS start their daemon from that copy and set squawk's `runner` to `{"tierSize":4,"timeoutMs":7200000,"backlogTierSize":2000}` in the clone, so the budget is min(3,600 s, 7,200 s / 2) = 3,600 s and a tier may take 2,000 files. `setup.sh` writes the sha256 of both files to `$P/sha256.txt` (`results/sha256.txt`: `squeal.mjs` `bea14d75…990c48`, `squeal-big.mjs` `fa1bdecb…817477`; the diff is that one line, 15521). The repository's code is unchanged.

## Steps, in order

All commands run on the VM as `bash -lc '...'` (nvm needs a login shell). `$P` is `~/work/011-400`, `$d` is `$P/probe`.

1. Copy `squawk.bundle`, `squeal-0.1.563.tgz` and this directory (as `probe/`) to `$P`; `bash $d/setup.sh`.
2. `bash $d/bg.sh warm 6000 bash $d/warm.sh`: a fresh daemon, `squeal run --fast`, idle, stop; then three copies of the warmed clone, store included (`$P/q4-1..3`, question 4).
3. Question 1, one detached arm each (`bash $d/bg.sh <label> 6000 bash $d/arm.sh ...`):
   - `arm.sh H0 orig - '{}' 1 packages/contract/src/ci-wait.ts`: defaults, run-loop held.
   - `arm.sh T big '{"backlogTierSize":2000,"timeoutMs":7200000}' '{}' 1 packages/contract/src/ci-wait.ts`.
   - `arm.sh TS big '{"backlogTierSize":2000,"timeoutMs":7200000}' '{"capacity":{"backgroundShare":1}}' 1 packages/contract/src/ci-wait.ts`.
   Before T and H0 the clone's earlier edits were reverted (`git checkout -- packages`), so a fresh daemon starts with nothing queued: results are stored by content key.
   Held 1 means `hold.sh` registers one Claude Code consumer in turn through the plugin's own SessionStart and UserPromptSubmit hook entries, so the `run-loop` group (`at: pause`) waits, as when an agent is mid-turn; `wait-idle.sh` then leaves that group's files out. `tiers.mjs` splits each arm's idle CPU.
4. Question 2: `bash $d/bg.sh q2 3000 bash $d/q2.sh <broad> <test file> <mid> <test source>`, then `node $d/prof.mjs $OUT/prof-q2 $OUT/q2.clock $OUT/q2.edits.tsv $OUT/q2.procs.txt`.
5. Question 3: `files-of.mjs` on arm H0's window, then `bash $d/plainw.sh plainW9 $OUT/H0 9` (T's width), no daemon running. Extra args after the width go to Vitest (for example `--coverage.enabled`).
6. Question 4: `bash $d/q4.sh <label> <2|3> '<user config>' packages/contract/src/live.ts` (406 files reached, 295 run) for S2 and S3 with `{"capacity":{"hostSlots":11,"backgroundShare":1}}` and C2 and C3 with `{"capacity":{"hostSlots":48,"backgroundShare":0.92}}`. `q4.mjs` counts the 111 files that stay queued (browser files, the held group) as pending; use `q4b.mjs <label> <n>` (on copies of the `$OUT/<label>.*` files) instead, and `q4runs.mjs <label> <n>` for each copy's runs.
7. Clean-up: `squeal stop` in every clone, kill the samplers by their pid files (`$OUT/*.pid`), `rm -rf ~/work/011-400`, check `ps` shows nothing of it.

## Analysis added at the run

- `phases.mjs <clock> <edits.tsv> <profile>...`: per q2 revision, when each phase ran (first and last sample) in the daemon's and the runner host's profiles.
- `incl.mjs <profile> <clock> <edits.tsv> [N]`: per revision, inclusive CPU per function.
- `perfile.mjs <store> <T t0> <T t1> <H0 t0> <H0 t1>`: per-file duration ratio between two arms.
- `q4b.mjs`, `q4runs.mjs`: above.

## Fixes made at the first run

- `start-daemon.sh`: `cd x && setsid node … &` backgrounds a subshell that keeps the caller's `$(...)` pipe open until the daemon exits; the `cd` is now its own command. Process lines are cut at 600 characters, so the daemon line with `--cpu-prof` args still shows ` daemon `.
- `arm.sh`: the patched CLI's path used `$HOME`, which `env.sh` had already moved; it uses `$P`.
- `q4.sh`: registers one consumer in turn in each copy (`hold.sh`) and waits with `HELD=1`. Without it each fresh copy first ran its 308 never-run `run-loop` files.

## Traps met

- Copying a 2 MB `cpuprofile` over ssh is fine; analysing it on the VM needs `$P/probe/...` paths, because `env.sh` moves `HOME`.
- The VM's one-minute load at each edit still carried the previous run; the samplers' 15 s idle baseline gives busy CPUs before the edit.
- The first keepalive ssh session (`sleep 7100`) ended at 15:14Z; a second one was opened before it. The user manager and the probe's scopes survived.

## Files

`env.sh`, `bg.sh`, `edit.sh`, `files-of.mjs`, `queue-sample.mjs`, `timeline.mjs`, `plain.sh` (011-395's); `refusals.mjs` (row 021-19's); new: `setup.sh`, `warm.sh`, `start-daemon.sh` (011-395's, plus node args for the profile), `sample.sh` (plus `procs_running`), `wait-idle.sh` (plus `HELD`), `workers.mjs`, `run-edit.sh` (plus the worker and permit samplers), `hold.sh`, `arm.sh`, `tiers.mjs`, `q2.sh`, `refined-wait.mjs`, `prof.mjs`, `plainw.sh`, `q4.sh`, `q4.mjs`.

`results/`: the run's records, without the raw `.cpuprofile` files (up to 3 MB each). Per arm `<label>.{arm.txt,load.txt,edits.tsv,t0,t1,tsv,queue.tsv,workers.tsv,permits.txt,tiers.json,timeline.json,refusals.json}`; q2 `q2.{edits.tsv,prof.json,phases.txt,incl.txt,tsv,workers.tsv,clock,procs.txt,log}`; `plainW9.*`; question 4 `<label>.{q4.json,q4b.json,runs.json,load.txt,tsv,workers.tsv,<i>.queue.tsv}`; `H0.vitest.txt` and `H0.node-test.txt` (the files of H0 and of the plain run); `perfile.txt`; `sha256.txt`. Epoch times are UTC milliseconds. The VM's local clock is UTC+1, so `uptime` lines read an hour ahead.

## Checked at the first run

- `hold.sh` works: `squeal status` read "run-loop: 320 test files; 308 pending, waiting for the agent to pause".
- `q2.sh` ran as `q2.sh packages/contract/src/ci-wait.ts packages/contract/src/report-title.test.ts packages/contract/src/live.ts packages/contract/src/report-title.test.ts`. `live.ts` was picked with `squeal status --json <path>` (its `selection.testFiles`: 406). `squeal stop` wrote the profiles.
