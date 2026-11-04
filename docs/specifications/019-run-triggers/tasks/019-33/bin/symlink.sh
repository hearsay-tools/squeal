#!/bin/sh
# Throwaway probe for 019-33, as squeal-e2e in the fixture clone (019-17's as-e2e.mjs). No model.
#   sh symlink.sh <fix-h1 commit> <link|file>
# Does a tracked symlink that a test file's `inputs` name make a commit's line say "not
# determined (unstaged changes)" on a clean tree? (s1c: cezarion's CLAUDE.md -> AGENTS.md, an
# input of .github/scripts/ci.workflow.test.cjs.) On a branch from fix-h1: GUIDE.md, and
# README.md as a symlink to it (`link`) or a regular copy of it (`file`, the control), named in
# `inputs` of test/math.test.ts, committed; a new store, a daemon settled by `squeal run --all
# --wait`; then a commit of src/strings.ts alone, and its line from status, polled until it no
# longer says running. The branch is deleted at the end.
set -eu
base=$1 kind=$2
git checkout -q -f fix-h1 && git reset -q --hard "$base" && git clean -fdq
squeal stop >/dev/null 2>&1 || true
rm -rf .git/squeal
git checkout -q -B "probe-$kind" "$base"
printf '# Guide\n' > GUIDE.md
if [ "$kind" = link ]; then ln -s GUIDE.md README.md; else cp GUIDE.md README.md; fi
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("squeal.config.json", "utf8"));
c.inputs = { "test/math.test.ts": ["README.md"] };
fs.writeFileSync("squeal.config.json", JSON.stringify(c, null, 2) + "\n");
'
git add -A && git commit -q -m "probe: README.md ($kind)"
echo "README.md in HEAD: $(git ls-tree HEAD README.md)"
squeal start >/dev/null
squeal run --all --wait 300000 >/dev/null || true
printf 'export const shout = (s: string) => `${s.toUpperCase()}!`;\n// probe\n' > src/strings.ts
git add src/strings.ts && git commit -q -m "probe: strings"
sha=$(git rev-parse --short=7 HEAD)
echo "git status after the commit: [$(git status --short)]"
for i in $(seq 1 30); do
  line=$(squeal status | grep "^Commit $sha" || true)
  if [ -n "$line" ]; then case "$line" in *running*) ;; *) break ;; esac; fi
  sleep 2
done
echo "$kind: $line"
squeal stop >/dev/null 2>&1 || true
git checkout -q -f fix-h1 && git reset -q --hard "$base" && git clean -fdq
git branch -q -D "probe-$kind"
