#!/bin/sh
# Waits until the host's 1-minute load is below 24 (its CPU count) and nothing runs as
# squeal-e2e outside dogfood-008 (another coordinator's evals), then prints the load.
while :; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  others=$(ps -u squeal-e2e -o args= | grep -v -e dogfood-008 -e '^tmux' -e '^sudo' | grep -c . || true)
  if [ "${load%.*}" -lt 24 ] && [ "$others" -eq 0 ]; then
    echo "gate open: load $load at $(date +%T)"
    exit 0
  fi
  echo "waiting: load $load, other squeal-e2e processes $others at $(date +%T)"
  sleep 30
done
