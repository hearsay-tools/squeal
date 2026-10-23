#!/usr/bin/env bash
# Throwaway probe for 011-127: one plain vitest run of the scratch clone, 4 workers, isolated HOME.
set -u
R=/tmp/r127; C=$R/repo
cp "$(dirname "$0")/attrib.ts" $C/r127-attrib.ts
cp "$(dirname "$0")/vitest.r127.config.ts" $C/vitest.r127.config.ts
: > $R/builders.jsonl
cd $C
uptime > $R/census-load.txt
( while sleep 30; do cut -d' ' -f1-3 /proc/loadavg; done ) >> $R/census-load.txt & L=$!
HOME=$R/home XDG_RUNTIME_DIR=$R/run XDG_CONFIG_HOME=$R/config TMPDIR=$R/tmp R127_LOG=$R/builders.jsonl \
  /usr/bin/time -v npx vitest run --config vitest.r127.config.ts --maxWorkers=4 --exclude 'test/e2e/**' \
  --reporter=json --outputFile=$R/census.json > $R/census.out 2> $R/census.err
echo "exit $?" >> $R/census.out
kill $L; uptime >> $R/census-load.txt
