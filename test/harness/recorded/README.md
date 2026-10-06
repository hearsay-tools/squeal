# Recorded hook inputs

Hook input JSON for every event the Squeal plugin handles. The key sets are the ones Claude Code 2.1.288 sent in the research probes (`docs/specifications/001-core-loop/research/probes/claude-code-integration/logs/*.hooks.trim.jsonl`, which kept keys, ids and a few values, not whole payloads). Values follow the hook reference (code.claude.com/docs/en/hooks, fetched 2026-10-04). `SessionEnd` was not probed; its keys come from the reference.

Tests replace `cwd` with a fixture repository and leave every other field as recorded.

`subagent-stop-fork.json` is the SubagentStop of Claude Code's `prompt_suggestion` fork as Claude Code 2.1.291 sent it in an attended scratch session with `--debug hooks` (2026-10-06), with session id, paths and the scratch `cwd` replaced. Its `agent_type` is `""` and it has no `last_assistant_message`. The `/btw` fork (`side_question`) sent the same keys plus `last_assistant_message`. Neither fork fired SubagentStart or any other hook in that session. `subagent-start-fork.json` is therefore not recorded: it has the keys of `subagent-start.json` with the fork's `agent_id`, `agent_type` and `prompt_id`, the input a fork's SubagentStart would carry if a Claude Code version fired one (the first dogfooding re-run read one in 2.1.288, lessons surprise 6).
