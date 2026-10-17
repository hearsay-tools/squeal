#!/bin/sh
# Throwaway probe for gh-20 (../../issue-20-reproduction.md). Re-run: sh run.sh [rounds]
# Everything lives in a fresh /tmp/i20-XXXXXX with its own HOME and
# XDG_RUNTIME_DIR; the only daemons started are this scratch repository's two
# worktrees, both stopped at the end. The Squeal used is a copy of the
# installed plugin (0.1.199 by default; SQUEAL_PLUGIN overrides).
set -u
here=$(cd "$(dirname "$0")" && pwd)
rounds=${1:-5}
plugin_src=${SQUEAL_PLUGIN:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs"

S=$(mktemp -d /tmp/i20-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
echo "scratch $S; squeal $(sq --version)"

repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i20 && git config user.name i20
printf 'node_modules\n' >.gitignore
cat >squeal.config.json <<'JSON'
{ "slow": { "include": ["test/race.test.ts", "test/setup-race.test.ts"] } }
JSON
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
git worktree add -q "$S/wt2" -b wt2 && ln -s "$repo/node_modules" "$S/wt2/node_modules"

sq start "$repo" 2>&1 | head -3
runs_per_file() {
  node -e '
const db = new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true });
const n = {};
for (const r of db.prepare("SELECT test_files FROM runs").all())
  for (const f of JSON.parse(r.test_files)) n[f.path] = (n[f.path] ?? 0) + 1;
console.log(JSON.stringify(n));
' "$repo/.git/squeal/store.sqlite"
}
echo "=== phase A: first checkpoint, not forced (011 C5 re-runs a fast file's new failure once, never a slow file's)"
sq run --all --wait 2>&1 | head -12
sq status --wait 60000 >/dev/null 2>&1
echo "runs per test file: $(runs_per_file)"
echo "=== phase B: forced rounds (a forced run re-runs nothing)"
for r in $(seq 1 "$rounds"); do
  echo "=== round $r: run --all --force --wait (repo)"
  sq run --all --force --wait >"$S/round-$r.txt" 2>&1
  head -12 "$S/round-$r.txt"
done
echo "=== tally over $rounds rounds: rounds in which each file was a known failure"
for f in race stuck setup-race; do
  echo "test/$f.test.ts: $(grep -l "FAIL  test/$f.test.ts" "$S"/round-*.txt 2>/dev/null | wc -l) of $rounds"
done
echo "=== runs per test file after phase B: $(runs_per_file)"

echo "=== status"; sq status 2>&1
echo "=== failures"; sq failures 2>&1 | head -30
for f in test/race.test.ts test/stuck.test.ts test/setup-race.test.ts; do
  echo "=== why $f"; sq why "$f" 2>&1 | head -40
done

echo "=== second worktree"
(cd "$S/wt2" && sq start "$S/wt2" 2>&1 | head -3 && sq run --all --wait 2>&1 | head -6)
echo "=== where each run's temp directory was (both worktrees)"
grep -rhoa 'I20 tmpdir=[^ ]* dir=[^ ]* pid=[0-9]*' "$(git rev-parse --git-common-dir)/squeal/runs" | sort -u

echo "=== stop"
sq stop "$repo" 2>&1; sq stop "$S/wt2" 2>&1
sleep 2
ps -eo pid=,args= | grep -F "$S/plugin/dist/cli/squeal.mjs daemon" | grep -v grep || echo "no scratch daemon left"
echo "=== control: test/race.test.ts under plain Vitest, no Squeal, $rounds runs"
mkdir -p "$S/tmp"
fails=0
for r in $(seq 1 "$rounds"); do
  TMPDIR=$S/tmp npx vitest run test/race.test.ts >"$S/control-$r.txt" 2>&1 || fails=$((fails + 1))
done
echo "plain Vitest: failed $fails of $rounds"
grep -h "ENOTEMPTY" "$S"/control-*.txt | sort -u | head -3
echo "scratch kept at $S (store: $repo/.git/squeal/store.sqlite)"
