# Probe data for 023-40-measure.md

- `batch1-reps.json`, `batch2-reps.json`: per run, the phase times (seconds from the call's start) and the commit daemon tree's memory (MiB), from `scripts/analyze.mjs`. Batch 1 is contended, batch 2 clean (see the method in `../../tasks/023-40-measure.md`).
- `installs.jsonl`: `git worktree add` and `pnpm install --frozen-lockfile` alone, cold and warm store (ms).
- `batch1-three.txt`, `batch2-three.txt`: three commit daemons, from `scripts/three.mjs`.
- `profiles/*.txt`: CPU profile summaries (`scripts/prof.mjs`): the commit daemon's main thread, its runner-host and the call, quiet and contended.
- `logs/`: the daemon logs of each run, merged and sorted.
- `call-quiet-1.out`: one call's report; `three-group-deadline.out`: the group that did not finish in 600 s.
- `scripts/`: the driver (`run.sh`) and the sampler; `~` is the sandbox's home.
