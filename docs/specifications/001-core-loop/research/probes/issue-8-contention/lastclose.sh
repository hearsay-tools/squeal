#!/bin/bash
# Throwaway: runs `why` every 150 ms around the last-connection close of a
# large WAL. Usage: lastclose.sh <repo> <mb> <cli.mjs>
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$1; mb=$2; cli=$3
db=$repo/.git/squeal/store.sqlite
ms() { date +%s%3N; }
fifo=$(mktemp -u); mkfifo "$fifo"
node --disable-warning=ExperimentalWarning "$here/lastclose.mjs" "$db" "$mb" 1500 >"$fifo" &
closer=$!; exec 3<"$fifo"; read -r line <&3; rm "$fifo"; echo "$line; wal $(stat -c %s "$db-wal") bytes"
for i in $(seq 1 16); do
  ( t0=$(ms); out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" why 'auth > login' 2>&1); code=$?; t1=$(ms)
    printf 'why #%02d start=%s exit=%s %5s ms  %s\n' "$i" "$(date -d @${t0:0:10}.${t0:10} +%T.%3N)" "$code" "$((t1 - t0))" "$(head -1 <<<"$out")" ) &
  sleep 0.15
done
cat <&3; exec 3<&-; wait
