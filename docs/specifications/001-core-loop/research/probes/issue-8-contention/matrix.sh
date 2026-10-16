#!/bin/bash
# Throwaway: times `why` and `status` against a disposable store under each
# lock mode, for each CLI bundle given. Usage: matrix.sh <repo> <hold-ms> <name=cli.mjs>...
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$1; hold=$2; shift 2
db=$repo/.git/squeal/store.sqlite
ms() { date +%s%3N; }
query() { # cli, label, args...
  local cli=$1 label=$2; shift 2
  local t0 out code t1
  t0=$(ms)
  out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" "$@" 2>&1); code=$?
  t1=$(ms)
  printf '%-10s %-10s %-22s exit=%s %5s ms  %s\n' "$name" "$mode" "$label" "$code" "$((t1 - t0))" "$(head -1 <<<"$out")"
}
for pair in "$@"; do
  name=${pair%%=*}; cli=${pair#*=}
  for mode in none immediate exclusive lockmode; do
    for cmd in why status; do
      holder=""
      if [ "$mode" != none ]; then
        fifo=$(mktemp -u); mkfifo "$fifo"
        node --disable-warning=ExperimentalWarning "$here/hold.mjs" "$db" "$mode" "$hold" >"$fifo" &
        holder=$!
        exec 3<"$fifo"; read -r line <&3; rm "$fifo"
      fi
      if [ "$cmd" = why ]; then query "$cli" "why (held)" why 'auth > login'
      else query "$cli" "status --json (held)" status --json; fi
      if [ -n "$holder" ]; then
        cat <&3 >/dev/null; exec 3<&-; wait "$holder"
        if [ "$cmd" = why ]; then query "$cli" "why (after release)" why 'auth > login'
        else query "$cli" "status --json (after)" status --json; fi
      fi
    done
  done
done
