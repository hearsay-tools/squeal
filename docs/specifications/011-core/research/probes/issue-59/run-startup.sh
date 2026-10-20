#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#59: the startup window with many test files.
# Re-run: sh run-startup.sh [plugin-dir] [N]. Same isolation as run.sh; N generated trivial test
# files (default 300) beside fixture/; from `squeal start`, a named wait on one real file and one
# nonexistent path, repeated eight times, each printed with its elapsed time.
set -u
here=$(cd "$(dirname "$0")" && pwd)
plugin_src=${1:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.232}
n=${2:-300}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs"
S=$(mktemp -d /tmp/i59s-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
echo "scratch $S; squeal $(sq --version); $n generated test files"
repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i59 && git config user.name i59
printf 'node_modules\n' >.gitignore
echo '{}' >squeal.config.json
mkdir -p test/gen
i=0; while [ $i -lt "$n" ]; do
  printf 'import { expect, test } from "vitest";\ntest("g%s", () => expect(%s).toBe(%s));\n' $i $i $i >test/gen/g$i.test.ts
  i=$((i + 1))
done
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
t() { date +%s.%N; }
t0=$(t)
sq start "$repo" 2>&1 | head -1
k=1; while [ $k -le 8 ]; do
  a=$(t)
  sq status --json --wait 60000 test/slow.test.ts test/nope.test.ts >"$S/out.json" 2>"$S/err.txt"; rc=$?
  b=$(t)
  echo "=== call $k at +$(echo "$a - $t0" | bc) s: exit $rc; elapsed $(echo "$b - $a" | bc) s"
  node "$here/summarize.mjs" <"$S/out.json" | cut -c1-400
  sed 's/^/  stderr: /' "$S/err.txt" | cut -c1-300 | head -3
  k=$((k + 1)); sleep 0.3
done
sq stop "$repo" 2>&1 | head -1
rm -rf "$S"
