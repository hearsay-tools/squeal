#!/bin/sh
# Throwaway: scratch repo with a buggy add.js, a node:test file, and a fake `squeal` on PATH.
# Usage: mkprimer.sh <name> none|sessionstart|agents
set -eu
PROBE=$(cd "$(dirname "$0")/.." && pwd)
case "$2" in sessionstart) R=$("$PROBE/bin/mkrepo.sh" "$1" "$PROBE/primer.txt");; *) R=$("$PROBE/bin/mkrepo.sh" "$1");; esac
cd "$R"
printf 'export function add(a, b) { return a - b; }\n' > add.js
printf '{ "name": "scratch", "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from './add.js';\ntest('add', () => { assert.equal(add(2, 3), 5); });\n" > add.test.js
[ "$2" = agents ] && cp "$PROBE/primer.txt" AGENTS.md
git add -A; git -c user.email=p@p -c user.name=p commit -qm fixture
echo "$R"
