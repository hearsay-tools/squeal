#!/bin/bash
# usage: touch-twice.sh <probe-dir> <path>: as touch-probe.sh, touching <path> in the first run and in its re-run.
P=$1; cd "$P/repo" || exit 1
export HOME=$P/home XDG_RUNTIME_DIR=$P/home/.run XDG_CONFIG_HOME=$P/home/.config XDG_CACHE_HOME=$P/home/.cache
SQ="node --disable-warning=ExperimentalWarning ${SQUEAL_CLI:?set SQUEAL_CLI}"
echo "== load $(cut -d' ' -f1-3 /proc/loadavg)"
echo "export const one = 1 // twice $(date +%s%N)" > src/lib.ts
sleep 3; touch "$2"; echo "touch 1 $(date +%T)"
sleep 10; $SQ status 2>&1 | grep -E "running"; touch "$2"; echo "touch 2 $(date +%T)"
sleep 2; $SQ status --wait 120000 2>&1 | grep -vE "^\s*$" | head -20
