#!/bin/sh
# Throwaway probe for research/issue-42.md. Not product code; delete freely.
# Usage: probe.sh <worktree> <cli.mjs> <test-file> <test-file>
# Runs the shipped CLI's status command in <worktree>: snapshot reads only.
# `--wait 1 <path>` may send one promote request to a live daemon (011 C15);
# with no daemon it only reads. Neither form spawns a daemon.
set -u
wt=$1 cli=$2 a=$3 b=$4
run() {
  echo "### \$ squeal $*"
  (cd "$wt" && node --disable-warning=ExperimentalWarning "$cli" "$@") >"$tmp/out" 2>"$tmp/err"
  code=$?
  echo "exit: $code; stdout lines: $(wc -l <"$tmp/out"); stderr lines: $(wc -l <"$tmp/err")"
  echo "--- stderr"; cat "$tmp/err"
  echo "--- stdout"; cat "$tmp/out"
  echo
}
tmp=$(mktemp -d)
echo "load: $(cut -d' ' -f1-3 /proc/loadavg); cpus: $(nproc); version: $(node "$cli" --version 2>&1)"
echo
run status "$a"
run status "$a" "$b"
run status --json "$a"
run status --wait 1 "$a"
run status --wait 1 "$a" "$b"
run status --json --wait 1 "$a"
rm -rf "$tmp"
