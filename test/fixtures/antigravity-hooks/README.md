# Antigravity hook fixtures

Hook stdin payloads for spec 024 (row 024-03), in the shape `antigravity` `1.5.14` sends (`docs/specifications/024-antigravity-adapter/research/wave-0-checks.md` section 4): one line of camelCase JSON, keys in alphabetical order, zero values present, no trailing newline. Placeholder UUIDs, `/home/user/...` paths, short synthetic prompts and contents.

- Recorded shapes: `session-start`, `pre-invocation-*`, `pre-tool-use-write-file`, `pre-tool-use-edit-file`, `pre-tool-use-run-command`, `stop`, `stop-continued` (`executionNum: 1` after a `"continue"`), `stop-not-idle` (`fullyIdle: false` while a background subagent runs), and the `subagent-*` files (their own `conversationId`, `lastUserInput: ""`).
- Synthetic: `pre-tool-use-write-to-file`, `pre-tool-use-replace-file-content` and `pre-tool-use-multi-replace-file-content` (tool names from the official docs; the CLI was not seen to use them, so their `args` are a guess), and `stop-user-canceled` (`terminationReason` values other than `NO_TOOL_CALL` are in the built-in `hooks.md` only).
