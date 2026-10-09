# Logs (throwaway)

Trimmed evidence from `/tmp/r52/logs`, written by `../bin/collect.sh`. Times are ms after the session started.

- `sessions.tsv`, `sessions.json`: one row per condition session from `../bin/measure.mjs`: wall time, the agent's test commands (scope, duration, `DENIED` when 001's allow-list refused a compound command), Squeal calls, skill reads, SQUEAL texts the model received, cost (Claude Code) or tokens (Codex), the ground truth and the final message.
- `<label>.calls.txt`: every tool call, hook text and final message of one session (`../bin/calls.mjs`). `<label>.truth.txt`: the ground-truth Vitest lines after it.
- Labels: `c*` Claude Code task 1, `x*` Codex task 1, `t*` Claude Code task 2, `tx*` Codex task 2; the letter after it is the condition (`a`, `b1`..`b3`, `c`, `d`), `b` alone is `b2`. `nb-c`, `nb-x2`: block `b2` with markers, plugin absent. `nb-x`: meant as plugin absent, but the `-c` override did not disable the Codex plugin (its hooks ran), so it counts as a `b2` session with a cold daemon. `can-*`: the question 1 canaries (`can-c2` is `/compact`, `can-c3` and `can-x3` re-ask after compaction, `can-c4` has AGENTS.md only).
- Raw stream-json, Codex rollouts and Claude Code transcripts stayed under `/tmp/r52` and `~/.claude/projects/-tmp-r52-runs-*`; the extracts quoted in the findings come from them.
