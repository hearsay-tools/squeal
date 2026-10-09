#!/usr/bin/env bash
# Throwaway: one `codex exec --json` subject session in /tmp/r52/runs/<label>,
# scratch CODEX_HOME with the pinned plugin installed and trusted.
#   run-codex.sh <label> <prompt-file> [noplugin] [resume <thread> [-c k=v ...]]
source "$(dirname "$0")/env.sh"
export CODEX_HOME=$R/codex HOME=$R/home
L=$1; PR=$(readlink -f "$2"); NP=${3:-}; shift 3 2>/dev/null || shift $#
D=$R/runs/$L; O=$R/logs/$L; mkdir -p $R/logs
cd "$D"; T0=$(date +%s%3N); echo $T0 > $O.t0
# Plugin absent: a second scratch CODEX_HOME with the provider block only (a
# `-c plugins."squeal@hearsay".enabled=false` override left the hooks running).
OFF=(); [ "$NP" = noplugin ] && export CODEX_HOME=$R/codex-np
SUB=(); [ "${1:-}" = resume ] && { SUB=(resume "$2"); shift 2; }
timeout 1200 codex exec --json -s danger-full-access "${OFF[@]}" "$@" "${SUB[@]}" "$(cat "$PR")" < /dev/null 2> $O.stderr.txt \
  | node "$PROBES/bin/ts.mjs" $T0 > $O.events.jsonl
date +%s%3N > $O.t1
