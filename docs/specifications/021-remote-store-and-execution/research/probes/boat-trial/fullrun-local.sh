#!/bin/sh
. $TMPDIR/trial/env.sh
cd $TMPDIR/trial/clone
echo "start $(date -u +%s.%N) load $(cat /proc/loadavg)" > $TMPDIR/trial/fullrun-local.meta
( while sleep 60; do cut -d' ' -f1 /proc/loadavg; done ) > $TMPDIR/trial/fullrun-local.loads &
w=$!
CI= flock /run/user/$(id -u)/squeal-full-run.lock node_modules/.bin/vitest run --maxWorkers=4 --exclude "test/e2e/**" --reporter=dot --reporter=json --outputFile=$TMPDIR/trial/fullrun-local.json > $TMPDIR/trial/fullrun-local.log 2>&1
echo "exit $? end $(date -u +%s.%N)" >> $TMPDIR/trial/fullrun-local.meta
kill $w
