#!/bin/sh
# Throwaway (daemon-model Q1). Read only: every second for N seconds, the wchan of each given daemon's main thread.
# hrtimer_nanosleep in a Node main thread is a synchronous sleep: SQLite's busy handler (inferred; node's own idle is
# ep_poll, Atomics.wait is a futex wait). Usage: wchan-sample.sh SECONDS PID...
n=$1; shift
i=0
while [ $i -lt $n ]; do
  for p in "$@"; do
    [ -r /proc/$p/task/$p/wchan ] || continue
    printf '%s %s %s %s\n' "$(date -u +%s)" "$p" "$(awk '{print $3}' /proc/$p/task/$p/stat)" "$(cat /proc/$p/task/$p/wchan)"
  done
  sleep 1; i=$((i+1))
done
