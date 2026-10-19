#!/bin/bash
# usage: touch-probe.sh <probe-dir> <label> <path> <touch|rewrite-same>
# Edits src/lib.ts (in all three closures) to start a run, then 3 s in rewrites <path> with
# the bytes it already holds, and waits. HOME stays inside <probe-dir>.
P=$1; cd "$P/repo" || exit 1
export HOME=$P/home XDG_RUNTIME_DIR=$P/home/.run XDG_CONFIG_HOME=$P/home/.config XDG_CACHE_HOME=$P/home/.cache
SQ="node --disable-warning=ExperimentalWarning ${SQUEAL_CLI:?set SQUEAL_CLI}"
echo "== $2: load $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc) squeal $($SQ --version)"
echo "export const one = 1 // $2 $(date +%s%N)" > src/lib.ts
sleep 3; $SQ status 2>&1 | grep -E "^Revision|running"
before=$(sha256sum "$3"); stat -c 'before %i %y %s' "$3"
case $4 in
  touch) touch "$3" ;;
  rewrite-same) c=$(cat "$3"); printf '%s\n' "$c" > "$3" ;;
esac
stat -c 'after  %i %y %s' "$3"; [ "$before" = "$(sha256sum "$3")" ] && echo "same bytes"
sleep 2; $SQ status --wait 120000 2>&1 | grep -vE "^\s*$" | head -30
