#!/bin/sh
# Throwaway (row 020-56): every step in turn; each gate run waits for its own quiet-load window.
HERE=$(cd "$(dirname "$0")" && pwd)
for s in ${STEPS:-setup cold warm breaks sleep-full sleep-tight sleep-breaks sleep-top sleep-fit late-full late-breaks late-breaks-full}; do
  echo "$(date -u +%FT%TZ) start $s"; "$HERE/steps.sh" $s; echo "$(date -u +%FT%TZ) end $s"
done
