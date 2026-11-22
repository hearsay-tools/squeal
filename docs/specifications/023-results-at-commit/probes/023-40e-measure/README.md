# Probe data for 023-40e-measure.md

First sandbox (cand/0.1.594 `2b8d9297c` and the 023-40c bundle `d0925e820` as a same-machine baseline):

- `reps.json`: per rep, phase times (seconds from the call's start unless the key says `spawnTo...`) and the commit daemon tree's memory (MiB), from `scripts/analyze.mjs` (`TIP=5ca787002`). Labels: `quiet-*`, `group-*` (clean), `cold-*` (empty package store), `both-*` (no daemon before the call), `count-*` (the instrumented counting copy), `base-*` (the 023-40c bundle).
- `walks.jsonl`: the counting reps' start split (`scripts/instrument.mjs`): the unresolved walk's size, then the recheck's misses, proven and walked, by reason.
- `start-phases.txt`, `group-memory.txt`, `three.txt`, `three.marks.jsonl`, `installs.jsonl`, `driver.log`: as in 023-40c-measure.
- `profiles/*.txt`: CPU profile summaries of the quiet profiled call (the `both` profile wrote no files).
- `logs/`: each rep's daemon and store logs, merged and sorted. `calls/`: selected call reports, among them a second call that exited 13 (`group-3.call2.err`).

Second sandbox (`sandbox2/`): the group check (`base-group-*` with the 023-40c bundle, `group-b*` with 0.1.594, wait 900 s) and 16 reps on 0.1.595 (`v595-*`, `scripts/run2.sh second595`).

- `scripts/`: the driver (`run.sh`, `run2.sh`), the sandbox setup, the sampler, the quiet wait and the summaries; `~` is the sandbox's home. The subject chain is built with `git commit-tree` on the trees of `15417c90c~3..15417c90c` and pushed as a bundle.
