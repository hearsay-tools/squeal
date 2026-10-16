#!/bin/sh
# Throwaway probe for issue 7 (research/issue-7.md). Builds a scratch git
# repository under $1 with a node:test project, a scratch HOME, and real
# stored evidence written by a real Squeal daemon. Never touches the live
# shared store or the real HOME.
# Usage: setup.sh <scratch-dir> <squeal.mjs>
set -eu
S=$1; CLI=$2
mkdir -p "$S/home" "$S/repo/test"
export HOME="$S/home"
cd "$S/repo"
git init -q -b main .
git config user.email probe@example.invalid; git config user.name probe
cat > package.json <<'J'
{ "name": "issue7-probe", "private": true, "type": "module",
  "scripts": { "test": "node --test test/*.test.mjs" } }
J
cat > test/fork.test.mjs <<'J'
import { test } from "node:test";
import assert from "node:assert";
test("parseApplyCheck counts distinct fork-deleted", () => { assert.equal(1 + 1, 2); });
test("applyScan includes a fork-deleted", () => { assert.ok(true); });
J
git add -A; git commit -qm fixture
node "$CLI" init
git add -A; git commit -qm init
node "$CLI" warmup; echo "warmup exit $?"
