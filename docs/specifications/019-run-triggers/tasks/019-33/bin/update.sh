#!/bin/sh
# Throwaway probe for 019-33, as squeal-e2e in the fixture clone (019-17's as-e2e.mjs). No model.
#   sh update.sh <fix-h1 commit>
# When does a commit line's update come if no test runs after the commit? (s1f and s2 stored
# their update when the e2e run ended, 17 to 18 s after the commit.) A new store, a daemon
# settled by `squeal run --all --wait`; then a commit of a new src/extra.ts with an unused
# variable (one oxlint finding) that no test reads, so lint is the only work; then the commit
# line and the Lint line from status every 0.5 s for 60 s, each change printed with its time.
set -eu
base=$1
git checkout -q -f fix-h1 && git reset -q --hard "$base" && git clean -fdq
squeal stop >/dev/null 2>&1 || true
rm -rf .git/squeal
squeal start >/dev/null
squeal run --all --wait 300000 >/dev/null || true
printf 'const unused = 1;\nexport const extra = 2;\n' > src/extra.ts
git add src/extra.ts && git commit -q -m "probe: extra"
sha=$(git rev-parse --short=7 HEAD)
t0=$(date +%s%N)
last=
for i in $(seq 1 120); do
  now=$(squeal status | grep -E "^(Commit $sha|Lint:)" | tr '\n' '|' || true)
  if [ "$now" != "$last" ]; then echo "$(( ($(date +%s%N) - t0) / 1000000 )) ms: $now"; last=$now; fi
  sleep 0.5
done
squeal stop >/dev/null 2>&1 || true
git checkout -q -f fix-h1 && git reset -q --hard "$base" && git clean -fdq
