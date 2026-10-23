#!/bin/sh
# 011-143 probe. Usage: cgrun.sh <unit> <cpus|-> <cmd...>
# Runs cmd at nice 10 in its own systemd user scope (optionally pinned with taskset)
# and prints the scope's cpu.stat (every process of the scope, exited children included).
U=$1; C=$2; shift 2
L1=$(cut -d' ' -f1 /proc/loadavg); T0=$(date +%s.%N)
PIN=""; [ "$C" != "-" ] && PIN="taskset -c $C"
systemd-run --user --scope --quiet --unit "$U" $PIN nice -n 10 sh -c '"$@"; rc=$?; echo "EL143 rc=$rc $(tr "\n" " " < /sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/cpu.stat)"' sh "$@"
echo "EL143 unit=$U wall=$(echo "$(date +%s.%N) - $T0" | bc) load1_start=$L1 load1_end=$(cut -d' ' -f1 /proc/loadavg)"
