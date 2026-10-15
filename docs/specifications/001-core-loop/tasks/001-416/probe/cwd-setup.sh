set -eu
P=/home/squeal-e2e/probe-416
rm -rf "$P"; mkdir -p "$P/repo/.claude/agents"; cd "$P/repo"
git init -q -b main . && git config user.email p@x && git config user.name p
echo probe > README.md
LOG="$P/hooks.jsonl"
cat > .claude/settings.json <<JSON
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "sh -c 'cat >> $LOG; echo >> $LOG'" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "sh -c 'cat >> $LOG; echo >> $LOG'" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "sh -c 'cat >> $LOG; echo >> $LOG'" }] }],
    "PostToolBatch": [{ "hooks": [{ "type": "command", "command": "sh -c 'cat >> $LOG; echo >> $LOG'" }] }]
  }
}
JSON
cat > .claude/agents/iso.md <<'MD'
---
name: iso
description: Runs one shell command in an isolated git worktree and reports its output verbatim.
isolation: worktree
tools: Bash
---
Run the shell command you are given with the Bash tool and report its output verbatim.
MD
git add -A && git commit -qm init
echo setup-done
