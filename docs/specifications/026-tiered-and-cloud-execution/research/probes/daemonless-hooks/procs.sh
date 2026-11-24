#!/bin/sh
# Throwaway (026, daemonless-hooks). Lists every process whose environment holds
# HOME=<probe home>: RSS, private memory (smaps_rollup) and CPU seconds so far, waited-for children included.
# Usage: procs.sh <probe home> <label>
PH=$1; LABEL=$2
tot=0; totp=0; totc=0; n=0
echo "-- $LABEL ($(date -u +%H:%M:%SZ), load $(cut -d' ' -f1 /proc/loadavg))"
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "HOME=$PH"; then
    rss=$(awk '/^VmRSS/ {print $2}' "$d/status" 2>/dev/null); [ -z "$rss" ] && continue
    priv=$(awk '/^Private_(Clean|Dirty)/ {s+=$2} END {print s+0}' "$d/smaps_rollup" 2>/dev/null)
    cpu=$(awk '{print $14+$15+$16+$17}' "$d/stat" 2>/dev/null)
    args=$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null | sed "s#$PH#<home>#g; s#[^ ]*/plugins/claude-code/dist/#<dist>/#g; s#[^ ]*/bin/node #node #; s#--disable-warning=ExperimentalWarning ##g; s#[^ ]*/t/7652fba7/#<tmp>/#g" | cut -c1-110)
    echo "  pid $pid rss $((rss / 1024)) MB private $((priv / 1024)) MB cpu $((cpu / 100)).$((cpu % 100 / 10)) s: $args"
    tot=$((tot + rss)); totp=$((totp + priv)); totc=$((totc + cpu)); n=$((n + 1))
  fi
done
echo "  processes $n, total rss $((tot / 1024)) MB, private $((totp / 1024)) MB, cpu $((totc / 100)).$((totc % 100 / 10)) s"
