#!/bin/sh
# One daemon life in the fixture: start, wait for the baseline to settle, stop. Then prints every baseline
# checkpoint so far with the files it listed and the files its runs held. Usage: cycle.sh <label>
X=${X:-$TMPDIR/rb/x}; P=$(dirname "$0"); SQ=${SQ:?squeal checkout}; CLI=$SQ/plugins/claude-code/dist/cli/squeal.mjs
FX=${FX:-$X/fx}; cd $FX
echo "== $1 $(date -u +%H:%M:%SZ) load $(cut -d' ' -f1 /proc/loadavg)"
nice -n 10 $P/env.sh node $CLI start > $X/tmp/start.out 2>&1; echo "start exit $?"
sleep 3; ok=0; i=0; while [ $i -lt 90 ]; do
  nice -n 10 $P/env.sh node $CLI status > $X/tmp/status.out 2>&1
  if grep -Eq '[1-9][0-9]* (running|queued)|still listing|not listed' $X/tmp/status.out; then ok=0; else ok=$((ok+1)); [ $ok -ge 2 ] && break; fi
  sleep 2; i=$((i+1)); done
echo "settled after ~$((i*2+3)) s"; sed -n 2,3p $X/tmp/status.out
nice -n 10 $P/env.sh node $CLI stop > $X/tmp/stop.out 2>&1; echo "stop exit $?"
mkdir -p $X/copy && rm -f $X/copy/store.sqlite* && cp "$(git rev-parse --git-common-dir)"/squeal/store.sqlite* $X/copy/
node $P/fx-count.cjs $X/copy/store.sqlite
