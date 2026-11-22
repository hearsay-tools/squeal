# Probe data for 023-40c-measure.md

- `reps.json`: per rep, phase times (seconds from the call's start unless the key says `spawnTo...`) and the commit daemon tree's memory (MiB), from `scripts/analyze.mjs`. Labels: `quiet-*`, `group-*` (clean), `cold-*` (empty package store), `both-*` (no daemon before the call). Subject: 023-40's chain (tip `dd245530e`, the tree of `15417c90c`).
- `reps-d0925e820-chain.json`: three quiet reps on the chain of `d0925e820`'s own trees (tip `b434a39c7`), where the named file needs no run at the commit.
- `start-phases.txt`: the commit daemon's start, seconds from its spawn (`scripts/phases.mjs`).
- `group-memory.txt`: the group reps' memory after the idle GC and after the 40 files (`scripts/gmem.mjs`).
- `installs.jsonl`: `git worktree add` and `pnpm install --frozen-lockfile` alone, cold and warm store (ms).
- `three.txt`, `three.marks.jsonl`: three calls at once (`scripts/three.mjs`); only two commit daemons started.
- `profiles/*.txt`: CPU profile summaries (`scripts/prof.mjs`): the commit daemon's main thread, its runner-host and the call; quiet, and with both daemons starting together.
- `logs/`: each rep's daemon and store logs, merged and sorted.
- `calls/`: call reports: a quiet call and its second call, a `both` call, the three-daemon calls (the third waited for a place), the call on the `d0925e820` chain, one group.
- `driver.log`: the driver's log. `snapshot-agent-seconds.txt`: epoch seconds in which the sandbox's snapshot agent ran (checked every 2 s).
- `scripts/`: the driver (`run.sh`), the sampler, the quiet wait and the summaries; `~` is the sandbox's home.
