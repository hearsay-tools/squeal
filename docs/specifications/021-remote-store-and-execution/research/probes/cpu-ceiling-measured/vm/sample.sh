#!/bin/bash
# sample.sh <out.tsv> <seconds> <cgroup dir> <daemon pid>: every 2 s one line:
# epoch ms, one-minute load, busy cores over the interval (/proc/stat), CPU-s
# of the probe's cgroup scope (the daemon, its Vitest processes and their
# children, exited ones included) and the daemon process's own CPU-s.
# Reads only /proc and /sys. Ends after <seconds> or when the daemon exits.
out=$1; secs=$2; cg=$3; dpid=$4; hz=$(getconf CLK_TCK)
read_stat() { awk '/^cpu /{print $2+$3+$4+$7+$8+$9, $2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat; }
echo -e "t_ms\tload1\tbusy_cores\tscope_cpu_s\tdaemon_cpu_s" > "$out"
read b0 t0 < <(read_stat); end=$(( $(date +%s) + secs ))
while [ "$(date +%s)" -lt "$end" ] && [ -d /proc/$dpid ]; do
  sleep 2
  read b1 t1 < <(read_stat)
  busy=$(awk -v b=$((b1-b0)) -v t=$((t1-t0)) -v n=$(nproc) 'BEGIN{printf "%.2f", (t>0 ? b/t*n : 0)}')
  b0=$b1; t0=$t1
  scope=$(awk '/^usage_usec/{printf "%.1f", $2/1e6}' "$cg/cpu.stat")
  dmn=$(awk -v h=$hz '{printf "%.1f", ($14+$15)/h}' /proc/$dpid/stat 2>/dev/null)
  printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%s%3N)" "$(cut -d' ' -f1 /proc/loadavg)" "$busy" "$scope" "$dmn" >> "$out"
done
