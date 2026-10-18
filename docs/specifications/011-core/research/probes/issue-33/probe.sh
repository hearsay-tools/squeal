#!/bin/bash
# usage: probe.sh <label> <file-to-rewrite-mid-run>
# Edits src/lib.ts (in all three closures) to start a run, rewrites $2 three seconds in, waits.
T=/tmp/issue33.suGY; cd $T/repo
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run
echo "== $1: load $(cut -d' ' -f1-3 /proc/loadavg) nproc $(nproc) squeal $(squeal --version)"
echo "export const one = 1 // $1 $(date +%s%N)" > src/lib.ts
sleep 3; squeal status 2>&1 | grep -E "^Revision|running" 
echo "// rebuilt $(date +%s%N)" >> "$2"; echo "rewrote $2 at $(date +%T.%N)"
sleep 2; squeal status --wait 90000 2>&1 | grep -vE "^\s*$" | head -30
