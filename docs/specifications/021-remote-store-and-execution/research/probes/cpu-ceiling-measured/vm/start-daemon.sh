#!/bin/bash
# start-daemon.sh <unit>: start this clone's Squeal daemon inside a systemd user
# scope named <unit>, so its cgroup counts the CPU of the daemon and every test
# process it starts. Prints the scope's cgroup dir and the daemon pid.
unit=$1
. "$(dirname "$0")/env.sh"
XDG_RUNTIME_DIR=/run/user/$(id -u) systemd-run --user --scope --unit="$unit" --quiet \
  env XDG_RUNTIME_DIR="$P/xdg" bash -c "node --disable-warning=ExperimentalWarning '$SQ_CLI' start >'$OUT/$unit.start.txt' 2>&1"
cg=/sys/fs/cgroup$(XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user show -p ControlGroup --value "$unit.scope")
echo "cgroup=$cg"
for p in $(cat "$cg/cgroup.procs"); do echo "pid=$p $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-160)"; done
