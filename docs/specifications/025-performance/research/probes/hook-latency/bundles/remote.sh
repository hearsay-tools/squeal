#!/bin/sh
# Throwaway probe (row 025-14): the quiet-host measurements, run inside a
# boat.dev sandbox by boat.sh from the unpacked payload's root. Writes
# everything to ./results/.
set -eu
P=docs/specifications/025-performance/research/probes/hook-latency/bundles
R=$PWD/results
S=$PWD/scratch
mkdir -p "$R" "$S"
export TMPDIR=$S
CASES='^(session-start|post-tool-batch|pre-tool-use|stop|stop-silent|user-prompt-submit|user-prompt-submit-silent)$'
probe() { timeout 1800 pnpm exec vitest run --config $P/vitest.probe.config.ts > "$R/$1.log" 2>&1; }
{
  node --version; nproc; grep -m1 'model name' /proc/cpuinfo; uptime
  for v in base minify split builtins lazy cut lazy+cut+minify builtins+cut+minify; do
    pnpm exec tsx $P/build-variant.ts "$S/v/$v" "$v"
  done
  # Output parity first: every variant against base, fresh store each.
  for v in base minify split builtins lazy cut lazy+cut+minify builtins+cut+minify; do
    PROBE_DISTS="$v=$S/v/$v" PROBE_RUNS=2 PROBE_STDOUT="$R/out-$v.json" PROBE_OUT="$S/chk-$v.json" probe "chk-$v"
  done
  node $P/parity.mjs "$R/out-base.json" "$R"/out-*.json > "$R/parity.txt"
  echo builtins; node $P/builtins.mjs "$S/bi" 40 > "$R/builtins.txt"
  node $P/phases.mjs "$S/v/base" "$S/ph"
  D="empty=$S/ph/empty,builtins=$S/ph/builtins,parse=$S/ph/parse,eval=$S/ph/eval,full=$S/v/base"
  echo phases
  PROBE_NO_CHECK=1 PROBE_DISTS=$D PROBE_RUNS=30 PROBE_CASES=$CASES PROBE_OUT="$R/phases-nocache.json" probe phases-nocache
  PROBE_NO_CHECK=1 PROBE_DISTS=$D PROBE_RUNS=30 PROBE_CASES=$CASES PROBE_ENV="{\"NODE_COMPILE_CACHE\":\"$S/cc1/{dist}\"}" PROBE_OUT="$R/phases-cache.json" probe phases-cache
  echo variants
  D=$(for v in base minify split builtins lazy cut builtins+cut+minify lazy+cut+minify; do printf "%s=%s," $v "$S/v/$v"; done | sed 's/,$//')
  PROBE_DISTS=$D PROBE_RUNS=30 PROBE_CASES=$CASES PROBE_OUT="$R/variants-nocache.json" probe variants-nocache
  PROBE_DISTS=$D PROBE_RUNS=30 PROBE_CASES=$CASES PROBE_ENV="{\"NODE_COMPILE_CACHE\":\"$S/cc2/{dist}\"}" PROBE_OUT="$R/variants-cache.json" probe variants-cache
  echo parse-size
  for t in tags/*; do node $P/phases.mjs "$t/dist" "$t/ph" >/dev/null; done
  node $P/phases.mjs "$S/v/builtins+cut+minify" "$S/bcm-ph"
  node $P/parse-size.mjs 30 pre-tool-use,stop empty=tags/792ee0ccb/ph/empty builtins=tags/792ee0ccb/ph/builtins \
    0.1.364=tags/squeal--v0.1.364/ph/parse 0.1.409=tags/squeal--v0.1.409/ph/parse 0.1.450=tags/squeal--v0.1.450/ph/parse \
    0.1.568=tags/squeal--v0.1.568/ph/parse 0.1.600=tags/squeal--v0.1.600/ph/parse main=tags/792ee0ccb/ph/parse \
    builtins+cut+min="$S/bcm-ph/parse" > "$R/parse-size.txt"
  for f in phases-nocache phases-cache variants-nocache variants-cache; do node $P/summarize.mjs "$R/$f.json" > "$R/$f.txt"; done
  uptime
} > "$R/run.log" 2>&1
touch "$R/done"
