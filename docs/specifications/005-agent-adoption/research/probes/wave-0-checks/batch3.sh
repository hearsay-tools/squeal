#!/bin/sh
# Throwaway (005-04): batch 3, user entry true (S1). cc1c: cc1 in fx/plain, clean PATH.
# cc5: fx/enabled with user scope at 0.1.131 and project scope at 0.1.132.
D=$(dirname "$0"); W=/tmp/wave0-checks
echo "batch3 load before: $(cut -d' ' -f1-3 /proc/loadavg); user settings: $(tr -d '\n ' < $W/home/.claude/settings.json)" | tee -a $W/logs/sessions.txt
sh $D/run-claude.sh cc1c-plain $W/fx/plain 'Run these three commands in the Bash tool, one call each, and paste their raw output: `command -v squeal`, `squeal --version`, `echo "$PATH" | tr ":" "\n" | grep -i plugin`. Then list every skill available to you whose name contains squeal, with its name exactly as given to you. Do nothing else.' --permission-mode bypassPermissions &
sh $D/run-claude.sh cc5-enabled-mixed $W/fx/enabled 'Run `command -v squeal; squeal --version; echo "$PATH" | tr ":" "\n" | grep -i plugin` in the Bash tool and paste the raw output. Do nothing else.' --permission-mode bypassPermissions &
wait
echo "batch3 load after: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
