#!/usr/bin/env bash
# Throwaway probe for research 011-53, questions 1 to 3, in a daemon of this research's own.
# Usage: run-daemon.sh /tmp/dm-XXXXXX <quiet-minutes>
# Starts the daemon on the clone with the inside probe and the outside sampler (5 s), then:
#   baseline (lookup-only: list and key every file, run none)
#   T1  edit a server test file          -> its tier; then one forced GC (after a tier)
#   T2  edit a web (jsdom) test file     -> its tier
#   T3  edit a contract test file        -> its tier
#   quiet for <quiet-minutes>, marks at 1, 5, 15 and 30 minutes; then one forced GC (quiet)
#   warm: 3 edits of the T1 file on the warm instance
#   cold: 3 times, touch a source file the instance read (same bytes: the adapter replaces the
#         instance at its next call, task 013-02), then edit the T1 file, so its tier runs on a
#         new instance
# Each edit's time is from the write to `squeal status --wait` returning (edits.tsv).
# Leaves the daemon running; the caller stops it with `sq stop`.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" "$1"
QUIET=${2:-30}
T1=packages/cezar/src/core/model-identity.test.ts
T2=packages/web/src/lib/unified-diff.test.ts
T3=packages/contract/src/attention.test.ts
TOUCH=packages/cezar/src/core/model-identity.ts
note() { echo "$(date -u +%H:%M:%SZ) load $(cut -d' ' -f1 /proc/loadavg) $*" | tee -a "$S/log/steps.txt"; }

start_daemon; sleep 1; PID=$(cat "$S/log/pid")
note "daemon $PID started"
setsid python3 -I "$HERE/outside.py" "$PID" 5 "$S/log/outside.tsv" </dev/null >/dev/null 2>&1 &
# The baseline is over once status lists the files and nothing runs or waits.
for _ in $(seq 1 120); do
  sleep 5
  line=$(sq status 2>/dev/null | sed -n 2p)
  case "$line" in *"not current"*) case "$line" in *running*|*queued*) ;; *) break ;; esac ;; esac
done
note "baseline: $line"
ctl mark-baseline
sleep 30
edit_and_wait "$T1" T1; note "T1 $(tail -1 "$S/log/edits.tsv" | cut -f4) ms"
sleep 10; ctl gc; note "gc after T1"; sleep 10
edit_and_wait "$T2" T2; note "T2 $(tail -1 "$S/log/edits.tsv" | cut -f4) ms"
sleep 10
edit_and_wait "$T3" T3; note "T3 $(tail -1 "$S/log/edits.tsv" | cut -f4) ms"
start=$(date +%s)
for m in 1 5 15 30; do
  [ "$m" -gt "$QUIET" ] && break
  while [ $(( $(date +%s) - start )) -lt $(( m * 60 )) ]; do sleep 5; done
  ctl "mark-quiet-${m}m"; note "quiet ${m} min"
done
ctl gc; note "gc when quiet"; sleep 10
for i in 1 2 3; do
  edit_and_wait "$T1" "warm-$i"; note "warm-$i $(tail -1 "$S/log/edits.tsv" | cut -f4) ms"; sleep 20
done
for i in 1 2 3; do
  touch "$S/cezar/$TOUCH"; sleep 8; ctl "mark-touched-$i"
  edit_and_wait "$T1" "cold-$i"; note "cold-$i $(tail -1 "$S/log/edits.tsv" | cut -f4) ms"; sleep 20
done
note "done"
