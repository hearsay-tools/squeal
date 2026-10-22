#!/bin/sh
# One day's CPU figures from sar's 10-minute samples, as JSON.
# Usage: sh sar-day.sh DD   (day of month; reads /var/log/sysstat/saDD, kept 7 days)
# Squeal starts its test processes at nice 10, so %nice measures Squeal-run tests.
f=/var/log/sysstat/sa$1
LC_ALL=C sar -u -f "$f" | awk -v day="$1" '
  $2 == "all" && $1 ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/ {
    n++; nice += $4; sys += $5; idle += $NF
    if ($4 > mx) mx = $4
    if ($NF < 10) { sat++; satNice += $4; satBusy += 100 - $NF }
  }
  END {
    if (!n) { printf "{\"day\":\"%s\",\"samples\":0}\n", day; exit }
    printf "{\"day\":\"%s\",\"samples\":%d,\"meanNice\":%.1f,\"maxNice\":%.1f,\"meanSystem\":%.1f,\"meanIdle\":%.1f,", day, n, nice/n, mx, sys/n, idle/n
    printf "\"saturatedShare\":%.1f,\"saturatedSamples\":%d,\"niceShareOfBusyWhenSaturated\":%s}\n", 100*sat/n, sat, sat ? sprintf("%.1f", 100*satNice/satBusy) : "null"
  }'
