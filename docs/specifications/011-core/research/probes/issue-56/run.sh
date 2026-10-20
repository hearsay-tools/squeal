#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#56 (../../issue-56.md). Re-run: sh run.sh
# A fresh /tmp/i56-XXXXXX with its own HOME and XDG_RUNTIME_DIR; the only daemon started
# is the scratch repository's, stopped at the end. Squeal is a copy of the installed plugin
# (0.1.231 by default; SQUEAL_PLUGIN overrides). Test files: a (script missing, no inputs),
# b (script present from the start), c (script missing, declared in squeal.config.json inputs).
set -u
here=$(cd "$(dirname "$0")" && pwd)
plugin_src=${SQUEAL_PLUGIN:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.231}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs"
S=$(mktemp -d /tmp/i56-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
echo "scratch $S; squeal $(sq --version)"
repo=$S/repo
mkdir "$repo" && cp -a "$here/fixture/." "$repo/"
cd "$repo"
git init -q -b main && git config user.email p@i56 && git config user.name i56
printf 'node_modules\n' >.gitignore
mkdir scripts && echo 'export default function register() { return 1; }' >scripts/b.mjs
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
sq start "$repo" 2>&1 | head -3
echo "=== phase A: a.mjs and c.mjs missing; checkpoint"
sq run --all --wait 2>&1 | head -20
echo "=== phase B: create scripts/a.mjs and scripts/c.mjs (both answer 1)"
echo 'export default function register() { return 1; }' >scripts/a.mjs
echo 'export default function register() { return 1; }' >scripts/c.mjs
sleep 3; sq status --wait 60000 2>&1 | head -20
echo "=== phase C: edit scripts/b.mjs to answer 2 (b should now fail)"
echo 'export default function register() { return 2; }' >scripts/b.mjs
sleep 3; sq status --wait 60000 2>&1 | head -20
echo "=== control: npx vitest run (the truth at this point: a and c pass, b fails)"
npx vitest run 2>&1 | grep -E "✓|✗|×|FAIL|Tests|warn" | head -12
echo "=== observed map in the store"
node -e '
const db = new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true });
for (const r of db.prepare("SELECT key, value FROM meta WHERE key LIKE ?").all("observed.%")) console.log(r.key, r.value);
' "$repo/.git/squeal/store.sqlite" 2>&1 | head -5
echo "=== stop"
sq stop "$repo" 2>&1
rm -rf "$S"
