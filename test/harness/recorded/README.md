# Recorded hook inputs

Hook input JSON for every event the Squeal plugin handles. The key sets are the ones Claude Code 2.1.288 sent in the research probes (`docs/specifications/001-core-loop/research/probes/claude-code-integration/logs/*.hooks.trim.jsonl`, which kept keys, ids and a few values, not whole payloads). Values follow the hook reference (code.claude.com/docs/en/hooks, fetched 2026-10-04). `SessionEnd` was not probed; its keys come from the reference.

Tests replace `cwd` with a fixture repository and leave every other field as recorded.
