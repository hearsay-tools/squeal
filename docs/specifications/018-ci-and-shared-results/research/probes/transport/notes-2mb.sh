#!/usr/bin/env bash
# Throwaway (018-14). The brief's first step: a notes ref holding a 2 MB blob, written,
# pushed to a scratch bare repository and fetched by a second clone, timed; then the
# same for one parentless commit per main commit at refs/squeal/<sha>. Local disk only.
# The blob is random bytes (a gzipped export does not compress further).
# Refuses to time when the one-minute load average is above the CPU count.
# Usage: notes-2mb.sh <work dir under $TMPDIR> [repetitions=5]
set -euo pipefail
. "$(dirname "$0")/common.sh"
load=$(cut -d' ' -f1 /proc/loadavg); cpus=$(nproc)
awk -v l="$load" -v c="$cpus" 'BEGIN{exit !(l>c)}' && { echo "load $load > $cpus CPUs: no timing"; exit 2; }
echo "load $load, $cpus CPUs, $(git --version)"
fresh "$1"; W=$PWD; R=${2:-5}
for i in $(seq "$R"); do
  head -c 2000000 /dev/urandom > blob.bin
  (cd ci && echo "r$i" > f.txt && git commit -qam "r$i"); c=$(git -C ci rev-parse HEAD)
  # -F treats the file as message text (whitespace cleanup, a trailing newline);
  # -C stores an existing blob as it is. Both shown: -F on a scratch copy first.
  git -C ci notes --ref=squeal-F add -F "$W/blob.bin" "$c"
  git -C ci notes --ref=squeal-F show "$c" | cmp -s - blob.bin && okF=same || okF=changed
  t0=$(ms); git -C ci notes --ref=squeal add -C "$(git -C ci hash-object -w "$W/blob.bin")" "$c"
  t1=$(ms); git -C ci push -q origin main refs/notes/squeal
  t2=$(ms); rm -rf dev; git init -q dev; git -C dev fetch -q --no-write-fetch-head ../origin.git +refs/notes/squeal:refs/notes/squeal
  t3=$(ms); git -C dev notes --ref=squeal show "$c" | cmp -s - blob.bin && ok=same || ok=DIFF
  t4=$(ms)
  b=$(git -C ci hash-object -w "$W/blob.bin"); k=$(printf '100644 blob %s\texport.json.gz\n' "$b" | git -C ci mktree | xargs -I{} git -C ci commit-tree {} -m "results for $c")
  t5=$(ms); git -C ci push -q origin "$k:refs/squeal/$c"
  t6=$(ms); rm -rf dev2; git init -q dev2; git -C dev2 fetch -q --no-write-fetch-head ../origin.git "refs/squeal/$c:refs/squeal/$c"
  t7=$(ms); git -C dev2 cat-file blob "refs/squeal/$c:export.json.gz" | cmp -s - blob.bin && ok2=same || ok2=DIFF
  echo "run $i notes: add $((t1-t0)) ms, push $((t2-t1)) ms, fetch (new reader, $i notes) $((t3-t2)) ms, read $((t4-t3)) ms [-C $ok, -F $okF]; per-commit ref: push $((t6-t5)) ms, fetch one $((t7-t6)) ms [$ok2]"
done
