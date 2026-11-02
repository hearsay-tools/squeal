#!/usr/bin/env bash
# Throwaway probe for 019 commit-checkpoint (see README.md). In a fresh
# fixture repository under $1 with one node:test file, starts a Squeal daemon,
# makes commits that change no working-tree file, and prints what the store
# recorded: revisions, and the head-move meta key (task 001-406). Stops the
# daemon at the end. Needs `squeal` on PATH.
set -euo pipefail
dir=$1
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$dir/repo"
cd "$dir/repo"
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid
export GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid
git init -q -b main .
git config commit.gpgsign false
mkdir -p src test
echo 'export const add = (a, b) => a + b;' >src/add.mjs
cat >test/add.test.mjs <<'EOF'
import { test } from "node:test";
import assert from "node:assert";
import { add } from "../src/add.mjs";
test("add", () => assert.equal(add(1, 2), 3));
EOF
echo '{"name":"fixture","type":"module","private":true}' >package.json
echo '{"nodeTest":[{"name":"unit","include":["test/**/*.test.mjs"]}]}' >squeal.config.json
git add -A
git commit -q -m initial

trap 'squeal stop "$dir/repo" >/dev/null 2>&1 || true' EXIT
squeal start "$dir/repo" >/dev/null 2>&1 || true
squeal status --wait 60000 >/dev/null 2>&1 || true

dump() {
  echo "== $1"
  node "$here/store.mjs" "$dir/repo"
}
dump "after start"

# A commit of an edit the daemon already saw: the working tree does not change at the commit.
echo 'export const add = (a, b) => b + a;' >src/add.mjs
squeal status --wait 60000 >/dev/null 2>&1 || true
dump "after edit, before commit"
git commit -q -am "edit"
echo "committed $(git rev-parse --short HEAD)"
sleep 5
dump "5 s after commit, no event"
sleep 35
dump "40 s after commit (idle reconciliation is 30 s)"

# A partial commit: one file staged, one left modified.
echo 'export const sub = (a, b) => a - b;' >src/sub.mjs
echo 'export const add = (a, b) => a + b;' >src/add.mjs
squeal status --wait 60000 >/dev/null 2>&1 || true
git add src/sub.mjs
git commit -q -m "partial"
echo "committed $(git rev-parse --short HEAD) with src/add.mjs left modified"
squeal status --wait 60000 >/dev/null 2>&1 || true
dump "after partial commit and a status wait"
squeal status 2>&1 | head -6
