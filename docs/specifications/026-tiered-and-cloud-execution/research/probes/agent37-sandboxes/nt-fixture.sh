#!/bin/sh
# Throwaway (026 agent37-sandboxes). A one-file node:test fixture at ~/nt for driver.mjs nodetest.
mkdir -p ~/nt/test && cd ~/nt
printf '{"name":"nt","private":true,"type":"module"}\n' > package.json
cat > test/cli.test.mjs <<'T'
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("spawns a child and reads its output", () => {
  assert.equal(execFileSync(process.execPath, ["-e", "console.log(6*7)"]).toString().trim(), "42");
});
T
git init -q && git add -A && git -c user.email=p@x -c user.name=p commit -qm fixture && echo nt-ready
