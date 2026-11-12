#!/bin/sh
# Throwaway (row 021-15). Runs on the sandbox, detached: every 0.5 s one line of
# UTC time, received and sent bytes of all interfaces but lo, load, and which first-connect
# marks exist under <cache>/squeal. Stops after <seconds>.
#   ssh boat-trial 'nohup sh -s <cache> <seconds> > /tmp/mon.log 2>&1 &' < remote-monitor.sh
C=${1:-$HOME/.cache}; N=$(( ${2:-300} * 2 ))
i=0
while [ $i -lt $N ]; do
  rx=$(awk -F'[: ]+' 'NR>2 && $2!="lo" {r+=$3; t+=$11} END {print r, t}' /proc/net/dev)
  b=-; ls -d "$C"/squeal/0.* >/dev/null 2>&1 && b=B
  f=-; ls "$C"/squeal/trees/*/files.json >/dev/null 2>&1 && f=F
  m=-; ls -d "$C"/squeal/trees/*/root/node_modules >/dev/null 2>&1 && m=M
  n=-; ls "$C"/squeal/trees/*/installed.json >/dev/null 2>&1 && n=I
  echo "$(date -u +%T.%N | cut -c1-12) $rx $(cut -d' ' -f1 /proc/loadavg) $b$f$m$n"
  i=$((i+1)); sleep 0.5
done
