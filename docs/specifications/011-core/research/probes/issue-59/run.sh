#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#59 (../../issue-59.md). Re-run: sh run.sh [plugin-dir]
# A fresh /tmp/i59-XXXXXX with its own HOME and XDG_RUNTIME_DIR; the only daemon started is the
# scratch repository's, stopped at the end. Squeal is a copy of the installed plugin (0.1.232 by
# default). Test files: test/fast.test.ts, test/slow.test.ts (8 s); test/nope.test.ts does not exist.
set -u
here=$(cd "$(dirname "$0")" && pwd)
plugin_src=${1:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.232}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs"
S=$(mktemp -d /tmp/i59-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
echo "scratch $S; squeal $(sq --version)"
repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i59 && git config user.name i59
printf 'node_modules\n' >.gitignore
echo '{}' >squeal.config.json
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
t() { date +%s.%N; }
named() { # label, then paths
  label=$1; shift
  echo "=== $label: squeal status --json --wait 60000 $*"
  a=$(t)
  sq status --json --wait 60000 "$@" >"$S/out.json" 2>"$S/err.txt"; rc=$?
  b=$(t)
  echo "exit $rc; elapsed $(echo "$b - $a" | bc) s"
  node "$here/summarize.mjs" <"$S/out.json"
  echo "stderr:"; sed 's/^/  /' "$S/err.txt" | head -8
}
edit() { sed -i "s|// edit: .*|// edit: $1|" test/slow.test.ts; }
echo "=== phase S (startup): start, then at once a named wait with one nonexistent path"
sq start "$repo" 2>&1 | head -3
named "S1 real + nonexistent, at startup" test/slow.test.ts test/nope.test.ts
named "S2 same call again" test/slow.test.ts test/nope.test.ts
echo "=== checkpoint"
sq run --all --wait 2>&1 | head -3
echo "=== phase A: edit test/slow.test.ts (8 s run), then at once the mixed wait, twice"
edit 1
named "A1 real pending + nonexistent" test/slow.test.ts test/nope.test.ts
named "A2 same call again" test/slow.test.ts test/nope.test.ts
named "A3 corrected selection, after A1/A2 (file may be mid-run)" test/slow.test.ts test/fast.test.ts
echo "=== phase B: edit again, then at once the corrected wait"
edit 2
named "B1 corrected selection" test/slow.test.ts test/fast.test.ts
echo "=== phase C: edit again, then the nonexistent path alone"
edit 3
named "C1 nonexistent alone" test/nope.test.ts
sq status --wait 30000 test/slow.test.ts >/dev/null 2>&1
echo "=== stop"
sq stop "$repo" 2>&1 | head -2
rm -rf "$S"
