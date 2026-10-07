#!/usr/bin/env bash
# Throwaway: scratch repository /tmp/w0c/r-<name> shaped like Squeal's plugin layout.
#   layout = one  : .claude-plugin/marketplace.json with the Claude entry "squeal" and a second
#                   entry "<codex-name>" at ./plugins/codex (default codex-name: squeal-codex)
#            dup  : same file, both entries named "squeal"
#            split: .claude-plugin/marketplace.json with the Claude entry only, plus
#                   .agents/plugins/marketplace.json with one entry "squeal" at ./plugins/codex
# Usage: mkrepo.sh <name> <layout> [codex-name] [codex-version]
# Every hook command is bin/hook.sh <label>, which only logs.
set -e
HOOK="$(cd "$(dirname "$0")" && pwd)/hook.sh"
name=$1; layout=$2; cname=${3:-squeal-codex}; cver=${4:-0.1.14}
[ "$layout" = dup ] && cname=squeal
[ "$layout" = split ] && cname=squeal
d="/tmp/w0c/r-$name"; rm -rf "$d"; mkdir -p "$d"; cd "$d"; git init -q
printf 'export const add = (a, b) => a + b;\n' > a.js
# Claude Code plugin: the real manifest, a hooks.json in Claude's shape (command + args).
mkdir -p plugins/claude-code/.claude-plugin plugins/claude-code/hooks
cat > plugins/claude-code/.claude-plugin/plugin.json <<J
{ "name": "squeal", "version": "0.1.14", "description": "Claude Code plugin stand-in." }
J
cat > plugins/claude-code/hooks/hooks.json <<J
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "sh", "args": ["$HOOK", "claude-plugin-SessionStart"], "timeout": 2 } ] } ] } }
J
# Codex plugin
mkdir -p plugins/codex/.codex-plugin plugins/codex/hooks plugins/codex/skills/squeal
cat > plugins/codex/.codex-plugin/plugin.json <<J
{ "name": "$cname", "version": "$cver", "description": "Codex plugin stand-in." }
J
# Codex hooks: several shapes, so the hash port is tested on matchers, statusMessage,
# additionalContextLimit, clamped timeouts and an unexpanded ${PLUGIN_ROOT}.
cp "$HOOK" plugins/codex/hooks/log.sh
L='sh \"${PLUGIN_ROOT}/hooks/log.sh\"'
cat > plugins/codex/hooks/hooks.json <<J
{ "hooks": {
  "SessionStart": [ { "hooks": [ { "type": "command", "command": "$L SessionStart", "timeout": 2 } ] } ],
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "$L UserPromptSubmit", "timeout": 2 } ] } ],
  "PreToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$L PreToolUse", "timeout": 2 } ] },
                  { "matcher": "apply_patch", "hooks": [ { "type": "command", "command": "$L PreToolUse-patch", "timeout": 2, "statusMessage": "squeal" } ] } ],
  "PostToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$L PostToolUse", "timeout": 2, "additionalContextLimit": 0 } ] } ],
  "Stop": [ { "matcher": "ignored", "hooks": [ { "type": "command", "command": "$L Stop", "timeout": 2 } ] } ],
  "SubagentStart": [ { "hooks": [ { "type": "command", "command": "$L SubagentStart" } ] } ],
  "SessionEnd": [ { "hooks": [ { "type": "command", "command": "$L SessionEnd", "timeout": 3 } ] } ],
  "Interrupt": [ { "hooks": [ { "type": "command", "command": "$L Interrupt", "timeout": 9 } ] } ]
} }
J
printf -- '---\nname: squeal\ndescription: stand-in skill\n---\nstand-in\n' > plugins/codex/skills/squeal/SKILL.md
mkdir -p .claude-plugin
claude_entry='{ "name": "squeal", "source": "./plugins/claude-code", "description": "Claude Code" }'
codex_entry="{ \"name\": \"$cname\", \"source\": \"./plugins/codex\", \"description\": \"Codex\" }"
case $layout in
  one|dup) printf '{ "name": "squeal", "owner": {"name": "Hearsay"}, "plugins": [ %s, %s ] }\n' "$claude_entry" "$codex_entry" > .claude-plugin/marketplace.json ;;
  split)   printf '{ "name": "squeal", "owner": {"name": "Hearsay"}, "plugins": [ %s ] }\n' "$claude_entry" > .claude-plugin/marketplace.json
           mkdir -p .agents/plugins
           printf '{ "name": "squeal", "plugins": [ %s ] }\n' "$codex_entry" > .agents/plugins/marketplace.json ;;
esac
git add -A; git -c user.email=p@p -c user.name=p commit -qm init
echo "$d"
