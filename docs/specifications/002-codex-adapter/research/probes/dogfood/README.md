# Probes: 002-19 dogfooding with a Cezar Codex worker (throwaway)

Throwaway extraction scripts for the section "Dogfooding with a Cezar Codex worker" in `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-08 with Node 24.21.0, after the session they read had ended.

## Rules followed

- Every source was read, none written. The store was opened with `node:sqlite` `readOnly: true`. `~/.codex/auth.json` and `~/.codex/config.toml` were never opened. No token is printed: the logs were grepped for key, bearer and token patterns before commit, with no hit.
- The session: Cezar run `c7896f0e-662d-4172-adaf-81b907da8afe` (`--backend codex --model gpt-6.1-sol`) doing row 003-27 in a worktree removed since, Squeal worktree id `b2baa0c8131a6dc2`, Codex thread `01a1188e-2475-7030-aa81-c1396f0402c1`, Codex CLI 0.160.1, Squeal Codex plugin 0.1.24 from the real `~/.codex`.

## Sources

- The Codex rollout `~/.codex/sessions/2026/10/08/rollout-2026-10-08T00-48-51-01a1188e-2475-7030-aa81-c1396f0402c1.jsonl`: the model's whole context, every tool cell and command, Squeal's `additionalContext` as `developer` messages. It records no hook runs.
- Cezar's run log `/home/agent/projects/squeal/.ai/cezar/runs/c7896f0e-662d-4172-adaf-81b907da8afe.ndjson`, its `.handoff.md`, `.facts.json` and `-artifacts/` (the worker's full Vitest log and notes). The log records tool items and messages, not Codex's `hook/started` or `hook/completed`.
- The shared store `/home/agent/projects/squeal/.git/squeal/store.sqlite`. The worktree's `worktrees`, `revisions`, `runs`, `results`, `transitions`, `consumers` and `known_states` rows were gone when this ran (the worktree was removed); only its `meta` rows survive.

## Files

- `extract.sh`: regenerates `logs/` (`ROLLOUT` and `STORE` override the paths).
- `timeline.mjs <rollout> [--full-squeal]`: a readable timeline: cells, commands with status and exit, patches, assistant and Squeal messages, times as seconds after `session_meta`.
- `gaps.mjs <rollout>`: for each Squeal message, the time since the tool item before it (PostToolUse) or since `session_meta` (SessionStart); an upper bound on the hook, which the rollout does not time.
- `cli.mjs <rollout> [max]`: every command the agent ran that names `squeal`, with exit code, duration and output.
- `store.mjs <store> <worktree-id> [t0]`: what the store still holds for a worktree id.
- `logs/`: `timeline.txt`, `gaps.txt`, `squeal-commands.txt`, `store.txt`.
