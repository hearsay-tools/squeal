#!/bin/sh
# Throwaway (daemon-model Q1). Read only: for each daemon pid given, the main thread's state, wchan and the share of one
# CPU its main thread used over 3 s, from /proc. Opens no socket, signals nothing.
for p in "$@"; do
  a=$(awk '{print $14+$15}' /proc/$p/task/$p/stat 2>/dev/null) || continue
  set -- "$@"; s1=$a
  eval "s_$p=$s1"
done
sleep 3
for p in "$@"; do
  eval "s1=\$s_$p"; [ -z "$s1" ] && continue
  s2=$(awk '{print $14+$15}' /proc/$p/task/$p/stat 2>/dev/null) || continue
  st=$(awk '{print $3}' /proc/$p/task/$p/stat); w=$(cat /proc/$p/task/$p/wchan 2>/dev/null)
  echo "$p main-thread state=$st wchan=$w cpu=$(( (s2 - s1) * 100 / 300 ))%"
done
