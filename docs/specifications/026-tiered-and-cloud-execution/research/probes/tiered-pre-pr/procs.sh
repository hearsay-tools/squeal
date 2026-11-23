#!/bin/sh
# Throwaway (026, tiered-pre-pr). Lists every process whose environment holds
# HOME=<probe home>, i.e. every process the probe's daemon started, with RSS.
# Usage: procs.sh <probe home> <label>
PH=$1; LABEL=$2
total=0; n=0
echo "-- $LABEL ($(date -u +%H:%M:%SZ), load $(cut -d' ' -f1 /proc/loadavg))"
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "HOME=$PH"; then
    rss=$(awk '/^VmRSS/ {print $2}' "$d/status" 2>/dev/null)
    [ -z "$rss" ] && continue
    args=$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null | sed "s#$PH#<home>#g; s#[^ ]*/plugins/claude-code/dist/#<dist>/#g; s#[^ ]*/bin/node #node #; s#--disable-warning=ExperimentalWarning ##g" | cut -c1-140)
    echo "  pid $pid rss $((rss / 1024)) MB: $args"
    total=$((total + rss)); n=$((n + 1))
  fi
done
echo "  processes $n, total rss $((total / 1024)) MB"
