#!/bin/sh
# Throwaway. After r5: which background sleeps the agent's shell started are still alive, then kill them.
for s in 301 302; do
  p=$(pgrep -u squeal-e2e -f "^sleep $s\$")
  if [ -n "$p" ]; then echo "sleep $s alive pid=$p pgid=$(ps -o pgid= -p $p | tr -d ' ') ppid=$(ps -o ppid= -p $p | tr -d ' ')"; kill $p; else echo "sleep $s gone"; fi
done
