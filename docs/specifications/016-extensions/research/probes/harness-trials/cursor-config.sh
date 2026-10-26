#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e. Writes, in ~/ht035/repo, the same
# logging hook under two sources: .cursor/hooks.json (Cursor format, tag
# "cursor") and .claude/settings.json (Claude Code format, tag "claude",
# including PostToolBatch and SubagentStart, which Cursor does not map).
# With "off" it removes both. With "squeal" it writes only .cursor/hooks.json,
# with cursor-squeal.sh (Squeal's shipped Claude Code bundles behind a
# translator) on sessionStart, preToolUse, postToolUse and stop.
set -eu
cd "$HOME/ht035/repo"
rm -rf .cursor .claude
[ "${1:-}" = off ] && exit 0
if [ "${1:-}" = squeal ]; then
  mkdir -p .cursor "$HOME/ht035/logs"
  T="sh $HOME/ht035/probe/cursor-squeal.sh"
  node -e '
const [t] = process.argv.slice(1);
const pairs = { sessionStart: "session-start", preToolUse: "pre-tool-use", postToolUse: "post-tool-batch", stop: "stop" };
const hooks = Object.fromEntries(Object.entries(pairs).map(([e, b]) => [e, [{ command: `${t} ${b}`, timeout: 10 }]]));
require("fs").writeFileSync(".cursor/hooks.json", JSON.stringify({ version: 1, hooks }, null, 2));
' "$T"
  echo "squeal hooks written"
  exit 0
fi
H="/opt/squeal-e2e/node24/bin/node $HOME/ht035/probe/cursor-hook.mjs"
mkdir -p .cursor .claude
node -e '
const [h] = process.argv.slice(1);
const fs = require("fs");
const cursorEvents = ["sessionStart","sessionEnd","beforeSubmitPrompt","preToolUse","postToolUse","postToolUseFailure","beforeShellExecution","afterShellExecution","beforeReadFile","afterFileEdit","afterAgentResponse","stop","preCompact","subagentStart","subagentStop"];
const cursor = { version: 1, hooks: Object.fromEntries(cursorEvents.map((e) => [e, [{ command: `${h} cursor`, timeout: 10 }]])) };
fs.writeFileSync(".cursor/hooks.json", JSON.stringify(cursor, null, 2));
const claudeEvents = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PostToolBatch","Stop","SubagentStart","SessionEnd"];
const claude = { hooks: Object.fromEntries(claudeEvents.map((e) => [e, [{ matcher: "*", hooks: [{ type: "command", command: `${h} claude`, timeout: 10 }] }]])) };
fs.writeFileSync(".claude/settings.json", JSON.stringify(claude, null, 2));
' "$H"
mkdir -p "$HOME/ht035/logs"
echo "hooks written"
