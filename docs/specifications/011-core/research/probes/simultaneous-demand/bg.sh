#!/bin/bash
# bg.sh <name> <timeout s> <command...>: run a command detached from ssh, with
# a timeout, stdout and stderr to $OUT/<name>.log, its pid in $OUT/<name>.pid.
. "$(dirname "$0")/env.sh"
name=$1; t=$2; shift 2
setsid nohup timeout "$t" "$@" >"$OUT/$name.log" 2>&1 < /dev/null &
echo $! > "$OUT/$name.pid"; echo "started $name pid $!"
