#!/bin/sh
# Throwaway (005-04): batch 4. cc6: cc5 with installed_plugins.json's two entries in the
# other order (project first), to tell "user scope wins" from "first entry wins".
D=$(dirname "$0"); W=/tmp/wave0-checks; F=$W/home/.claude/plugins/installed_plugins.json
cp $F $W/installed_plugins.user-first.json
python3 -I -c "import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['plugins']['squeal@hearsay'].reverse(); json.dump(d,open(p,'w'),indent=2)" $F
echo "batch4 order: $(python3 -I -c "import json,sys; print([e['scope']+'@'+e['version'] for e in json.load(open(sys.argv[1]))['plugins']['squeal@hearsay']])" $F); load before: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
sh $D/run-claude.sh cc6-enabled-mixed-reordered $W/fx/enabled 'Run `command -v squeal; squeal --version` in the Bash tool and paste the raw output. Do nothing else.' --permission-mode bypassPermissions
echo "batch4 order after the session: $(python3 -I -c "import json,sys; print([e['scope']+'@'+e['version'] for e in json.load(open(sys.argv[1]))['plugins']['squeal@hearsay']])" $F); load after: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
