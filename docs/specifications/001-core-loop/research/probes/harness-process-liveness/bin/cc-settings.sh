#!/usr/bin/env bash
# Throwaway: write .claude/settings.json in $1 declaring the walk hook in three forms per event.
W=/home/agent/projects/squeal/.ai/cezar/worktrees/0d86c6b4-9221-435b-a46e-7785f92c2b89/docs/specifications/001-core-loop/research/probes/harness-process-liveness/bin/walk.mjs
FAST='s() { [ -n "$1" ] || return 1; [ -d "$1" ]; }; { s "$CLAUDE_PROJECT_DIR" || s "$PWD"; } 2>/dev/null || exit 0; exec "$@"'
node -e '
const [W, FAST, dir] = process.argv.slice(1);
const ev = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolBatch","Stop","SubagentStart","SubagentStop","SessionEnd"];
const hooks = {};
for (const e of ev) hooks[e] = [{ hooks: [
  { type: "command", command: "node", args: [W, "exec-form"], timeout: 5 },
  { type: "command", command: "sh", args: ["-c", FAST, "squeal", "node", W, "sh-fast-path"], timeout: 5 },
  { type: "command", command: `node ${W} string-form`, timeout: 5 },
]}];
require("fs").mkdirSync(dir + "/.claude", { recursive: true });
require("fs").writeFileSync(dir + "/.claude/settings.json", JSON.stringify({ hooks }, null, 2));
' "$W" "$FAST" "$1"
