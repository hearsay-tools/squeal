#!/bin/sh
# Throwaway (005-04): batch 2. cc1b: cc1 again with the real plugin bin off PATH.
# cc4: fx/enabled with the user-scope install and no user enabledPlugins entry (S2).
D=$(dirname "$0"); W=/tmp/wave0-checks
python3 -I -c "import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['enabledPlugins'].pop('squeal@hearsay',None); json.dump(d,open(p,'w'),indent=2)" $W/home/.claude/settings.json
echo "batch2 load before: $(cut -d' ' -f1-3 /proc/loadavg); user settings: $(tr -d '\n ' < $W/home/.claude/settings.json)" | tee -a $W/logs/sessions.txt
sh $D/run-claude.sh cc1b-plain $W/fx/plain 'Run these three commands in the Bash tool, one call each, and paste their raw output: `command -v squeal`, `squeal --version`, `echo "$PATH" | tr ":" "\n" | grep -i plugin`. Then list every skill available to you whose name contains squeal, with its name exactly as given to you. Do nothing else.' --permission-mode bypassPermissions
sh $D/run-claude.sh cc4-enabled-s2 $W/fx/enabled 'Run `command -v squeal; squeal --version` in the Bash tool and paste the raw output. Do nothing else.' --permission-mode bypassPermissions
echo "batch2 load after: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
