#!/bin/bash
# measure.sh <repo: squeal|cezar|toolkit> <first rep> <last rep> <scenario>...: per repetition and scenario,
# the edit then its revert, each written to every tool's clone in turn (Squeal, Vitest watch, and on
# toolkit plain pytest and pytest --testmon), the first tool alternating by repetition. One JSON line per
# tool and step to /tmp/wm119/results.ndjson. Throwaway (011-119).
P=$(dirname "$(readlink -f "$0")"); R=/tmp/wm119/repos; OUT=/tmp/wm119/results.ndjson
repo=$1 r1=$2 r2=$3; shift 3
case $repo in squeal) S=$R/squeal-s V=$R/squeal-v VL=/tmp/wm119/vt-squeal.ndjson ;; cezar) S=$R/cezar-s V=$R/cezar-v VL=/tmp/wm119/vt-cezar.ndjson ;;
  toolkit) S=$R/toolkit-s V=$R/toolkit-v VL=/tmp/wm119/vt-toolkit.ndjson PY=$R/toolkit-p ;; esac
load() { cut -d' ' -f1 /proc/loadavg; }
path_of() { case $1 in s-body|s-break) echo src/harness/pi/session.ts ;; s-test) echo test/harness/pi/session.test.ts ;;
  c-body|c-break) echo packages/cezar/src/application-update/helper.ts ;; c-test) echo packages/cezar/src/application-update/helper.test.ts ;;
  t-cli|t-cli-swp) echo plugin-tools/estimate-pricing/estimate_pricing/cli.py ;; t-rules) echo plugin-tools/estimate-pricing/estimate_pricing/rules.py ;;
  t-ts) echo tools/generator/src/lib/version-guard.ts ;; esac; }
# The edit's affected test files: Vitest's related walk, or the edited test file (expected outcomes: README).
sq_files() { case $1 in s-body|s-break) echo test/cli/pi-status.test.ts test/harness/primer-slow-policy.test.ts test/harness/pi/run.test.ts test/harness/pi/session.test.ts ;;
  s-test) echo test/harness/pi/session.test.ts ;;
  c-body|c-break) echo packages/cezar/src/application-update/helper.test.ts packages/cezar/src/application-update/hoisted-recovery.test.ts packages/cezar/src/application-update/windows.test.ts ;;
  c-test) echo packages/cezar/src/application-update/helper.test.ts ;;
  t-cli|t-cli-swp|t-rules) echo tools/generator/tests/publish.test.ts ;;
  t-ts) echo tools/generator/tests/version-guard.test.ts tools/generator/tests/cli.test.ts tools/generator/tests/opencode-runtime.test.ts tools/generator/tests/pi-runtime.test.ts tools/generator/tests/publish.test.ts ;; esac; }
vt_files() { if [ $repo = toolkit ]; then for f in $(sq_files $1); do echo ${f#tools/generator/}; done; else sq_files $1; fi; }
run_squeal() { local sc=$1 op=$2 rep=$3 l t0 w i
  l=$(load); t0=$("$P/edit.sh" $S $sc $op $rep | head -1)
  w=$(node "$P/sq-wait.mjs" $S $(path_of $sc) $t0 420 $(sq_files $sc))
  i=$("$P/sq-idle.sh" $S 420)
  echo "{\"tool\":\"squeal\",\"repo\":\"$repo\",\"sc\":\"$sc\",\"op\":\"$op\",\"rep\":$rep,\"t0\":$t0,\"load\":$l,\"idle\":\"$i\",\"w\":$w}" >> $OUT; }
run_vitest() { local sc=$1 op=$2 rep=$3 l t0 w
  l=$(load); t0=$("$P/edit.sh" $V $sc $op $rep | head -1)
  w=$(node "$P/vt-wait.mjs" $VL $t0 15 420 $(vt_files $sc))
  echo "{\"tool\":\"vitest-watch\",\"repo\":\"$repo\",\"sc\":\"$sc\",\"op\":\"$op\",\"rep\":$rep,\"t0\":$t0,\"load\":$l,\"w\":$w}" >> $OUT; sleep 2; }
run_pytest() { local sc=$1 op=$2 rep=$3 l t0 a b c rc1 rc2 o1 o2
  l=$(load); t0=$("$P/edit.sh" $PY $sc $op $rep | head -1)
  cd $PY/plugin-tools/estimate-pricing; source "$P/env.sh"
  a=$(date +%s.%N); o1=$(.venv/bin/python -m pytest -q -p no:cacheprovider -p no:testmon 2>&1 | tail -1); rc1=$?
  b=$(date +%s.%N); o2=$(.venv/bin/python -m pytest -q --testmon 2>&1 | tail -1)
  c=$(date +%s.%N); cd - >/dev/null
  echo "{\"tool\":\"pytest\",\"repo\":\"$repo\",\"sc\":\"$sc\",\"op\":\"$op\",\"rep\":$rep,\"t0\":$t0,\"load\":$l,\"plain_s\":$(echo "$b - $t0" | bc),\"plain\":\"$o1\",\"testmon_s\":$(echo "$c - $b" | bc),\"testmon\":\"$o2\"}" >> $OUT; }
for rep in $(seq $r1 $r2); do for sc in "$@"; do for op in apply revert; do
  if [ $((rep % 2)) = 1 ]; then run_squeal $sc $op $rep; run_vitest $sc $op $rep; else run_vitest $sc $op $rep; run_squeal $sc $op $rep; fi
  [ -n "$PY" ] && case $sc in t-cli|t-rules) run_pytest $sc $op $rep ;; esac
  echo "$(date +%T) $repo rep $rep $sc $op done"
done; done; done
