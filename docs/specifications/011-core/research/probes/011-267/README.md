# Row 011-267 probes: a named wait as one batch

Throwaway research only. Outside every Vitest include list and outside Squeal's coverage. Findings: `../../named-wait-batches.md`. No product code is imported. No test, daemon, worktree hold or pool is touched. The model is deterministic, so host load does not change its numbers (load at the last run: `load.json`).

Inputs, read-only:

- `extract.mjs` reads cezar's store (`/home/agent/projects/cezar/.git/squeal/store.sqlite`, table `runs`, opened with `node:sqlite` `readOnly`) and each run's `log_dir/report.json`. It writes `traces.json`: every run of worktrees `fc6636c99e616927` (0.1.374) and `aa38987337df8e1f` (0.1.377), with per-file durations. `summary.mjs` prints one line per run (`summary.txt`).
- `waits.mjs` reads the 0.1.377 trial worker's wait outputs (`.ai/qa/2141/parity-*.json` in cezar worktree `563b3d1c`). It writes `waits.json`: each wait's start, end and pending files. The 0.1.374 wait times and both agents' own-file waits are copied into `scenarios.mjs` from the agents' Codex session logs (`~/.codex/sessions/2026/10/29/rollout-…-01a1853d-6b87-….jsonl` and `rollout-…-01a186fb-0ea2-….jsonl`).
- `lastknown.mjs` writes `lastknown.json`: each file's last file-level duration in the store before each trace's t0.

Model and runs (from this directory):

    node extract.mjs > traces.json && node summary.mjs > summary.txt
    node waits.mjs > waits.json
    node lastknown.mjs > lastknown.json
    node replay.mjs > replay-output.txt          # Q1, Q2 (writes replay.jsonl)
    node cases.mjs > cases-output.txt            # Q3, Q4, Q5 at W=11 (writes cases-W11.jsonl)
    W=23 node cases.mjs > cases-output-W23.txt
    W=6 node cases.mjs > cases-output-W6.txt
    node perfile.mjs > perfile-output.txt        # when each named file's own result lands
    node widths.mjs > widths-output.txt          # named-file durations by tier width
    node width-inferred.mjs > width-inferred-output.txt

`model.mjs` is one Vitest lane: tiers one at a time, results at a tier's end, `runner.tierSize` 4, tier sharing (ratio 4, floor 1 s), the backlog wall budget (120 s, 200 files), the turn after four first-group tiers, 0.1.377's promoted-only wide tier, and 1 s fixed cost per run. It leaves out yields, claims, quiet waits, class order inside the first group and pool contention. `scenarios.mjs` builds the two workloads; `cases.mjs` adds synthetic edits, one-file waits and wait streams.
