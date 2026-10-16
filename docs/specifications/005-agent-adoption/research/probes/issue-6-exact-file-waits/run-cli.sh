#!/bin/sh
# Issue 6 end-to-end probe: a two-test-file Vitest fixture in a new /tmp
# directory whose policy `inputs` makes each test file an input of the other
# (the issue's `.github/scripts/**` shape), run by a pinned Squeal CLI with a
# scratch HOME and XDG_RUNTIME_DIR. Prints the selection of
# `status --json --wait <ms> <path>` for a test path and a source path.
# Usage: [INPUT_GLOB=<glob>] run-cli.sh <squeal bin> <dir holding node_modules with vitest>
set -eu
squeal_bin=$1
modules=$2/node_modules
work=$(mktemp -d /tmp/squeal-issue6-cli-XXXX)
mkdir -m 700 "$work/home" "$work/run"
fx=$work/fixture
mkdir -p "$fx/scripts"
export HOME=$work/home XDG_RUNTIME_DIR=$work/run
unset CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT CODEX_HOME 2>/dev/null || true
for v in $(env | sed -n 's/^\(CEZ_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
cd "$fx"
ln -s "$modules" node_modules
printf '{ "name": "issue6", "private": true, "type": "module" }\n' > package.json
printf 'node_modules\n' > .gitignore
printf 'export const lib = () => 1;\n' > scripts/lib.ts
for n in ledger targets; do
  printf 'import { expect, it } from "vitest";\nimport { lib } from "./lib.js";\nit("%s holds", () => expect(lib()).toBe(1));\n' "$n" > "scripts/$n.test.ts"
done
# INPUT_GLOB=scripts/lib.ts is the control: no test file is another's input.
printf '{ "inputs": { "scripts/*.test.ts": ["%s"] } }\n' "${INPUT_GLOB:-scripts/**}" > squeal.config.json
echo "inputs: $(cat squeal.config.json)"
git init -q -b main . && git add -A && git -c user.email=p@x -c user.name=probe commit -qm fixture
echo "squeal: $("$squeal_bin" --version 2>/dev/null || echo unknown)  fixture: $fx"
uptime
"$squeal_bin" start >/dev/null 2>&1 || true
"$squeal_bin" run --all --wait 120000 | head -1
pick='const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify({outcome:j.wait.outcome,code:j.wait.code,testFiles:j.wait.testFiles.map(f=>f.path),unmatched:j.wait.unmatched}))'
for named in scripts/ledger.test.ts scripts/lib.ts; do
  echo "\$ squeal status --json --wait 60000 $named"
  "$squeal_bin" status --json --wait 60000 "$named" 2>/dev/null | node -e "$pick" || true
done
# The issue's step 1: edit the named test file, then wait on it alone.
printf 'it("ledger new", () => expect(lib()).toBe(1));\n' >> scripts/ledger.test.ts
echo "(edited scripts/ledger.test.ts)"
echo "\$ squeal status --json --wait 60000 scripts/ledger.test.ts"
"$squeal_bin" status --json --wait 60000 scripts/ledger.test.ts 2>"$work/stderr.txt" | node -e "$pick" || true
echo "first line: $(head -1 "$work/stderr.txt")"
"$squeal_bin" stop >/dev/null 2>&1 || true
echo "stopped; scratch left at $work"
