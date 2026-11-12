#!/usr/bin/env bash
# Throwaway probe for research 021-27, question 2. Run with the scratch and repo name:
#   run-edits.sh <scratch> <repo> <edits> <test file>...
# Edits the named test files in turn (a comment appended), waits for each verdict, then marks
# the daemon's and the Vitest host's inside logs and runs one full GC in each, so each edit
# gives both the private memory as it stands and the live heap. Policy is not changed.
set -u
S=$1 R=$2 EDITS=$3; shift 3
FILES=("$@")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/env.sh" "$S" "$R"
ctl host-vitest mark-e0; ctl host-vitest gc; ctl daemon mark-e0; ctl daemon gc
for i in $(seq 1 "$EDITS"); do
  f=${FILES[$(( (i - 1) % ${#FILES[@]} ))]}
  edit_and_wait "$f" "e$i"
  ctl host-vitest "mark-e$i"; ctl host-vitest gc
  ctl daemon "mark-e$i"; ctl daemon gc
  sleep 2
done
