# Probe 011-395: one shared-module edit that queues about 1,200 test files

Throwaway. These scripts measured `research/broad-change-throughput.md` on 2026-11-19 and are kept only so the numbers can be re-run. They are not product code and nothing imports them.

## What it ran

- Machine: the lab VM the shared notes name (its topic note under `~/projects/notes/topics/`; 12 vCPUs, 31 GiB, Ubuntu 24.04, Node 26.13.0). Work directory `~/work/011-395/`, deleted at the end.
- Squeal **0.1.563**: `git archive v0.1.563 plugins/claude-code` from this repository, unpacked on the VM; the CLI is `plugins/claude-code/dist/cli/squeal.mjs`. Its `src/` equals this repository's `src/` at the research commit (`git diff --stat v0.1.563 HEAD -- src` is empty).
- Repository: a `git bundle` of `hearsay-tools/squawk` at `c11e4edf0` (2026-11-18 21:41Z, one commit after squawk PR #3915 of issue #245), cloned on the VM, `corepack pnpm@12.11.2 install --frozen-lockfile`. No credentials were copied.
- Isolation: `env.sh` gives every step a private `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `~/work/011-395/`, so the daemon shares no permit pool, user config or state with other agents' runs on the VM. The store is the clone's own `.git/squeal`. No user capacity config: `hostSlots` defaults to 11, the background ceiling to 9 of 12 CPUs.
- The daemon runs inside a systemd user scope (`start-daemon.sh`), so the scope's `cpu.stat` counts the daemon and every test process it starts, exited ones included.

## Steps, in order

All commands run on the VM as `bash -lc '...'` (nvm needs a login shell). `$P` is `~/work/011-395`.

1. Setup: copy `squawk.bundle` and `squeal-0.1.563.tgz` to `$P`, unpack, clone, install (above). Copy this directory to `$P/probe`.
2. `bash $P/probe/start-daemon.sh sq395a`, then `squeal run --fast` (the warm-up: every fast-lane test file once, which stores closures and durations). `bash $P/probe/wait-idle.sh 3400` returns when nothing outside the manual `e2e` project is queued or running.
3. Experiment A (question 1): `bash $P/probe/bg.sh A 5000 bash $P/probe/run-edit.sh A <daemon pid> sq395a packages/contract/src/ci-wait.ts 4500`. It starts `sample.sh` (load, busy cores, scope and daemon CPU every 5 s) and `queue-sample.mjs` (heartbeat age, queued and running files every 2 s), waits 15 s, appends one comment line to the file, and waits until idle.
4. `node $P/probe/files-of.mjs .git/squeal/store.sqlite $(cat $OUT/A.t0) $OUT/A` writes the files A ran; `squeal stop`; `bash $P/probe/bg.sh plainA 4000 bash $P/probe/plain.sh plainA $OUT/A` runs the same files with plain `vitest run` (squawk's own worker default, 12 here; no coverage) and plain `node --test`, as squawk's `package.json` runs them, with no daemon.
5. Experiment B (question 2): `bash $P/probe/start-daemon.sh sq395b`, wait idle, then `bash $P/probe/bg.sh B 6000 bash $P/probe/run-b.sh <daemon pid> sq395b 300 600 4800`: edit 1 to `ci-wait.ts`; at 300 s an edit of the queued test file with the longest stored duration (`pick-queued.mjs`) and `squeal status --wait 1800000 <next longest>`; at 600 s edit 3 to `ci-wait.ts` again. It also samples held permit locks (`lslocks`, `pool.N.lock` files) every 2 s.
6. Analysis: `node $P/probe/timeline.mjs <label> [project|path,...]` (runs, gaps, pool and quiet log lines, heartbeat, CPU, the queue each 60 s; the optional list prints when each named file first finished); `node $P/probe/estimate.mjs .git/squeal/store.sqlite <warm-up start ms> <edit ms> <edit ms> <width>` (question 3: the estimates Squeal could make at the edit from stored durations).
7. Clean-up: `squeal stop`, stop the samplers by their pids (`$OUT/*.pid`), `rm -rf ~/work/011-395`, check `ps` shows nothing of it.

## Traps met

- The 97 browser files (`e2e` project, check `browser` at `manual`) are re-keyed and stay queued until `squeal run browser`: an idle check must leave them out (`wait-idle.sh` does).
- Both daemons got SIGTERM from systemd within a second of this probe's last ssh session to the VM closing (A at 06:25:36Z, 400 s after its queue drained; B at 07:17:57Z, 38 s after). The VM user has `Linger=no`, so the user manager, and with it the scopes `start-daemon.sh` makes, stops when no session is left (*inferred* from the daemon log line "SIGTERM while it ran in systemd unit sq395a.scope", `loginctl show-user agent -p Linger` and `systemd --user` restarting under new pids). Keep one ssh session open for the whole run, or start the daemon outside a user scope and read its CPU another way. Neither drain was cut short.
- `pkill -f <pattern>` inside an `ssh '...'` command matches the remote shell's own command line and kills it (exit 255).
- Squawk's `run-loop` group (`at: pause`, 320 parity and worker tests) runs whenever no agent session is active, so with no harness attached it runs in its own tiers of 4 beside the backlog. In the incidents agents were mid-turn; read A and B with that difference.

## Files

`env.sh`, `bg.sh`, `start-daemon.sh`, `sample.sh`, `queue-sample.mjs`, `edit.sh`, `run-edit.sh`, `run-b.sh`, `pick-queued.mjs`, `wait-idle.sh`, `progress.sh`, `analyze.mjs`, `timeline.mjs`, `estimate.mjs`, `files-of.mjs`, `plain.sh`, `rerun.mjs` (experiment B: per edit window, file runs picked, finished, cancelled with unfinished files, finished earlier and run again; permits held per backlog tier).

`results/`: the sampler series (`A.tsv`, `B.tsv`, `*.queue.tsv`, `B.permits.txt`, `warm2.tsv` of the warm-up from 05:47Z), the edit times (`*.edits.tsv`), `A.timeline.json`, `B.timeline.json`, `B.rerun.json`, the estimates (`A.estimate.w*.json` from the warm-up's durations, `A.estimate-oracle.w*.json` from A's own, `B.estimate.w*.json` at edit 3), B's picked and named files (`B.picked.txt`, `B.named.txt`), the plain run (`plainA.*.time`, `plainA.vitest.tail.txt`) and the files A ran (`A.vitest.txt`, `A.node-test.txt`). Epoch times are UTC milliseconds. The VM's local clock is UTC+1, so `uptime` lines quoted from it read an hour ahead.
