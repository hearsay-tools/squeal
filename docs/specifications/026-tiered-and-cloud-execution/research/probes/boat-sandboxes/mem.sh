#!/bin/sh
# Throwaway (026 boat-sandboxes). On the sandbox in ~/squeal: memory in use (MemTotal minus
# MemAvailable) before and at its peak (sampled every 0.2 s) while Vitest runs
# test/scheduler (all files, 4 workers), and the peak sum of RSS of every node process.
#   boat ssh <id> -- sh -s <label> < mem.sh
L=${1:-run}
cd "$HOME/squeal"
used() { awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{print int((t-a)/1024)}' /proc/meminfo; }
noderss() { ps -C node -o rss= | awk '{s+=$1} END{print int(s/1024)}'; }
base=$(used)
NO_COLOR=1 node_modules/.bin/vitest run test/scheduler --maxWorkers=4 --reporter=dot > /tmp/mem-run.log 2>&1 &
pid=$!
peak=0; rpeak=0
while kill -0 $pid 2>/dev/null; do
  u=$(used); r=$(noderss)
  [ "$u" -gt "$peak" ] && peak=$u
  [ "$r" -gt "$rpeak" ] && rpeak=$r
  sleep 0.2
done
wait $pid; rc=$?
echo "$L: exit $rc; used before $base MiB, peak $peak MiB; node RSS peak $rpeak MiB; $(grep -E 'Test Files|Duration' /tmp/mem-run.log | tr -s ' ' | tr '\n' ';')"
