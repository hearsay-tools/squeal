#!/usr/bin/env bash
# Throwaway probe (research 023-37). In an existing worktree with node_modules installed:
# start its own daemon, time start and lookup-only settle, sample the daemon tree's memory
# idle, time one narrowed run with --wait, sample memory again, stop, time the stop.
# Usage: daemon-cost.sh <worktree> <group> <one test file>
set -u
wt=$1 group=$2 file=$3
now() { date +%s.%N; }
load() { cut -d' ' -f1-3 /proc/loadavg; }
el() { echo "$2 - $1" | bc; }
tree_pids() { # daemon pid and its descendants
  local root=$1; echo "$root"; for c in $(pgrep -P "$root"); do tree_pids "$c"; done; }
mem() { # rss and pss (kB) summed over the daemon tree
  local d; d=$(pgrep -f "squeal.* daemon $wt( |$)" | head -1)
  [ -z "$d" ] && { echo "mem_$1=no-daemon"; return; }
  local rss=0 pss=0 n=0
  for p in $(tree_pids "$d"); do
    [ -r /proc/$p/smaps_rollup ] || continue
    r=$(awk '/^Rss:/{print $2}' /proc/$p/smaps_rollup); s=$(awk '/^Pss:/{print $2}' /proc/$p/smaps_rollup)
    rss=$((rss+r)); pss=$((pss+s)); n=$((n+1))
    echo "  proc_$1 pid=$p rss_kb=$r pss_kb=$s cmd=$(tr '\0' ' ' </proc/$p/cmdline | cut -c1-110)"
  done
  echo "mem_$1 procs=$n rss_kb=$rss pss_kb=$pss threads=$(ls /proc/$d/task | wc -l)"; }
cd "$wt" || exit 1
echo "wt=$wt commit=$(git rev-parse --short HEAD) load_before=$(load)"
t0=$(now); squeal start "$wt" > /tmp/dc-start.$$ 2>&1; rc=$?; t1=$(now)
echo "start_rc=$rc start_s=$(el $t0 $t1)"; tail -3 /tmp/dc-start.$$ | sed 's/^/  /'
squeal status --wait 300000 > /tmp/dc-wait.$$ 2>&1; rc=$?; t2=$(now)
echo "settle_rc=$rc start_to_settled_s=$(el $t0 $t2)"; head -4 /tmp/dc-wait.$$ | sed 's/^/  /'; tail -1 /tmp/dc-wait.$$ | sed 's/^/  /'
sleep 30; mem idle30
t3=$(now); squeal run "$group" "$file" --wait > /tmp/dc-run.$$ 2>&1; rc=$?; t4=$(now)
echo "run_rc=$rc run_wait_s=$(el $t3 $t4) load=$(load)"; tail -2 /tmp/dc-run.$$ | sed 's/^/  /'
mem after_run
sleep 30; mem idle_after_run
du -sk "$wt" --exclude=node_modules --exclude=.git | sed 's/^/checkout_kb_excl_nm /'
t5=$(now); squeal stop "$wt" > /dev/null 2>&1; rc=$?; t6=$(now)
echo "stop_rc=$rc stop_s=$(el $t5 $t6)"
sleep 3; pgrep -f "squeal.* daemon $wt( |$)" >/dev/null && echo "daemon_alive_after_stop=yes" || echo "daemon_alive_after_stop=no"
rm -f /tmp/dc-*.$$
