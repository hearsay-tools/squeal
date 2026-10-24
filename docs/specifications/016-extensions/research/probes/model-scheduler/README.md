# Probe: a model-based test of the scheduler (016-18)

Throwaway. Nothing here runs in Squeal's suite: the file is named `.probe.ts`, outside `test/`, so Vitest's `include` does not reach it.

- `model.probe.ts`: a seeded generator of event sequences (edit, promote, a file's end, a run's finish or crash, a clock step, a clock jump inside the next decision, `run --all` with or without `--force`), a fake runner that holds every run until the sequence ends a file or the run, a virtual clock (`SchedulerOptions.now`) whose `setTimeout` timers fire when a step passes their deadline, and six invariants (A to F, `../../model-scheduler.md` question 1). It imports only `src/` APIs that exist from 0.1.224 to HEAD, and `test/scheduler/recording-sink.ts`. It passes no `capacity`, so the scheduler has no pool and never reads `/proc/stat`. It writes its repositories under `TMPDIR`.
- `run.sh <commit> <label> VAR=value...`: makes a detached worktree of the scratch clone `/tmp/ms18/repo` at `<commit>` under `/tmp/ms18/trees/`, symlinks `NODE_MODULES` (nothing is installed), copies the probe to `test/scheduler/model-probe.test.ts` there and runs it under `nice -n 10` and `/usr/bin/time`, with `HOME`, `XDG_*` and `TMPDIR` under `/tmp/ms18`. Variables: `SEEDS` (`1-200`), `LEN` (events per sequence, 12), `INV` (`A,B,C,D,E`), `KIND` (`vitest`, `node`, `mixed`), `STOP` (`first` or `all`), `SHRINK=1` (greedy one-event deletion of the first find), `DEBUG=1` (a trace line per event).
- `replay.sh`: each pre-fix commit, then its fix commit on the seeds the pre-fix run tried; `HEAD_RUN=1` adds HEAD, every invariant, 300 seeds.
- `results/*.json`: each run's output (`tried`, `firstFind` with the shortest sequence, every seed's steps, time and violations). `results/log-1.txt` (first pass: R398, R397, R345, R427) and `log-2.txt` (R427 again after the E fix, then HEAD): the commands, loads and `time` figures. `results/directed.md`: the hand-placed sequences. The first pass ran an earlier `model.probe.ts`: E did not yet exempt crashed files (node kind only, so only R427 changed; it ran again in `log-2.txt`), A did not yet judge the event's start reading (it gave `r397-fix.json`'s seed 97), and B and A already read the daemon's promotions.

Rerun:

```sh
git clone -q --no-checkout <this repository> /tmp/ms18/repo
NODE_MODULES=$PWD/node_modules docs/specifications/016-extensions/research/probes/model-scheduler/run.sh 5ecb377a8 r398-pre SEEDS=1-200 KIND=vitest SHRINK=1
```

Clean up: `git -C /tmp/ms18/repo worktree prune` after `rm -rf /tmp/ms18`.
