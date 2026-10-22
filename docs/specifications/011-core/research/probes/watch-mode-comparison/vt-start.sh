#!/bin/bash
# vt-start.sh <dir> <log> <file>...: `vitest --watch` at 4 workers on the scenario's candidate files,
# with the stamp reporter, in the scratch environment, detached; its pid goes to <log>.pid.
source "$(dirname "$0")/env.sh"; cd "$1"; log=$2; shift 2
: > $log; export WM_LOG=$log
setsid nohup npx vitest --watch --maxWorkers=4 --reporter=default --reporter=/tmp/wm119/stamp-reporter.mjs "$@" > $log.out 2>&1 < /dev/null &
echo $! > $log.pid
