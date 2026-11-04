#!/bin/sh
# Throwaway probe for 019-17 (open question 4), as squeal-e2e in the fixture clone. No model.
# A commit of one of two edited files, the other left unstaged in the closure of two test files,
# then the commit line as status shows it, polled until it names the commit.
set -eu
git checkout -q -f fix-h2 && git reset -q --hard "$1" && git clean -fdq
squeal start >/dev/null
squeal run --all --wait 300000 >/dev/null || true
printf '// partial probe\nexport const add = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\n' > src/math.ts
printf '// unstaged\nexport const shout = (s: string) => `${s.toUpperCase()}!`;\n' > src/strings.ts
git add src/math.ts && git commit -q -m "partial: math only"
start=$(date +%s)
echo "committed $(git rev-parse --short HEAD) at $(date -u +%T); unstaged: $(git diff --name-only)"
for i in $(seq 1 30); do
  line=$(squeal status | grep "^Commit $(git rev-parse --short=7 HEAD)" || true)
  if [ -n "$line" ]; then echo "poll $i, $(( $(date +%s) - start )) s after the commit: $line"; case "$line" in *running*) ;; *) break ;; esac; fi
  sleep 2
done
squeal status | grep -E "^(Commit|Revision|Known)"
git reset -q --hard "$1"
