#!/bin/sh
# Session 6, the controlled pair for the idle wake after /reload (gpt-6-luna, TUI): one fresh
# Pi process; experiment A before any /reload, experiment B after one. Each makes a novel edit
# to src/purry.ts that re-keys about 125 test files and breaks about 40 lazy tests, most of
# which land after the run settles; a wake is a run nobody prompted carrying them.
# Run from the agent user, after gate.sh.
set -u
here=$(cd "$(dirname "$0")" && pwd)
D=/home/squeal-e2e/dogfood-009
U="sudo -n -u squeal-e2e -H sh $D/scripts/as-user.sh"
T="$U sh $D/scripts/tui.sh"
L=$D/logs/s6-pair.screens.txt
stamp() { echo "$1 $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"; }
$U -C $D/home/remeda sh -c 'squeal start >/dev/null 2>&1; sleep 3; squeal status --wait 120000 | sed -n 1,4p'
sh "$here/proxy-start.sh" s6-pair
$T start cliproxy/gpt-6-luna $D/home/remeda
sleep 15
stamp "A sent"
$T send "Experiment A: in src/purry.ts pass undefined instead of lazy to lazyDataLastImpl, and add the comment // experiment A on the line above. Only edit that file and reply with the single word ok."
sleep 90
$T shot $L
$U -C $D/home/remeda squeal status | sed -n 1,3p
stamp "restore A"
$T send "Put src/purry.ts back exactly as it was originally. Only edit that file and reply with the single word ok."
sleep 45
$U -C $D/home/remeda squeal status --wait 120000 | sed -n 1,3p
stamp "reload"
$T send "/reload"
sleep 15
stamp "B sent"
$T send "Experiment B: in src/purry.ts pass undefined instead of lazy to lazyDataLastImpl, and add the comment // experiment B on the line above. Only edit that file and reply with the single word ok."
sleep 90
$T shot $L
$U -C $D/home/remeda squeal status | sed -n 1,3p
ps -u squeal-e2e -o pid,ppid,stat,args | cut -c1-170
pid=$(ps -u squeal-e2e -o pid=,args= | awk '$2=="pi" {print $1}' | head -1)
sudo -n -u squeal-e2e sh -c "ls -l /proc/$pid/fd | grep waiter-"
stamp "quit"
$T key C-d
sleep 8
sh "$here/proxy-stop.sh"
$U -C $D/home/remeda sh -c 'git checkout -q -- . && git clean -qfd packages'
ps -u squeal-e2e -o pid,args | cut -c1-150
stamp "done"
