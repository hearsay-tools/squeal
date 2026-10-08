# Throwaway: sourced. Disables the user's Codex plugins and declares the walk hook in two forms per event.
W=/home/agent/projects/squeal/.ai/cezar/worktrees/0d86c6b4-9221-435b-a46e-7785f92c2b89/docs/specifications/001-core-loop/research/probes/harness-process-liveness/bin/walk.mjs
NOPLUG=(-c 'plugins."superpowers@apptension-dev".enabled=false'
        -c 'plugins."apptension-sdlc@apptension-dev".enabled=false'
        -c 'plugins."apptension-review@apptension-dev".enabled=false'
        -c 'plugins."squeal@squeal".enabled=false')
HOOKS=()
for e in SessionStart UserPromptSubmit PreToolUse PostToolUse Stop SubagentStart SubagentStop SessionEnd; do
  m=""; case $e in PreToolUse|PostToolUse) m='matcher="*",' ;; esac
  HOOKS+=(-c "hooks.$e=[{${m}hooks=[{type=\"command\",command='node $W codex-string',timeout=5},{type=\"command\",command='true || exit 0; exec node $W codex-sh-exec',timeout=5}]}]")
done
