#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#64 (../../issue-64.md). Re-run: sh run.sh
# A fresh /tmp/i64-XXXXXX with its own HOME and XDG_RUNTIME_DIR; the only daemon started is the
# scratch repository's, stopped at the end. Squeal is a copy of the installed plugin (0.1.233, the
# incident's version, by default; SQUEAL_PLUGIN overrides). One test file of 30 checks x 400 ms;
# two new checks are appended, the first red; we time the daemon's verdict against vitest -t.
set -u
here=$(cd "$(dirname "$0")" && pwd)
plugin_src=${SQUEAL_PLUGIN:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.233}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs; $(date -u +%FT%TZ)"
S=$(mktemp -d /tmp/i64-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
now() { date +%s.%N; }
echo "scratch $S; squeal $(sq --version)"
repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i64 && git config user.name i64
printf 'node_modules\n' >.gitignore
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
sq start "$repo" 2>&1 | head -3
echo "=== phase A: baseline checkpoint of the 30 existing checks"
t0=$(now); sq run --all --wait 2>&1 | head -6; t1=$(now)
echo "phase A wall: $(echo "$t1 - $t0" | bc) s"
echo "=== CLI surface: any selector within one file?"
sq run --help 2>&1 | head -12
sq status --help 2>&1 | grep -iE 'name|pattern|-t\b|grep|only' || echo "(status --help: no name/pattern selector)"
echo "=== phase B: append two new checks (new 1 red, new 2 green); named wait on the file"
sed -i 's|  // NEW-ASSERTIONS|  it("new 1", () => { expect(1).toBe(2); });\n  it("new 2", () => { expect(2).toBe(2); });|' test/parity.test.ts
t0=$(now); sq status --wait 120000 test/parity.test.ts 2>&1 | head -14; t1=$(now)
echo "phase B daemon red wall (edit to verdict): $(echo "$t1 - $t0" | bc) s"
echo "=== phase C: a check name in place of a path"
sq status --wait 5000 "test/parity.test.ts > parity > new 1" 2>&1 | head -6; echo "exit $?"
echo "=== control: vitest -t on the two new checks (unmanaged, what the issue wants the daemon to own)"
t0=$(now); npx vitest run test/parity.test.ts -t "new " 2>&1 | grep -E "✓|×|FAIL|Tests|skipped|Duration" | head -10; t1=$(now)
echo "control wall: $(echo "$t1 - $t0" | bc) s"
echo "=== control: full file (what the daemon runs)"
t0=$(now); npx vitest run test/parity.test.ts 2>&1 | grep -E "Tests|Duration" | head -4; t1=$(now)
echo "full-file wall: $(echo "$t1 - $t0" | bc) s"
echo "=== stop"
sq stop "$repo" 2>&1 | head -2
rm -rf "$S"
