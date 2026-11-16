#!/usr/bin/env bash
# Throwaway (glob-membership, Q1 to Q3). Real Squeal daemons and the real
# Vitest adapter on a fixture under $TMPDIR. Every daemon runs with its own
# HOME and XDG folders under the fixture, writes only the fixture's store
# (<fixture>/.git/squeal), and is stopped at exit.
#
# Usage: bash scenarios.sh <squeal worktree> > out/scenarios.log 2>&1
# <squeal worktree> gives the CLI (plugins/claude-code/dist/cli/squeal.mjs)
# and the vitest package the fixture links to (no install, no network).
set -u
W=$(realpath "$1")
ROOT=$TMPDIR/glob-membership
rm -rf "$ROOT" && mkdir -p "$ROOT/home"
export HOME=$ROOT/home XDG_CACHE_HOME=$ROOT/home/.cache XDG_STATE_HOME=$ROOT/home/.state \
  XDG_DATA_HOME=$ROOT/home/.data XDG_CONFIG_HOME=$ROOT/home/.config
VITEST=$(realpath "$W/node_modules/vitest")
sq() { timeout 600 node "$W/plugins/claude-code/dist/cli/squeal.mjs" "$@" 2>&1; }
status() { sq status --wait 60000 | head -"${1:-3}"; }
truth() { echo "  truth (vitest run):"; timeout 120 node node_modules/vitest/vitest.mjs run 2>&1 | grep -E "Tests |AssertionError" | sed 's/^/    /'; }
commit() { git add -A && git -c user.email=p@p -c user.name=p commit -qm "$1"; }
link() { mkdir -p "$1/node_modules" && ln -sfn "$VITEST" "$1/node_modules/vitest"; }
plugin() { echo "export const name = \"$1\";" > "src/plugins/$1.ts"; }
imports() { node -e 'const f="package.json";const p=JSON.parse(require("fs").readFileSync(f));p.imports={"#reg":process.argv[1]};require("fs").writeFileSync(f,JSON.stringify(p,null,1)+"\n")' "$1"; }
stopall() { for d in repo w2 local local4; do [ -d "$ROOT/$d" ] && (cd "$ROOT/$d" && sq stop >/dev/null); done; }
trap stopall EXIT
step() { echo; echo "=== $*"; }

# Commit B: src/plugins holds kept.ts; registry globs it; the test expects 1 plugin.
mkdir -p "$ROOT/repo" && cd "$ROOT/repo" && git init -q -b main
mkdir -p src/plugins test && link .
echo '{ "name": "gm-fixture", "private": true, "type": "module" }' > package.json
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"] } });\n' > vitest.config.mjs
echo '{ "baseline": { "onStart": "lookup-only" } }' > squeal.config.json
echo node_modules > .gitignore
plugin kept
printf 'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });\nexport const count = Object.keys(plugins).length;\n' > src/registry.ts
printf 'import { it, expect } from "vitest";\nimport { count } from "../src/registry";\nit("counts", () => expect(count).toBe(1));\n' > test/a.test.ts
commit "B: kept only"
echo "node $(node --version), vitest $(node -p 'require("'"$VITEST"'/package.json").version'), squeal $(sq --version | head -1)"

step "S1 control: the daemon runs, a matching file is added (spec 001 D4 invalidate rule 3)"
sq start | head -1; sq run --all --wait | head -1; status 2
plugin new; sleep 3; status 4

step "S2 restart: the file is removed (daemon runs), the daemon stops, the file is added again (untracked), the daemon starts"
rm src/plugins/new.ts; sleep 3; status 2
sq stop | head -1; plugin new; sq start | head -1; sleep 5; status 3; truth

step "S3 restart: the daemon stops, the add is committed (A'), the daemon starts"
sq stop | head -1; commit "A': add new"; APRIME=$(git rev-parse HEAD)
sq start | head -1; sleep 5; status 3; truth

step "S4 another worktree: main removes new.ts (B2); a second worktree at A' (with new.ts) starts its first daemon"
git rm -q src/plugins/new.ts && commit "B2: remove new"; B2=$(git rev-parse HEAD); sleep 4; status 2
git worktree add -q ../w2 "$APRIME" && link ../w2
(cd ../w2 && ls src/plugins | tr '\n' ' ' && echo && sq start | head -1 && status 3 && truth)

step "S5 CI import (spec 018): CI records and exports at B2; a fresh clone at A' imports"
git clone -q . ../ci && link ../ci
(cd ../ci && CI=true sq ci record --out ../parts -- node node_modules/vitest/vitest.mjs run | tail -1 \
  && CI=true sq ci export --parts ../parts --out ../export.json | tail -1)
echo "-- S5a: import first, daemon started with CI unset"
git clone -q . ../local && link ../local
(cd ../local && git checkout -q "$APRIME" && sq import ../export.json | head -2 && sq start | head -1 && status 2 \
  && sq import ../export.json | head -3 && sleep 3 && sq status --full | grep -A1 "^Imported" && truth)
echo "-- S5b: import first, daemon started with CI=true (equal environment)"
git clone -q . ../local4 && link ../local4
(cd ../local4 && git checkout -q "$APRIME" && sq import ../export.json | head -2 && CI=true sq start | head -1 && status 3 \
  && sq status --full | grep -A1 "^Imported" && CI=true truth)

step "S6 fix A emulated: a listing entry src/plugins/ in the shared observed set, as fix A would record it"
sq stop | head -1; (cd ../w2 && sq stop | head -1)
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(".git/squeal/store.sqlite");db.prepare("insert or replace into meta(key,value) values(?,?)").run("observed.",JSON.stringify({"test/a.test.ts":["src/plugins/"]}))' 2>/dev/null
sq start | head -1; status 2; sq run --all --wait | head -1; status 2
echo "-- restart with an added file"
sq stop | head -1; plugin new; sq start | head -1; sleep 5; status 2
echo "-- restart with the file removed again"
sq stop | head -1; rm src/plugins/new.ts; sq start | head -1; sleep 5; status 2
echo "-- the worktree at A' (with new.ts) starts again"
(cd ../w2 && sq start | head -1 && status 2)
(cd ../w2 && sq stop | head -1)

step "S7 other resolution inputs, restart: a shadowing src/registry.js; package.json imports retargeted"
printf 'import { it, expect } from "vitest";\nimport { value } from "#reg";\nit("reads a", () => expect(value).toBe("a"));\n' > test/b.test.ts
echo 'export const value = "a";' > src/reg-a.ts; echo 'export const value = "b";' > src/reg-b.ts; imports ./src/reg-a.ts
commit "C: #reg import"; sleep 5; sq run --all --wait | head -1; status 2
echo "-- shadowing file added while stopped"
sq stop | head -1; echo 'export const count = 99;' > src/registry.js; sq start | head -1; sleep 5; status 2; truth
sq stop | head -1; rm src/registry.js
echo "-- package.json imports retargeted while stopped"
imports ./src/reg-b.ts; sq start | head -1; sleep 5; status 2; truth
echo "-- live controls: retarget back and forth, then add the shadowing file, with the daemon running"
imports ./src/reg-a.ts; sleep 4; status 2; imports ./src/reg-b.ts; sleep 4; status 3
imports ./src/reg-a.ts; sleep 4; echo 'export const count = 99;' > src/registry.js; sleep 4; status 3; rm src/registry.js; sleep 4

step "S8 a template-literal import() enters the closure as its matched files, with no listing"
printf 'import { it, expect } from "vitest";\nit("loads", async () => {\n  const name = "kept";\n  const mod = await import(`../src/plugins/${name}.ts`);\n  expect(mod.name).toBe("kept");\n});\n' > test/c.test.ts
sleep 5; status 2
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(".git/squeal/store.sqlite",{readOnly:true});for(const r of db.prepare("select path, closure_paths from test_files order by path").all())console.log("  "+r.path, r.closure_paths)' 2>/dev/null
echo; echo "=== done; daemons stopped at exit"
