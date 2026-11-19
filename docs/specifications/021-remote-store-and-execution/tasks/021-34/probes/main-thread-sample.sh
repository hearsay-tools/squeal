#!/bin/bash
# read-only: main thread CPU ticks and wchan of each squeal daemon, every 1 s for $1 s
pids=$(for p in /proc/[0-9]*; do c=$(tr '\0' ' ' < $p/cmdline 2>/dev/null); case "$c" in *squeal*daemon*) echo ${p#/proc/};; esac; done)
for p in $pids; do echo "pid $p $(tr '\0' ' ' </proc/$p/cmdline | cut -c1-200) cwd=$(readlink /proc/$p/cwd)"; done
for i in $(seq 1 $1); do
  for p in $pids; do
    [ -r /proc/$p/task/$p/stat ] || continue
    s=$(cut -d' ' -f3 /proc/$p/task/$p/stat); w=$(cat /proc/$p/task/$p/wchan 2>/dev/null)
    t=$(awk '{print $14+$15}' /proc/$p/task/$p/stat); a=$(awk '{print $14+$15}' /proc/$p/stat)
    echo "s $i $p $s $w $t $a"
  done
  sleep 1
done
