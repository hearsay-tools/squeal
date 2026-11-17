#!/bin/sh
# Throwaway. Wall time of: node -e 0; the session-start bundle with empty stdin (Node start,
# bundle load, exit); the bundle through hooks/run with a SessionStart input whose cwd is outside
# any git worktree (adds input parse and locate). N runs each, interleaved. Prints ms per run.
# Usage: node-start.sh <plugin-dir> <N>
d=$1 n=$2
input=$(node -e 'console.log(JSON.stringify({ session_id: "probe", hook_event_name: "SessionStart", source: "resume", cwd: "/" }))')
ms() { s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e - s) / 1000000 )); }
i=0
while [ $i -lt "$n" ]; do
  a=$(ms node -e 0)
  b=$(ms sh -c "node --disable-warning=ExperimentalWarning $d/dist/session-start.mjs </dev/null")
  c=$(cd / && ms sh -c "echo '$input' | $d/hooks/run node --disable-warning=ExperimentalWarning $d/dist/session-start.mjs")
  echo "$a $b $c $(cut -d' ' -f1 /proc/loadavg)"
  i=$((i + 1))
done
