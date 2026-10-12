#!/bin/sh
# Throwaway (005-04): batch 1, five subject sessions in the plain and ask fixtures.
D=$(dirname "$0"); W=/tmp/wave0-checks
echo "batch1 load before: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
sh $D/run-claude.sh cc1-plain $W/fx/plain 'Run these three commands in the Bash tool, one call each, and paste their raw output: `command -v squeal`, `squeal --version`, `echo "$PATH" | tr ":" "\n" | grep -i plugin`. Then list every skill available to you whose name contains squeal, with its name exactly as given to you. Do nothing else.' --permission-mode bypassPermissions &
sh $D/run-claude.sh cc2-ask $W/fx/ask '/ask-probe' --permission-mode bypassPermissions &
sh $D/run-codex.sh cx1-plain $W/fx/plain 'List every skill available to you whose name contains squeal: its name exactly as given to you, and its file path exactly as given to you. Then run `command -v squeal; echo "exit $?"` and paste the raw output. Do nothing else.' &
sh $D/run-codex.sh cx2-mention $W/fx/plain '$squeal:squeal Following that skill, find the Squeal CLI and run it with `--version`. Paste the exact command you ran and its raw output. Do nothing else.' &
sh $D/run-codex.sh cx3-timeout $W/fx/plain 'Run this exact shell command and then tell me what it printed: `date +%T; sleep 75; date +%T; echo finished`. Do not change the command and do not run anything else.' &
wait
echo "batch1 load after: $(cut -d' ' -f1-3 /proc/loadavg)" | tee -a $W/logs/sessions.txt
