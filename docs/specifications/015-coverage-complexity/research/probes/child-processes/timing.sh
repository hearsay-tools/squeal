#!/bin/bash
# Throwaway probe (015 R3): child coverage off/on alternated, five pairs, on
# timing-sample.txt at --maxWorkers=4, no in-process coverage. "on" adds only
# the setup file that sets NODE_V8_COVERAGE per test file. Prints one line per
# run: mode, wall s, user+sys s of vitest and its waited-for children, raw MB,
# one-minute load before and after, pass/fail counts.
R=/tmp/sq015-r3
cd $R/repo
export HOME=$R/home TMPDIR=$R/tmp XDG_RUNTIME_DIR=$R/run XDG_CONFIG_HOME=$R/cfg
FILES=$(cat r3/timing-sample.txt)
for i in 1 2 3 4 5; do
  for mode in off on; do
    rm -rf $R/time-raw
    cfg=vitest.config.ts; [ $mode = on ] && cfg=vitest.r3-child.config.ts
    l0=$(cut -d' ' -f1 /proc/loadavg)
    /usr/bin/time -f "%e %U %S" -o $R/time.txt env R3_CHILD_RAW=$R/time-raw npx vitest run --config $cfg --maxWorkers=4 --reporter=json --outputFile.json=$R/time-res.json $FILES > /dev/null 2>&1
    l1=$(cut -d' ' -f1 /proc/loadavg)
    read wall u s < <(tail -1 $R/time.txt)
    mb=$(du -sm $R/time-raw 2>/dev/null | cut -f1); mb=${mb:-0}
    res=$(node -e 'const r=require(process.argv[1]);process.stdout.write(r.numPassedTests+"p/"+r.numFailedTests+"f")' $R/time-res.json)
    echo "pair $i $mode wall=$wall cpu=$(echo "$u + $s" | bc) rawMB=$mb load=$l0->$l1 $res"
  done
done
rm -rf $R/time-raw
