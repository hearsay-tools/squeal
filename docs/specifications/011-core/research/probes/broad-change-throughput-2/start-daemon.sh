#!/bin/bash
# start-daemon.sh <unit> [node args...]: start this clone's Squeal daemon
# inside a systemd user scope named <unit>, so its cgroup counts the CPU of
# the daemon and every test process it starts. Without node args, through
# `squeal start` as 011-395 did. With node args (Q2: --cpu-prof ...), the
# daemon command itself (`squeal daemon <root>`, what `start` spawns), so the
# args reach the daemon and, through process.execArgv, its runner hosts.
# Prints the scope's cgroup dir and the daemon pid. The `cd` is its own
# command: `cd && node &` backgrounds a subshell that keeps the caller's
# $(...) pipe open until the daemon exits (first run, 2026-11-19).
unit=$1; shift
. "$(dirname "$0")/env.sh"
U="XDG_RUNTIME_DIR=/run/user/$(id -u)"
if [ $# -eq 0 ]; then
  env $U systemd-run --user --scope --unit="$unit" --quiet \
    env XDG_RUNTIME_DIR="$P/xdg" bash -c "node --disable-warning=ExperimentalWarning '$SQ_CLI' start >'$OUT/$unit.start.txt' 2>&1"
else
  env $U systemd-run --user --scope --unit="$unit" --quiet \
    env XDG_RUNTIME_DIR="$P/xdg" bash -c "cd '$SQ_REPO/.git/squeal'; setsid nohup node --disable-warning=ExperimentalWarning $* '$SQ_CLI' daemon '$SQ_REPO' >'$OUT/$unit.daemon.log' 2>&1 </dev/null & sleep 8"
fi
cg=/sys/fs/cgroup$(env $U systemctl --user show -p ControlGroup --value "$unit.scope")
echo "cgroup=$cg"
for p in $(cat "$cg/cgroup.procs"); do echo "pid=$p $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-600)"; done
