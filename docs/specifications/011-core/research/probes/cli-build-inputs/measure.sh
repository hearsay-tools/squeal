#!/usr/bin/env bash
# Throwaway probe for 011-127: times one `squeal run --all --wait` in the scratch clone, with load beside it.
# usage: measure.sh <label>   (appends one line to $R/measure.log)
source "$(dirname "$0")/env.sh"
label=$1
start=$(date +%s.%N); l0=$(cut -d' ' -f1-3 /proc/loadavg)
( while sleep 10; do echo "$label $(date +%T) $(cut -d' ' -f1 /proc/loadavg)"; done ) >> $R/load-$label.txt & L=$!
sq run --all --wait > $R/run-$label.out 2>&1; code=$?
end=$(date +%s.%N); l1=$(cut -d' ' -f1-3 /proc/loadavg); kill $L
echo "$label exit=$code wall=$(echo "$end - $start" | bc)s start=$(date -d @${start%.*} +%T) load0=[$l0] load1=[$l1] maxload1m=$(awk '{print $3}' $R/load-$label.txt | sort -n | tail -1) head=\"$(head -1 $R/run-$label.out)\"" >> $R/measure.log
tail -1 $R/measure.log
