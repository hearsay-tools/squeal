#!/bin/sh
# Throwaway (026 agent37-sandboxes). The whole measurement set on one instance, in order,
# after setup.sh. Probe files must be in /tmp (put.sh). Run detached:
#   RX_BG=1 rx.sh <id> suite.sh <label>      then read /tmp/rx-suite.sh.log
# Same probes as boat-sandboxes (dsync.sh, run-tests.sh, driver.mjs) plus compat.mjs,
# cpu.mjs and a 50-file Vitest slice.
L=${1:-run}
export PATH=$HOME/.local/bin:$PATH NO_COLOR=1
R=$HOME/squeal
step() { echo "## $1 $(date -u +%T)"; }
step dsync-1; sh /tmp/dsync.sh "$L-1"
step capacity; sh /tmp/run-tests.sh "$L-1" capacity; sh /tmp/run-tests.sh "$L-2" capacity
step git; sh /tmp/run-tests.sh "$L" git
step driver-vitest; node /tmp/driver.mjs vitest $R $R '"local"'
step driver-vitest-coverage; node /tmp/driver.mjs vitest $R $R '"local"' coverage
step driver-nodetest; sh /tmp/nt-fixture.sh; node /tmp/driver.mjs nodetest $HOME/nt '"local"'
step compat-home; node /tmp/compat.mjs $HOME
step compat-tmp; node /tmp/compat.mjs /tmp
step cpu; node /tmp/cpu.mjs 60
cd $R
for i in 1 2; do
  step slice50-$i
  s=$(date +%s%N)
  out=$(node_modules/.bin/vitest run $(ls test/scheduler/*.test.ts | head -50) --maxWorkers=4 --reporter=dot 2>&1); rc=$?
  echo "$L slice50-$i: exit $rc wall $(( ($(date +%s%N) - s) / 1000000 )) ms; $(printf '%s\n' "$out" | grep -E 'Test Files|Tests  |Duration' | tr -s ' ' | tr '\n' ';')"
  [ $rc -eq 0 ] || printf '%s\n' "$out" | grep -E "FAIL|Error" | head -6
  echo "load: $(cat /proc/loadavg)"
done
step dsync-2; sh /tmp/dsync.sh "$L-2"
echo SUITE-DONE $(date -u +%T)
