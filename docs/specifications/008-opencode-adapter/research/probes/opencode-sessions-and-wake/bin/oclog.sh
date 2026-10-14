#!/bin/sh
# Throwaway. Tail of this probe's OpenCode log, and this probe's processes.
. "$(dirname "$0")/env.sh"
ls -t $XDG_DATA_HOME/opencode/log/ | head -3
f=$XDG_DATA_HOME/opencode/log/$(ls -t $XDG_DATA_HOME/opencode/log/ | head -1)
grep -v -i "key\|token\|authorization" "$f" | tail -n ${1:-40} | cut -c1-300
ps -u squeal-e2e -o pid,ppid,pgid,etime,args | grep -E "opencode|beat" | grep -v grep | cut -c1-200
