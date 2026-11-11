#!/usr/bin/env bash
# Throwaway (row 021-02): per day, this host's busy vCPUs and its %nice share (Squeal's runs are nice 10),
# from the sysstat 10-minute samples. Reads /var/log/sysstat only. Columns of `sadf -d -U -- -u`:
# hostname;interval;timestamp;CPU;%user;%nice;%system;%iowait;%steal;%idle
for f in $(ls -1t /var/log/sysstat/sa[0-9][0-9] | tac); do
  first=$(sadf -d -U "$f" -- -u 2>/dev/null | awk -F';' '$4=="-1"{print $3; exit}')
  [ -n "$first" ] || continue
  day=$(TZ=Europe/Warsaw date -d "@$first" +%F)  # sysstat files are local days
  sadf -d -U "$f" -- -u 2>/dev/null | awk -F';' -v d="$day" '
    $4=="-1" { n++; busy=24*(100-$10)/100; nice=24*$6/100; b+=busy; ni+=nice; if(busy>16)k++; if(busy>=22.8)s++ }
    END { if(n) printf "%s samples %3d  busy mean %5.2f  nice mean %5.2f (%4.1f%% of busy)  >16 busy %5.1f%%  >=95%% busy %5.1f%%\n", d, n, b/n, ni/n, 100*ni/b, 100*k/n, 100*s/n }'
done
