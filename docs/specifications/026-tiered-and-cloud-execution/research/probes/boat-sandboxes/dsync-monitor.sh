#!/bin/sh
# Throwaway (026 boat-sandboxes). Started detached on the sandbox:
#   boat ssh <id> -- 'setsid nohup sh ~/dsync-monitor.sh > /dev/null 2>&1 < /dev/null &'
# Every 30 s for 40 minutes: 50 4 KiB dsync writes in the home, the io pressure, and
# whether ascii-lazyfs runs. One line per sample in ~/dsync-monitor.log.
i=0
while [ $i -lt 80 ]; do
  r=$(dd if=/dev/zero of="$HOME/.dsync-mon" bs=4k count=50 oflag=dsync 2>&1 | tail -1 | sed 's/.* copied, //')
  rm -f "$HOME/.dsync-mon"
  lz=$(pgrep -c ascii-lazyfs)
  echo "$(date -u +%T) dsync50 $r; io $(head -1 /proc/pressure/io | cut -d' ' -f2-3); lazyfs $lz; load $(cut -d' ' -f1 /proc/loadavg)" >> "$HOME/dsync-monitor.log"
  i=$((i + 1))
  sleep 30
done
