#!/bin/sh
# Throwaway (row 020-38). One step per call; outputs in $R/out. See README.md.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); . "$HERE/env.sh"
case "$1" in
  a1) gate "$R/A" A1 ;;            # clone A, no daemon ever: first gate run
  a2) gate "$R/A" A2 ;;            # same bytes: second gate run
  a3) gate "$R/A" A3 ;;            # same bytes: third gate run
  b-daemon)                         # clone B, unedited: a daemon runs the files A1 selected, then stops
    cd "$R/B" || exit 1
    files=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(r.runs.flatMap(x=>x.selected).join(" "))' "$R/out/A1.json")
    "$HERE/guard.sh" true 2> "$R/out/B0.err" || exit 99
    sq start >> "$R/out/B0.err" 2>&1
    s=$(date +%s%N)
    # shellcheck disable=SC2086
    sq run tests $files --wait 3000000 > "$R/out/B0.out" 2>> "$R/out/B0.err"; rc=$?
    echo "run exit $rc wall-ms $(( ($(date +%s%N) - s) / 1000000 )) load-1m-at-end $(cut -d' ' -f1 /proc/loadavg)" >> "$R/out/B0.err"
    sq stop >> "$R/out/B0.err" 2>&1; echo "stop exit $?" >> "$R/out/B0.err"
    tail -3 "$R/out/B0.err" ;;
  b-edit) edit "$R/B"; git -C "$R/B" diff --stat ;;
  b1) gate "$R/B" B1 ;;
  b2) gate "$R/B" B2 ;;
  *) echo "usage: steps.sh a1|a2|a3|b-daemon|b-edit|b1|b2" >&2; exit 2 ;;
esac
