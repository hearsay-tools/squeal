#!/bin/sh
# Throwaway (005-04, question 5): user-scope install at 0.1.131 in Claude Code and Codex,
# from the scratch hub, with each harness's own CLI under the scratch homes.
set -u
. "$(dirname "$0")/env.sh"
x() { echo "\$ $*"; "$@" 2>&1; echo "[exit $?]"; }
x claude plugin marketplace add "$W/hub"
x claude plugin install squeal@hearsay --scope user
x claude plugin list --json
x codex plugin marketplace add "$W/hub"
x codex plugin add squeal@hearsay
x codex plugin list
echo "--- installed_plugins.json"; cat "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
echo "--- user settings"; cat "$CLAUDE_CONFIG_DIR/settings.json" 2>/dev/null
echo "--- codex cache"; find "$CODEX_HOME/plugins/cache" -maxdepth 3 2>/dev/null
