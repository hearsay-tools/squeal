# Throwaway probes: pull-advances-push

**Throwaway.** Nothing here is product code. These files exist only to produce the evidence cited in `../../pull-advances-push.md` (task 001-84). Delete them freely.

Claude Code 2.1.292, Linux, 2026-10-07. Every session ran in a fresh scratch git repository under `/tmp/sq84/<scenario>`, never in this repository, with the calling session's `CLAUDE*` and `CEZ_*` variables removed and `--setting-sources project`. No Squeal store or daemon was used.

## Layout

- `run.sh <scenario> <prompt> [claude args]`: `claude -p` with `--output-format stream-json --include-hook-events`. `TEMPLATE=<dir>` overlays a settings directory on `scenario-template/`; `PERM_MODE` overrides `bypassPermissions`.
- `irun.sh <scenario> <prompt>`: the same, interactive, in tmux on its own socket (`tmux -L sq84`).
- `hooks/log.sh`: records each hook's stdin and its `CLAUDE*` environment to `logs/<scenario>.hooks.jsonl`.
- `hooks/probe.sh <label>`: run by the agent through Bash; records what the subprocess sees (`CLAUDE*` variables, names of all others, process chain, file descriptors) to `logs/<scenario>.probe.txt`.
- `hooks/tag.mjs`: PreToolUse on Bash (`if: "Bash(./probe.sh *)"`) that rewrites the command through `updatedInput`; `TAG_SHAPE` = `prefix` (env assignments), `export`, or `flag` (appended argument).
- `hooks/emit.sh`: prints a block between begin and end lines, standing in for a pull's output.
- `scenario-template/`, `scenario-tag/`, `scenario-batch/`: hook settings and a `prober` agent.
- `race/race.probe.ts`: the store races, against this checkout's real store, state sink and delivery. Run from the repository root after `npm ci`: `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts`.

## Scenarios

| Scenario | Question | Mode |
|---|---|---|
| `p-main` | Bash env of main and two subagents (general-purpose, custom `prober`) | `-p` |
| `p-agent` | Bash env under `claude --agent prober` | `-p` |
| `i-main` | Bash env of main and a subagent, then after `/clear` | interactive, tmux |
| `p-tag` | `updatedInput` gives each of two parallel subagents its own agent id | `-p`, bypass |
| `p-tag-perm`, `p-tag-export`, `p-tag-flag`, `p-notag-perm` | does the rewritten command still match an allow rule | `-p`, default mode, `--allowedTools 'Bash(./probe.sh *)'` |
| `p-batch`, `p-batch-stderr` | PostToolUse and PostToolBatch see the result text, a piped variant, stderr | `-p` |
| `p-batch-sub` | whose PostToolBatch carries a subagent's Bash result | `-p` |
