#!/usr/bin/env bash
# Throwaway probe for research/mutation-planning.md (row 015-125), questions 2 and 4.
# Runs StrykerJS 10.1.1 in a scratch cezar copy (cwd), cezar's own stryker.config.json with concurrency 4, twice
# per set: A = the job's test selection (Vitest related); B = Squeal's "called" set; C = related minus called
# (q2-sets2.json), B and C through Stryker's --testFiles with vitest.related off. A mutant that related kills and
# B does not is killed by a test in C. "dry" adds dryRunOnly (Stryker then writes no JSON report).
# usage: run-q2.sh <A|B|C> <web|density|cezar> [dry]   (env: SETS=q2-sets2.json, OUT=dir)
set -euo pipefail
arm=$1 pkg=$2 mode=${3:-full}
SETS=${SETS:-../q2-sets2.json} OUT=${OUT:-../q2-out}
mkdir -p "$OUT" reports/q2
set=$pkg
case $set in
  density) pkg=cezar; mutate='["packages/cezar/src/preview/density.ts"]' ;;
  cezar) mutate='["packages/cezar/src/server/repo-branches.ts:384-572","packages/cezar/src/preview/density.ts"]' ;;
  web) mutate='["packages/web/src/lib/use-search-params-writer.ts"]' ;;
esac
tag=$arm-$set-$mode
node -e '
const [arm, set, mode, sets, mutate, tag] = process.argv.slice(1);
const base = JSON.parse(require("fs").readFileSync("stryker.config.json", "utf8"));
const c = { ...base, mutate: JSON.parse(mutate), concurrency: 4, jsonReporter: { fileName: `reports/q2/${tag}.json` }, reporters: ["json", "clear-text"] };
if (mode === "dry") c.dryRunOnly = true;
if (arm !== "A") { c.testFiles = JSON.parse(require("fs").readFileSync(sets, "utf8"))[set][arm === "B" ? "called" : "C"]; c.vitest = { ...base.vitest, related: false }; }
require("fs").writeFileSync(`stryker.q2.json`, JSON.stringify(c, null, 1));
' "$arm" "$set" "$mode" "$SETS" "$mutate" "$tag"
load=$(cut -d' ' -f1 /proc/loadavg)
export HOME=/tmp/mp125/home XDG_CONFIG_HOME=/tmp/mp125/home/cfg XDG_RUNTIME_DIR=/tmp/mp125/home/run TMPDIR=/tmp/mp125/home/tmp STRYKER_PROJECT=$pkg
start=$(date -u +%FT%TZ)
t0=$(date +%s.%N)
/usr/bin/time -f "%e %U %S" -o "$OUT/$tag.time" nice -n 10 node_modules/.bin/stryker run stryker.q2.json > "$OUT/$tag.log" 2>&1 &
top=$!
dry=""
# when the dry run ends, note the tree's CPU so far and the elapsed time (cpu-tree.mjs)
while kill -0 $top 2>/dev/null; do
  if [ -z "$dry" ] && grep -q "Initial test run succeeded" "$OUT/$tag.log"; then
    dry="dry-run wall=$(echo "$(date +%s.%N) - $t0" | bc) cpu=$(node "$(dirname "$0")/cpu-tree.mjs" $top) load1=$(cut -d' ' -f1 /proc/loadavg)"
    echo "$tag $dry" >> "$OUT/summary.txt"
  fi
  sleep 1
done
wait $top || echo "stryker exit $?" >> "$OUT/$tag.log"
load2=$(cut -d' ' -f1 /proc/loadavg)
git checkout -q -- .; rm -rf .stryker-tmp
echo "$tag start=$start load1=$load..$load2 wall,user,sys=$(cat "$OUT/$tag.time")" | tee -a "$OUT/summary.txt"
