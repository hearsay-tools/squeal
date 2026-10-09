#!/bin/sh
# Starts the scratch daemon for a clone in the background; prints its pid into <clone>.pid.
root=$1
nohup /tmp/sq172/clean.sh "$root" /tmp/sq172/plugin/bin/squeal daemon "$root" > "$root.daemon.log" 2>&1 &
echo $! > "$root.pid"; echo "daemon pid $(cat $root.pid)"
