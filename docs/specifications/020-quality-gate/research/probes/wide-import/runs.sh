#!/bin/sh
# Throwaway (row 020-17): the live probes, each behind guard.sh (load <= 24).
# Outputs go to $OUT (default /tmp/wide-import/out). HOME and TMPDIR are scratch.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TSX="$HERE/../../../../../../node_modules/.bin/tsx"
OUT=${OUT:-/tmp/wide-import/out}; mkdir -p "$OUT" /tmp/wide-import/home /tmp/wide-import/tmp
probe() { # name root base order timeout
  rm -f "$2/order.log"
  HOME=/tmp/wide-import/home TMPDIR=/tmp/wide-import/tmp ORDER=$4 TIMEOUT=$5 \
    "$HERE/guard.sh" timeout 1200 "$TSX" "$HERE/probe.ts" "$2" "$3" > "$OUT/$1.json" 2> "$OUT/$1.err"
  echo "$1 exit $? $(cut -c1-300 "$OUT/$1.json")"
}
# 1. synthetic, 600 files, whole run.
[ -d /tmp/wide-import/f600 ] || node "$HERE/fixture.mjs" /tmp/wide-import/f600 600 > /dev/null
probe f600-full /tmp/wide-import/f600 HEAD~1 path 1200
# 2. ordering under a budget of about half that run (pre-run time plus half the run).
R=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const pre=r.events.find(e=>e.e==="vitest.run:start").t;console.log(Math.max(5,Math.round((pre+r.runDurationMs/2)/1000)))}catch{console.log(20)}' "$OUT/f600-full.json")
echo "half budget $R s"
probe f600-half-path /tmp/wide-import/f600 HEAD~1 path "$R"
probe f600-half-loaders /tmp/wide-import/f600 HEAD~1 loaders "$R"
# 3. cezar at 7e0883a43, base its parent: the phases before the run (budget 1 s: no file runs).
probe cezar-prerun /tmp/wide-import/cezar 1b5939ba0 path 1
# 4. NOT RUN, needs the coordinator's approval: the 1,800-file whole run is a
# long gate run that the brief rules out. Command for a later, approved run:
#   node "$HERE/fixture.mjs" /tmp/wide-import/f1800 1800 > /dev/null
#   probe f1800-full /tmp/wide-import/f1800 HEAD~1 path 1200
