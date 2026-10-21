#!/usr/bin/env bash
# 011-83 probe: one test file's process-tree CPU over repeated runs, in a
# clone under /tmp with HOME, XDG_* and TMPDIR under /tmp, at nice 10 as
# Squeal runs tests. `/usr/bin/time` counts Vitest's process and every
# descendant it waited for. One worker, single files only.
# Usage: file-cpu.sh <clone> <scratch> <runs> <file>... > log.tsv
set -u
clone=$1 scratch=$2 runs=$3
shift 3
printf 'file\trun\tload1_before\twall_s\tuser_s\tsys_s\texit\n'
for file in "$@"; do
  for run in $(seq 1 "$runs"); do
    load=$(cut -d' ' -f1 /proc/loadavg)
    out=$(cd "$clone" && env -i PATH="$PATH" HOME="$scratch/home" XDG_RUNTIME_DIR="$scratch/run" \
      XDG_CONFIG_HOME="$scratch/config" TMPDIR="$scratch/tmp" CI=1 \
      nice -n 10 /usr/bin/time -f 'TIME %e %U %S' \
      node node_modules/vitest/vitest.mjs run "$file" --maxWorkers=1 --reporter=dot 2>&1)
    code=$?
    t=$(printf '%s\n' "$out" | grep '^TIME ' | tail -1)
    read -r _ wall user sys <<<"$t"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$file" "$run" "$load" "$wall" "$user" "$sys" "$code"
  done
done
