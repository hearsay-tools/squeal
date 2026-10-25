#!/usr/bin/env bash
# Throwaway (016-19). Waits until the one-minute load is below the CPU count, then runs
# run.sh with the same arguments (run.sh checks the load once more).
until awk -v l="$(cut -d' ' -f1 /proc/loadavg)" -v c="$(nproc)" 'BEGIN{exit !(l<c)}'; do sleep 30; done
exec "$(dirname "$0")/run.sh" "$@"
