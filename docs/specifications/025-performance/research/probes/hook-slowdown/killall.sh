#!/usr/bin/env bash
# Throwaway: stop every probe process and Squeal daemon in this sandbox (by pid, not pkill -f).
me=$$
for pat in "probe/run.sh" "profile.mjs" "session.mjs" "squeal.mjs" "squeal wt0" "vitest"; do
  ps -eo pid=,args= | awk -v p="$pat" -v me="$me" 'index($0,p) && $1!=me && !/awk/ && !/killall.sh/ {print $1}' | xargs -r kill 2>/dev/null
done
sleep 3
ps -eo pid=,args= | grep -E "squeal|profile.mjs|run.sh|vitest" | grep -v -E "grep|killall" | cut -c1-120
