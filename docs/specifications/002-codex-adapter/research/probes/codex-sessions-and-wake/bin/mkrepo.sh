#!/bin/sh
# Throwaway: make a scratch git repo under /tmp/csw/<name> whose .codex/hooks.json logs every event.
# Usage: mkrepo.sh <name> [primer-file]
set -eu
PROBE=$(cd "$(dirname "$0")/.." && pwd)
R=/tmp/csw/$1; LOG=/tmp/csw/logs/$1.jsonl
rm -rf "$R"; mkdir -p "$R/.codex" /tmp/csw/logs; : > "$LOG"
cd "$R"; git init -q; echo "# scratch $1" > README.md
printf 'export function add(a, b) { return a + b; }\n' > add.js
git add -A; git -c user.email=p@p -c user.name=p commit -qm init
CMD="node $PROBE/hooks/log-event.mjs $LOG ${2:-}"
node -e '
const cmd = process.argv[1]; const ev = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PermissionRequest","Stop","SubagentStart","SubagentStop","PreCompact","PostCompact","Interrupt","SessionEnd"];
const hooks = {}; for (const e of ev) hooks[e] = [{ hooks: [{ type: "command", command: cmd, timeout: 5 }] }];
process.stdout.write(JSON.stringify({ hooks }, null, 2));' "$CMD" > .codex/hooks.json
echo "$R"
