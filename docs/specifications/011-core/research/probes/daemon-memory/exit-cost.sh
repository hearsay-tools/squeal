#!/usr/bin/env bash
# Throwaway probe for research 011-53: what an exit when quiet costs the next edit.
# Usage: exit-cost.sh /tmp/dm-XXXXXX <reps>
# Each rep: stop the daemon, then as a hook would, start one. Mode "edit-first" (the first
# measurement) edits at once, before the daemon serves. Mode "after-baseline" waits until
# status lists the files with nothing running or queued, then edits. The times are from the
# start to the socket, to the baseline, and to `squeal status --wait` on the edited test file
# returning. The store keeps the keys and results of earlier runs.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" "$1"
FILE=packages/cezar/src/core/model-identity.test.ts
MODE=${3:-edit-first}
for i in $(seq 1 "${2:-3}"); do
  sq stop >/dev/null 2>&1
  while pgrep -f "squeal.mjs daemon $S/cezar" >/dev/null; do sleep 0.5; done
  sleep 5
  load=$(cut -d' ' -f1 /proc/loadavg)
  t0=$(date +%s%3N)
  start_daemon
  [ "$MODE" = edit-first ] && printf '\n// probe 011-53 exit-cost %s\n' "$i" >>"$S/cezar/$FILE"
  # The CLI needs the socket; it appears once the daemon serves.
  until [ -S "$(ls "$S"/run/squeal-*.sock 2>/dev/null | head -1)" ]; do sleep 0.1; done
  t_sock=$(date +%s%3N)
  t_base=$t_sock
  if [ "$MODE" = after-baseline ]; then
    while :; do
      line=$(sq status 2>/dev/null | sed -n 2p)
      case "$line" in *"not current"*) case "$line" in *running*|*queued*) ;; *) break ;; esac ;; esac
      sleep 0.5
    done
    t_base=$(date +%s%3N)
    printf '\n// probe 011-53 exit-cost %s %s\n' "$MODE" "$i" >>"$S/cezar/$FILE"
  fi
  sq status --wait 600000 "$FILE" >"$S/log/exit-cost-$i.txt" 2>&1
  t1=$(date +%s%3N)
  printf '%s rep %s\tload %s\tstart-to-socket %s ms\tstart-to-baseline %s ms\tedit-to-verdict %s ms\tstart-to-verdict %s ms\tpriv %s MiB\n' "$MODE" "$i" "$load" "$((t_sock - t0))" "$((t_base - t0))" "$((t1 - t_base))" "$((t1 - t0))" \
    "$(awk '/RssAnon|RssShmem/{s+=$2} END{print int(s/1024)}' /proc/"$(cat "$S/log/pid")"/status)"
done
