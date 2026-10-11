#!/usr/bin/env bash
# Runs one Vitest project of a cezar checkout as a process-group leader (as the Squeal
# daemon is: `squeal daemon` is spawned detached, and Vitest's forks share its group),
# under strace, logging every signal-sending syscall from it and every descendant.
# The caller's cwd and environment are kept, so run it from where the daemon was started.
# Usage: trace-vitest.sh <cezar checkout> <out dir> <vitest project> [extra vitest args...]
set -u
root=$1 out=$2 project=$3; shift 3
mkdir -p "$out"
echo "start $(date -u +%T.%N) cwd=$PWD" > "$out/times.txt"
strace -f --seccomp-bpf -qq -tt -e trace=kill,tkill,tgkill,pidfd_send_signal -e signal=none \
  -o "$out/strace.txt" setsid node "$root/node_modules/vitest/vitest.mjs" run --root "$root" \
  --project "$project" "$@" > "$out/vitest.out" 2>&1
echo "exit $? $(date -u +%T.%N)" >> "$out/times.txt"
