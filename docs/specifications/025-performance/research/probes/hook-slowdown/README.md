# Throwaway probes: hook and status slowdown (row 025-26)

Research fixtures for `research/hook-slowdown.md`. They are not product code or a benchmark cell. Run them only in a boat.dev sandbox (read `~/projects/notes/topics/boat-dev.md`), never on the developer host. Do not commit CPU profiles, worktrees or `node_modules`.

## Files

- `profile.mjs`: one plugin version against a real daemon on a copy of the benchmark's p500 project. Quiet timings (40 rounds of PreToolUse, PostToolBatch, `squeal status`, `status --json`), SQL and file counts of single calls (`instrument.mjs`), `--cpu-prof` of single calls, a 12-step `bench/session.mjs` session with the daemon tree's CPU, and three more sessions with the daemon's, the runner host's and the store process's main thread profiled through the inspector (SIGUSR1 and CDP on port 9229, one process at a time).
- `instrument.mjs`: a preload that counts executed `node:sqlite` statements and sync `fs` calls and writes them to `$PROBE_COUNTS/<pid>.json` at exit.
- `run.sh`: builds the p500 template from `bench/gen-project.mjs` (Vite as `bench/lib.mjs` pins it), then runs `profile.mjs` for each plugin, alternating the order per round.
- `killall.sh`: stops every probe process and daemon in the sandbox by pid. `pkill -f` inside `boat ssh` also matches the remote shell.
- `summarize.mjs`: reduces the fetched output to `results/profile-summary.json`.
- `cell-stats.mjs`: per-cell numbers of a benchmark results directory in run order, with each metric's correlation to the daemon's CPU per edit.

## What ran (2026-11-27)

1. `bench/boat-run.sh --ref squeal--v0.1.640 --ref squeal--v0.1.641 --ref 6e79c9e3d --ref squeal--v0.1.645 --ref 83825f040 --cells ref --repeat 3` with Vite 8.3.8 pinned locally in `bench/lib.mjs`. Output moved from `bench/results/` to `bench/bisect-ref/` here; `bench/results/TREND.md` was left unchanged.
2. The same with `--ref squeal--v0.1.640 --ref squeal--v0.1.645 --cells wt-3 --repeat 3`, in `bench/wt3/`.
3. In sandbox `bx_bhmawfs4`: the plugins of the five refs (`git archive <ref> plugins/claude-code`) under `plugins/<version>`, `bench/` (with the pin) and these scripts under `probe/`, then `bash probe/run.sh bench probe /home/user/out 2 plugins/0.1.640 plugins/0.1.641 plugins/0.1.644 plugins/0.1.645 plugins/0.1.653`. Then, locally on the fetched output, `node summarize.mjs <out> results/profile-summary.json`. `results/<version>-r<n>/` keeps each run's `result.json` and busy-session log; `results/exits.txt` shows that all ten runs exited 0.

Every sandbox was deleted after its run. No credentials were forwarded (`--no-env`).
