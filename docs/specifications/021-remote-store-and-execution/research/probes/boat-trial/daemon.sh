#!/bin/bash
. $TMPDIR/trial/env.sh
cd $TMPDIR/trial/clone
exec node $TMPDIR/trial/clone/plugins/claude-code/dist/cli/squeal.mjs daemon $TMPDIR/trial/clone 2> >(while IFS= read -r l; do echo "$(date -u +%T.%3N) $l"; done >> $TMPDIR/trial/daemon.log)
