#!/bin/sh
# Throwaway (005-04, question 5): what `claude plugin list` says in a repository that enables
# squeal@hearsay in .claude/settings.json, per user-settings state. $1 = label, run from fx/enabled.
. "$(dirname "$0")/env.sh"
cd "$W/fx/enabled"
echo "== $1 (cwd fx/enabled), user enabledPlugins: $(grep -o '"squeal@hearsay": [a-z]*' "$CLAUDE_CONFIG_DIR/settings.json" || echo none)"
claude plugin list 2>&1; claude plugin list --json 2>&1 | tr -d '\n' | sed 's/  */ /g'; echo
