# Probes for 011-416: a shorter catch-up quiet for a large backlog

Throwaway. Written for `research/catchup-quiet.md` on 2026-11-19. Nothing here is product code, nothing imports it, and nothing here is maintained.

## Records (this host)

Every number is read from copies, taken back to back at 21:42Z on 2026-11-19: `store.sqlite` with `-wal` and `-shm` of `~/projects/squeal` and `~/projects/cezar`, and their `runs/<id>/report.json` files right after. No probe starts a daemon, a test or a Squeal command, and no live store is opened. Scratch: `/tmp/cq416`, removed after the commit.

| File | Does |
|---|---|
| `q.mjs <store> <sql>...` | ad hoc read-only queries |
| `episodes.mjs <store> <runs> [since]` | each recorded catch-up start (a run 119 to 126 s after the last watch revision), its runs until the next revision; and the histogram of every run's time since the last watch revision |
| `bursts.mjs <store> <runs> <config> <since> <Q'> <N> [dump]` | the replay: what a quiet of Q' s for a queue of more than N files would have done to each recorded catch-up and the edits before it (its header states the model) |
| `fails.mjs <store> <bursts dump>` | new failures each large catch-up found, and when |
| `results/` | the outputs `catchup-quiet.md` quotes |

A first model (`sim.mjs`, removed) rebuilt the whole catch-up queue from closures. It put 1,000 to 1,400 files in the queue after nearly every edit of a coordinator worktree, since it cannot see results other worktrees already stored at the new key, so the queue never drained and every threshold acted alike. `bursts.mjs` anchors on the files the daemons actually ran instead.

```sh
S=/tmp/cq416; R=<this folder>; mkdir -p $S/stores/{squeal,cezar} $S/runs/{squeal,cezar}
for r in squeal cezar; do (cd ~/projects/$r/.git/squeal && cp store.sqlite store.sqlite-wal store.sqlite-shm $S/stores/$r/); done
for r in squeal cezar; do (cd ~/projects/$r/.git/squeal/runs && find . -maxdepth 2 -name report.json -print0 | cpio -0 -pdm $S/runs/$r); done
cp ~/projects/cezar/squeal.config.json $S/cfg-cezar.json; git show HEAD:squeal.config.json > $S/cfg-squeal.json
cd $S
for r in squeal cezar; do node $R/episodes.mjs stores/$r/store.sqlite runs/$r 2026-10-25 > ep-$r.jsonl; done
for r in squeal cezar; do for q in "60 200" "30 200" "60 0" "30 0" "30 100" "30 500"; do node $R/bursts.mjs stores/$r/store.sqlite runs/$r cfg-$r.json 2026-10-25 $q; done; done
node $R/bursts.mjs stores/squeal/store.sqlite runs/squeal cfg-squeal.json 2026-10-25 30 200 dump > b.jsonl; node $R/fails.mjs stores/squeal/store.sqlite b.jsonl
```

## The lab VM (`vm/`)

011-400's probe (`../broad-change-throughput-2/`) with its work directory moved to `~/work/8fdf8a51` and these changes, each marked `011-416` in its file:

- `setup.sh`: Squeal **0.1.570** (`git archive v0.1.570 plugins/claude-code`), plus two CLI copies whose one changed line is `CATCHUP_QUIET_MS = 12e4;` → `60e3;` (`squeal-q60.mjs`) and `30e3;` (`squeal-q30.mjs`). Squawk at `c11e4edf0` (011-395's and 011-400's commit) from a bundle, branch `probe416`.
- `arm.sh`: `<cli>` is `q120`, `q60` or `q30`; it reverts the clone's earlier probe edits before each arm; `FOLLOW="<s> <path>"` adds a second edit.
- `arm.sh` also waits up to 240 s for a one-minute load under 1 before the edit and stops the series when another task's directory or process is on the VM; its CLI path uses `$P`, since `bg.sh` has moved `HOME` (the first start at 03:18Z failed on that, before any daemon started).
- `arms.mjs <out> <label>...`: one line per arm from its timeline, load and samples (`results/arms.jsonl`).
- `run-edit.sh`: the `FOLLOW` edit. `warm.sh`: no clone copies. `run-all.sh`: the arms in order.
- The rest (`env.sh`, `bg.sh`, `start-daemon.sh`, `sample.sh`, `queue-sample.mjs`, `workers.mjs`, `wait-idle.sh`, `hold.sh`, `edit.sh`, `timeline.mjs`, `tiers.mjs`, `refusals.mjs`) are 011-400's, with only the probe name changed.

Steps (each on the VM as `bash -lc '...'`, `$P` = `~/work/8fdf8a51`): copy `squawk.bundle`, `squeal-0.1.570.tgz` and `vm/` as `probe/` to `$P`; `bash $P/probe/setup.sh`; `bash $P/probe/bg.sh warm 6000 bash $P/probe/warm.sh`; `bash $P/probe/bg.sh all 30000 bash $P/probe/run-all.sh`. Keep one ssh session open for the whole run (the VM note's Linger warning). Clean-up: `squeal stop` in the clone, kill the samplers by their pid files, `rm -rf $P`. Ran 2026-11-20: setup and warm-up 03:01Z to 03:15Z, the arms 03:39Z to 05:54Z, `~/work/8fdf8a51` removed at 05:55Z. `results/`: each arm's records without profiles, home paths shortened to `~`.
