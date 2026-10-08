#!/bin/sh
# Throwaway. Runs cezar's cursor S26-S28 under a real Squeal daemon (this checkout's
# plugins/claude-code/dist, 0.1.32) in a clone trimmed to runner-shutdown-parity.test.ts.
# usage: daemon-probe.sh <squeal.mjs> <clone at 5974ec91 + trim commit> <forced-runs>
SQ=$1; C=$2; N=$3
cd "$C" || exit 2
st() { node "$SQ" status --wait 600000 >/dev/null 2>&1; echo "--- status: $1"; node "$SQ" status 2>&1 | grep -vE '^\s*$' | head -30; }
ids() { echo "--- process ids: $1"; ps -eo pid,ppid,pgid,sid,tty,args | grep -E 'squeal.mjs daemon|vitest/dist/workers|forks' | grep -v grep | cut -c1-160; }
node "$SQ" start | head -3
d=$(ps -eo pid,args | grep "squeal.mjs daemon $C" | grep -v grep | awk '{print $1}')
echo "daemon pid=$d $(ps -o sid=,pgid=,tty= -p $d) cwd=$(readlink /proc/$d/cwd) TMPDIR=$(tr '\0' '\n' < /proc/$d/environ | grep ^TMPDIR=)"
( sleep 8; ids "bootstrap run, mock at 5974ec91" ) &
st "1. bootstrap at 5974ec91 (mock has no leftover branch)"
wait
git checkout 6b660859 -- packages/cezar/scripts/mock-cursor-print.mjs
sleep 3
st "2. mock-cursor-print.mjs replaced by its 6b660859 version, nothing else"
i=1
while [ "$i" -le "$N" ]; do
  node "$SQ" run --all --force --wait 2>&1 | grep -E 'Known failures|failed|passed' | head -3 | sed "s/^/forced run $i: /"
  i=$((i+1))
done
st "3. after $N forced runs with the fixed mock"
printf '{ "inputs": { "packages/cezar/src/core/*parity*.test.ts": ["packages/cezar/scripts/**"] } }\n' > squeal.config.json
git checkout 5974ec91 -- packages/cezar/scripts/mock-cursor-print.mjs
sleep 3
st "4. inputs declared, mock back at 5974ec91"
git checkout 6b660859 -- packages/cezar/scripts/mock-cursor-print.mjs
sleep 3
st "5. inputs declared, mock at 6b660859 again"
node "$SQ" stop 2>&1 | head -2
