# Probes: 003-19 dogfooding on cezarion (throwaway)

Throwaway scripts and trimmed logs for the section "Dogfooding on cezarion" in `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-08 with Node 24.21.0, Codex CLI 0.160.1 and the Squeal Codex plugin 0.1.31 from the real `~/.codex`. Times in the logs are UTC unless a line says otherwise.

## Rules followed

- The cezarion config lived only in linked worktrees of `/home/agent/projects/cezar` made with `git worktree add --detach`, `/tmp/squeal-dogfood-cezarion-56f54ae1` (agent sessions) and `/tmp/squeal-dogfood-cezarion-56f54ae1-b` (inheritance), both at `13351da8`, both removed with `git worktree remove --force` at the end. Nothing was edited, committed or stashed in cezar's main checkout. Its `git status` was the same before and after: three untracked entries (`.claude/`, `.opencode/`, `squeal.config.json`).
- The shared store `/home/agent/projects/cezar/.git/squeal/` was opened read only (`node:sqlite`, `readOnly: true`) and keeps every row and run log these worktrees wrote (ids `4ce39392decee992` and `35edde0f88e9b723`). Nothing there was deleted.
- `~/.codex/auth.json` and `~/.codex/config.toml` were never opened; `~/.codex` was never written by these scripts. The Codex rollouts under `~/.codex/sessions/` were read. No `--dangerously-bypass-hook-trust`.
- The two daemons were started by `ready.mjs` and stopped with `squeal stop`. Two orphaned `fake-dev-server.mjs` processes in the first daemon's process group (defect 8 in `lessons.md`) were terminated by pid. Nothing else was killed.
- The logs were grepped for key, bearer and authorization patterns before commit, with no hit.

## Files

- `ready.mjs <squeal.mjs> <root> [seconds]`: spawns `squeal start`, then polls the store every 100 ms for the first `test_file_keys` row and the `daemon-bootstrapped:<id>` meta row (written once the start scan and every runner graph are done), and samples the daemon's VmRSS.
- `poll-status.mjs <squeal.mjs> <root> <every s> <max s> [--until-full-suite]`: one line per `squeal status --json` poll.
- `store.mjs <store> <worktree-id> [t0] [--node-test-only]`: revisions, runs per project (node:test files listed), transitions, node:test closures, results and known states.
- `runlog.mjs <run log dir>...`: per node:test file of a run, its exit, completion, the file wrapper's duration and test counts, from `run.json` and `events-<i>.ndjson`.
- `unreached.mjs <root> <project log dir>...`: the worktree paths a recorder graph loaded that no test-file root reaches, i.e. what the adapter counts as preload loads (defect 3).
- `bin/session.sh <id> <prompt>`: one `codex exec --json -C <worktree> -s danger-full-access -m gpt-6.1-sol` session with a 2 s status poll beside it.
- `timeline.mjs`, `gaps.mjs`, `cli.mjs`: from `../../../../002-codex-adapter/research/probes/dogfood/`; `cli.mjs` also matches a quoted `squeal.mjs"` and `node --test`.
- `prompts/`: the three task prompts.
- `logs/`: `init.txt` and the configs (`squeal.config.seeded.json` as `squeal init` wrote it, `squeal.config.used.json` with `root:test:unit` added by hand); `own-run-*.txt`, the project's own scripts; `ready*.txt`, `baseline-*.txt`; per session `sN.timeline.txt`, `sN.gaps.txt`, `sN.squeal-commands.txt`, `sN.poll.txt`, `sN.times.txt`, `sN.rollout-path.txt` (the raw `codex exec --json` output is not kept); `store-wt1.txt`, `store-wt2.txt`; `agents.diff`, the three sessions' edits.
