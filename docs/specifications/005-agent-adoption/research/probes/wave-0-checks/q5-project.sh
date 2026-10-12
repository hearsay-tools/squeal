#!/bin/sh
# Throwaway (005-04, question 5): the hub moves to v132; Claude Code installs it at project
# scope in fx/enabled while user scope keeps 0.1.131. Restores the user entry (S1) first.
set -u
D=$(dirname "$0"); . "$D/env.sh"
x() { echo "\$ $*"; "$@" 2>&1; echo "[exit $?]"; }
python3 -I -c "import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['enabledPlugins']['squeal@hearsay']=True; json.dump(d,open(p,'w'),indent=2)" "$CLAUDE_CONFIG_DIR/settings.json"
sh "$D/setup.sh" hub v132
x claude plugin marketplace update hearsay
cd "$W/fx/enabled"
x claude plugin uninstall squeal@hearsay --scope project
x claude plugin install squeal@hearsay --scope project
echo "--- project settings"; cat .claude/settings.json
echo "--- installed_plugins.json"; cat "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"; echo
echo "--- list in fx/enabled"; claude plugin list --json 2>&1 | tr -d '\n' | sed 's/  */ /g'; echo
cd "$W/fx/plain"; echo "--- list in fx/plain"; claude plugin list 2>&1
