#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e, after
# reset-repo.sh start. Control for omp3: breaks sum.js from a shell, once with
# a plain write and once with write-to-temp plus rename, and prints the verdict
# Squeal gives for sum.test.js after each, with no agent session involved.
set -u
cd "$HOME/ht035/repo"
S="node --disable-warning=ExperimentalWarning $HOME/ht035/squeal/plugins/pi/dist/cli/squeal.mjs"
printf 'export const sum = (a, b) => a - b;\n' >sum.js
echo "== plain write"; $S status --wait 30000 sum.test.js </dev/null | head -6
git checkout -q sum.js
$S status --wait 30000 sum.test.js </dev/null | head -2
printf 'export const sum = (a, b) => a * b;\n' >sum.js.tmp
mv sum.js.tmp sum.js
echo "== rename"; $S status --wait 30000 sum.test.js </dev/null | head -6
git checkout -q sum.js
