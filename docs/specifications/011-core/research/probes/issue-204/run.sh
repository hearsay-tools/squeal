#!/usr/bin/env bash
# Throwaway probe for gh-204. Usage: run.sh <squeal-worktree-with-node_modules>
set -u
SRC_NM="$1/node_modules"
P="${PROBE_DIR:-${TMPDIR:-/tmp}/issue-204}"
OUT="$(cd "$(dirname "$0")" && pwd)/out"; mkdir -p "$OUT"
rm -rf "$P"; mkdir -p "$P/home" "$P/repo"; REAL_HOME="$HOME"; export HOME="$P/home"
# the launcher needs the plugin record; copy it (read-only paths into the real plugin cache)
mkdir -p "$HOME/.claude/plugins"; cp "$REAL_HOME/.claude/plugins/installed_plugins.json" "$HOME/.claude/plugins/"
cd "$P/repo"
log(){ echo "== $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg) $*" | tee -a "$OUT/log.txt"; }
: > "$OUT/log.txt"
git init -q -b main .; git config user.email p@x; git config user.name probe
ln -s "$SRC_NM" node_modules
printf 'node_modules\n' > .gitignore
cat > package.json <<J
{ "name": "p204", "version": "1.0.0", "private": true, "type": "module" }
J
cat > vitest.config.ts <<J
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
J
echo '{ "baseline": { "onStart": "lookup-only" }, "coverage": { "enabled": false }, "complexity": { "enabled": false } }' > squeal.config.json
mkdir -p src test
for i in $(seq -w 1 12); do
  echo "export const v$i = () => $i;" > src/m$i.ts
  printf 'import { test, expect } from "vitest";\nimport { v%s } from "../src/m%s";\ntest("m%s", () => { expect(v%s()).toBeGreaterThan(0); });\n' $i $i $i $i > test/m$i.test.ts
done
git add -A; git commit -qm base; BASE=$(git rev-parse HEAD)
# upstream: 11 source edits (valid key changes for m01..m11), m12 untouched (same-key control)
for i in $(seq -w 1 11); do echo "export const v$i = () => $((10#$i + 100));" > src/m$i.ts; done
git commit -qam "upstream: edit 11 sources"
# upstream 2: version bump only (an environment-only candidate)
sed -i 's/"1.0.0"/"1.0.1"/' package.json; git commit -qam "upstream: version bump"
# upstream 3: a comment in the root Vitest config (an environment input)
echo "// upstream comment" >> vitest.config.ts; git commit -qam "upstream: config comment"
# branch: two test-only commits from BASE
git checkout -q -b work "$BASE"
sed -i 's/toBeGreaterThan(0)/toBeGreaterThan(-1)/' test/m01.test.ts; git commit -qam "work 1"
sed -i 's/toBeGreaterThan(0)/toBeGreaterThan(-1)/' test/m12.test.ts; git commit -qam "work 2"
log "squeal $(squeal --version)"
squeal start > "$OUT/01-start.txt" 2>&1
squeal run --all --wait > "$OUT/02-run-all.txt" 2>&1; log "run --all exit $?"
squeal status --json > "$OUT/03-before.json" 2>&1
phase(){ # $1 label, $2 target
  log "rebase onto $2 ($1)"
  git rebase -q "$2" 2>&1 | tee -a "$OUT/log.txt"
  for t in 1 2 3 4 5 6; do squeal status --json > "$OUT/$1-after-$t.json" 2>&1; sleep 1; done
  squeal status --full > "$OUT/$1-after-full.txt" 2>&1
  squeal status --wait 60000 > "$OUT/$1-wait.txt" 2>&1; log "$1 status --wait exit $?"
  squeal status --json > "$OUT/$1-settled.json" 2>&1
}
phase A main~2   # 11 source edits upstream, m12 untouched
phase B main~1   # package.json version bump only
phase C main     # root Vitest config comment only
log "stop"; squeal stop > "$OUT/08-stop.txt" 2>&1; log "stop exit $?"
git log --oneline --all > "$OUT/git-log.txt"
