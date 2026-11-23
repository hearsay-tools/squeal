#!/bin/sh
# Throwaway (026 boat-sandboxes). Runs on the sandbox, fed on ssh's input:
#   boat ssh <id> -- sh -s <label> < dsync.sh
# 021's D5 measure: 4 KiB writes with oflag=dsync, 200 of them, in /tmp and in the home.
# Also prints I/O pressure and whether an ascii-lazyfs process exists.
L=${1:-run}
for d in /tmp "$HOME"; do
  f=$d/.dsync-probe
  r=$(dd if=/dev/zero of="$f" bs=4k count=200 oflag=dsync 2>&1 | tail -1)
  rm -f "$f"
  echo "$L $d: $r"
done
echo "$L io-pressure: $(head -1 /proc/pressure/io)"
echo "$L lazyfs: $(ps -eo pid,comm,args | grep -i [l]azyfs | head -3 | tr -s ' ' | tr '\n' ';')"
echo "$L load: $(cat /proc/loadavg)"
# Cache flushes of the virtual disk so far: count and total ms (/proc/diskstats fields 19, 20).
echo "$L flushes: $(awk '$3=="vda"{print $19" flushes, "$20" ms, "($19?int($20/$19*10)/10:0)" ms each"}' /proc/diskstats)"
echo "$L cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2)"
