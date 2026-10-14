#!/bin/sh
# Throwaway. Prints this probe's logs for one label (no secrets are written to them).
. "$(dirname "$0")/env.sh"
grep "\"label\":\"$1\"" $PROBE_LOG
for f in $W/log/$1*; do echo "== $f"; head -c 4000 "$f"; echo; done
