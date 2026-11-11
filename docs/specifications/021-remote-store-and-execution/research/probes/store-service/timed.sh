#!/usr/bin/env bash
# Throwaway (021-01). Runs one timing command only when the one-minute load is below the CPU count;
# prints the load before and after so the findings can report it.
cpus=$(nproc); l=$(cut -d' ' -f1 /proc/loadavg)
if awk -v l="$l" -v c="$cpus" 'BEGIN{exit !(l>=c)}'; then echo "SKIPPED: load $l >= $cpus: $*"; exit 3; fi
echo "load before $l ($cpus CPUs): $*"; "$@"; echo "load after $(cut -d' ' -f1 /proc/loadavg)"
