#!/usr/bin/env bash
# Throwaway probe (spec 028 research). Kit K8 analogue: starts Jest in its own
# process group with the streaming reporter, waits until the hanging test writes
# its marker, SIGTERMs the group, SIGKILLs after 2 s, then lists what the reporter
# wrote, leftover processes, and whether a rerun with the same cache works.
# Usage: run-kill.sh <installDir> <outDir> [jest args...]
set -u
here=$(cd "$(dirname "$0")" && pwd)
inst=$1 out=$2; shift 2
rm -rf "$inst/fx" "$out"; mkdir -p "$out"; cp -r "$here/fixture" "$inst/fx"; cd "$inst/fx"
export REPORT_OUT="$out/report.ndjson" HANG_MARK="$out/hang.mark"
setsid "$inst/node_modules/.bin/jest" --config jest.hang.config.js --cacheDirectory="$out/cache" \
  --reporters="$here/squeal-reporter.cjs" "$@" >"$out/stdout.txt" 2>&1 &
leader=$!
for _ in $(seq 1 300); do [ -e "$HANG_MARK" ] && break; sleep 0.1; done
echo "marker: $([ -e "$HANG_MARK" ] && echo seen || echo missing)"
echo "group before kill: $(pgrep -g "$leader" | wc -l) processes"
kill -TERM -- "-$leader" 2>/dev/null; sleep 2
left=$(pgrep -g "$leader" | wc -l); echo "group 2 s after SIGTERM: $left processes"
[ "$left" -gt 0 ] && kill -KILL -- "-$leader" 2>/dev/null
wait "$leader" 2>/dev/null; echo "leader exit: $?"
node "$here/show-report.cjs" "$REPORT_OUT" | grep -E '"e"|case' | sed 's/"snapshot".*"cases"/.. "cases"/'
rm -f "$HANG_MARK"
timeout 60 "$inst/node_modules/.bin/jest" --config jest.hang.config.js --cacheDirectory="$out/cache" --testPathIgnorePatterns c-hangs "$@" 2>&1 | grep -E '^Tests:'
