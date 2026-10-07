# Recorded Codex hook inputs

Hook stdin as Codex CLI 0.160.1 sent it on 2026-10-07, one file per event, by mode: `exec/`, `app-server/` and `tui/`. Tests replace `cwd` with a fixture repository and leave every other field as recorded.

Copied whole from the probe logs of spec 002 (`docs/specifications/002-codex-adapter/research/probes/`):

- `exec/`: `codex-hooks/logs/q2-exec-all-events.jsonl` (a `codex exec` run with shell calls, one `apply_patch` and one subagent; `subagent-*` are the subagent's own events, carrying `agent_id` and `agent_type`), and `stop-hook-active.json`, the second Stop of `codex-hooks/logs/q5-stop-blockonce.hooks.jsonl`.
- `tui/`: `codex-hooks/logs/q2-interactive-tui.jsonl` (the TUI in tmux: an Escape mid-tool gave `interrupt.json` with no Stop, `/compact` gave `session-start-compact.json` at the next prompt, `/exit` gave `session-end.json`).
- `app-server/`: `codex-hooks/logs/q5b-appserver-interrupt.hooks.jsonl` (a `thread/start`, `turn/start`, `turn/interrupt` run, then stdin EOF).
- `review/`: `proof/logs/n4inline2.stdin.jsonl`, one app-server thread with an inline `/review` (`review/start`, `delivery: "inline"`) between its two turns (002-16, `lessons.md` defect 2). `review-*` are the review thread's own hooks: the parent's `session_id`, no `agent_id`, and a `transcript_path` ending in the review thread's id; `user-prompt-submit-after-review.json` is the main thread's next turn. The log kept each prompt's first 80 characters and no `tool_input` or `tool_response`; its `dt` and the `prompt: null` it added to other events are dropped.

Reconstructed from recorded key sets and ids, values following the recorded files above:

- `app-server/session-start.json` and `app-server/stop.json`: the key sets of an app-server SessionStart and Stop from `codex-sessions-and-wake/evidence/hooks-r4.jsonl`, which kept key sets and ids, not whole payloads; ids, `cwd` and paths from `app-server/user-prompt-submit.json`, so one app-server session runs through every file.
- `exec/session-start-resume.json` and `exec/session-start-fork.json`: keys, ids and sources from `codex-sessions-and-wake/evidence/hooks-r1.jsonl` (`exec resume` keeps the thread id, `exec fork` mints one).
- `tui/session-start-clear.json`: `tui/session-start.json` with `source: "clear"`, a value the Codex hooks docs list and no probe recorded.

The `transcript_path` values of the resume and fork files and the `last_assistant_message` of `app-server/stop.json` are not recorded; no hook reads them.
