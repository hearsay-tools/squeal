#!/usr/bin/env bash
# THROWAWAY PROBE. Not product code. See README.md.
# Cost of using git itself as the source of truth for ignore rules.
set -euo pipefail
T=$(pwd)/tmp/gi; rm -rf "$T"; mkdir -p "$T"; cd "$T"; git init -q repo; cd repo
printf 'node_modules/\ndist/\n*.log\n' > .gitignore; printf 'secret.txt\n' > .git/info/exclude
for i in $(seq 0 1999); do mkdir -p src/m$((i%100)) node_modules/p$((i%200))/m$i; echo x > src/m$((i%100))/f$i.ts; echo x > node_modules/p$((i%200))/m$i/i.js; done
mkdir -p dist sub; echo 'local.ts' > sub/.gitignore; touch sub/local.ts sub/kept.ts secret.txt a.log
git worktree add -q -b n .ai/worktrees/wt 2>/dev/null || { git add .gitignore && git -c user.name=p -c user.email=p@p commit -qm i && git worktree add -q -b n .ai/worktrees/wt; }
echo "== ignored entries at startup (collapsed to directories):"; s=$(date +%s%N)
git ls-files --others --ignored --exclude-standard --directory; echo "took $(( ($(date +%s%N)-s)/1000000 )) ms"
echo "== batch check of an event batch (nested .gitignore, info/exclude, nested worktree path):"; s=$(date +%s%N)
printf 'src/m1/f1.ts\nsub/local.ts\nsub/kept.ts\nsecret.txt\nnode_modules/p1/m1/i.js\na.log\n.ai/worktrees/wt/a\n' | git check-ignore --stdin --verbose --non-matching || true
echo "took $(( ($(date +%s%N)-s)/1000000 )) ms"
