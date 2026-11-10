#!/bin/sh
# Q1 probe: Squeal's node:test recorder and reporter delivered through NODE_OPTIONS under a
# project's own build wrapper (`npm run test:package -- <file>`). Throwaway. Usage:
#   sh wrapper-inject.sh <squeal-worktree>      (refuses while the one-minute load is above 24)
set -eu
SQ=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
LOAD=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$LOAD > 24" | bc)" = 1 ]; then echo "load $LOAD > 24: skipped"; exit 0; fi
echo "load at start: $LOAD; node $(node --version); npm $(npm --version)"
W=$(mktemp -d /tmp/r174-wrap-XXXXXX)
export HOME="$W/home" TMPDIR="$W/tmp"; mkdir -p "$HOME" "$TMPDIR"
REC="$SQ/src/runners/node-test/runtime/recorder.cjs"
REP="$SQ/src/runners/node-test/runtime/reporter.mjs"
run_mode() { # name, then env assignments for the command
  name=$1; shift
  rm -rf "$W/fx"; cp -r "$HERE/fixture" "$W/fx"; mkdir -p "$W/$name"
  ( cd "$W/fx" && env "$@" PROBE_WHO="$W/$name/who.ndjson" npm run --silent test:package -- test/e2e/bin.test.mjs \
      >"$W/$name/stdout.txt" 2>"$W/$name/stderr.txt"; echo "exit $?" >"$W/$name/exit.txt" ) || true
  echo "== $name: $(cat "$W/$name/exit.txt")"
  echo "-- stdout (first 6 lines)"; head -6 "$W/$name/stdout.txt"
  echo "-- processes (pid ppid testContext v8cov-set argv)"
  node -e '
    const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    for (const r of rows) console.log(r.pid, r.ppid, r.testContext ?? "-", r.v8cov ? "cov" : "-", [...r.execArgv.filter(a=>!a.includes("whoami")), ...r.argv].join(" ").replace(/\/tmp\/r174-wrap-\w+/g, "$W").slice(0, 110));
  ' "$W/$name/who.ndjson"
  if [ -d "$W/$name/cov" ]; then
    echo "-- coverage dir"; (cd "$W/$name/cov" && for f in *; do [ -f "$f" ] && echo "$f $(wc -c <"$f")"; done; ls -d children 2>/dev/null || true)
  fi
  if [ -f "$W/$name/events.ndjson" ]; then
    echo "-- events: $(wc -l <"$W/$name/events.ndjson") lines; types: $(node -e '
      const t={}; for (const l of require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n")) { const e=JSON.parse(l); t[e.type]=(t[e.type]||0)+1 } console.log(JSON.stringify(t))' "$W/$name/events.ndjson")"
  fi
}
WHO="--require $HERE/whoami.cjs"
run_mode plain NODE_OPTIONS="$WHO"
run_mode inject NODE_OPTIONS="$WHO --require $REC --test-reporter=$REP --test-reporter-destination=$W/inject/events.ndjson" \
  NODE_V8_COVERAGE="$W/inject/cov" SQUEAL_NODE_TEST_COVERAGE="$W/inject/cov"
run_mode inject-own-reporter WRAP_REPORTER=spec NODE_OPTIONS="$WHO --require $REC --test-reporter=$REP --test-reporter-destination=$W/inject-own-reporter/events.ndjson" \
  NODE_V8_COVERAGE="$W/inject-own-reporter/cov" SQUEAL_NODE_TEST_COVERAGE="$W/inject-own-reporter/cov"
run_mode inject-build FORCE_BUILD=1 NODE_OPTIONS="$WHO --require $REC --test-reporter=$REP --test-reporter-destination=$W/inject-build/events.ndjson" \
  NODE_V8_COVERAGE="$W/inject-build/cov" SQUEAL_NODE_TEST_COVERAGE="$W/inject-build/cov"
echo "load at end: $(cut -d' ' -f1 /proc/loadavg)"
echo "kept in $W"
