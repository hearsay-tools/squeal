#!/bin/bash
# Throwaway: a writer SIGKILLed with a large WAL and no other connection, then
# <k> `why` calls opened at once: the first runs WAL recovery under an exclusive
# lock, the rest wait on it. Usage: crash.sh <repo> <mb> <k> <cli.mjs>
set -u
here=$(cd "$(dirname "$0")" && pwd)
repo=$1; mb=$2; k=$3; cli=$4
db=$repo/.git/squeal/store.sqlite
ms() { date +%s%3N; }
node --disable-warning=ExperimentalWarning "$here/lastclose.mjs" "$db" "$mb" 0 crash
echo "after kill: wal $(stat -c %s "$db-wal") bytes, shm $(stat -c %s "$db-shm") bytes"
for i in $(seq 1 "$k"); do
  ( t0=$(ms); out=$(cd "$repo" && HOME=/tmp/i8/home node --disable-warning=ExperimentalWarning "$cli" why 'auth > login' 2>&1); code=$?; t1=$(ms)
    printf 'why #%02d exit=%s %5s ms  %s\n' "$i" "$code" "$((t1 - t0))" "$(head -1 <<<"$out")" ) &
done
wait
