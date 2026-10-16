#!/bin/bash
# Throwaway: every `why`/`status` form against a disposable store while a
# normal WAL writer holds BEGIN IMMEDIATE for <hold-ms>. Usage: variants.sh <repo> <hold-ms> <cli.mjs>
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$1; hold=$2; cli=$3
db=$repo/.git/squeal/store.sqlite
ms() { date +%s%3N; }
fifo=$(mktemp -u); mkfifo "$fifo"
node --disable-warning=ExperimentalWarning "$here/hold.mjs" "$db" immediate "$hold" >"$fifo" &
holder=$!; exec 3<"$fifo"; read -r line <&3; rm "$fifo"; echo "$line"
for args in "why|auth > login" "why|login" "why|auth > login|--include-logs" "why|nothing-matches" "why|auth > login|--json" "status" "status|--json" "status|--notes" "failures"; do
  IFS='|' read -r -a argv <<<"$args"
  t0=$(ms); out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" "${argv[@]}" 2>&1); code=$?; t1=$(ms)
  printf '%-34s exit=%s %5s ms  %s\n' "${argv[*]}" "$code" "$((t1 - t0))" "$(head -1 <<<"$out" | cut -c1-90)"
done
cat <&3; exec 3<&-; wait "$holder"
