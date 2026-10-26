#!/usr/bin/env bash
# Throwaway: writes the issue-106 fixtures under /tmp/issue-106. Arg 1: the squeal worktree (for node_modules).
set -euo pipefail
WT=$1; R=/tmp/issue-106
mkdir -p $R/home/run $R/home/.config; chmod 700 $R/home/run
helper='export function classify(n) {
  if (n < 0) return "negative";
  if (n === 0) return "zero";
  return n > 10 ? "big" : "small";
}
export function unused(x) {
  return x ?? 1;
}'
init() { cd "$1"; git init -q; git add -A; git -c user.email=p@p -c user.name=p commit -qm fixture; }
for c in a-preload b-plain; do
  rm -rf $R/$c; mkdir -p $R/$c/scripts; cd $R/$c
  echo "$helper" > scripts/helper.mjs
  cat > scripts/helper.test.mjs <<'T'
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./helper.mjs";
test("classify", () => {
  assert.equal(classify(-1), "negative");
  assert.equal(classify(0), "zero");
  assert.equal(classify(5), "small");
  assert.equal(classify(50), "big");
});
T
  echo '{"name":"fx","type":"module","private":true}' > package.json
  if [ $c = a-preload ]; then
    printf 'import { classify } from "./helper.mjs";\nglobalThis.__kind = classify(1);\n' > scripts/preload.mjs
    argv='"argv": ["--import", "./scripts/preload.mjs"],'
  else argv=''; fi
  cat > squeal.config.json <<J
{ "nodeTest": [ { "name": "unit", $argv "include": ["scripts/*.test.mjs"] } ] }
J
  init $R/$c
done
c=c-vitest; rm -rf $R/$c; mkdir -p $R/$c/src $R/$c/test; cd $R/$c
echo "$helper" | sed 's/(n)/(n: number)/; s/(x)/(x?: number)/' > src/helper.ts
cat > test/helper.test.ts <<'T'
import { expect, test } from "vitest";
import { classify } from "../src/helper.js";
test("classify", () => {
  expect(classify(-1)).toBe("negative");
  expect(classify(0)).toBe("zero");
  expect(classify(5)).toBe("small");
  expect(classify(50)).toBe("big");
});
T
printf 'import { classify } from "./src/helper.js";\n(globalThis as Record<string, unknown>).__kind = classify(1);\n' > setup.ts
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { setupFiles: ["./setup.ts"] } });\n' > vitest.config.ts
echo '{"name":"fx","type":"module","private":true}' > package.json
echo '{}' > squeal.config.json
echo node_modules > .gitignore
ln -s "$WT/node_modules" node_modules
init $R/$c
# d-two-projects: a-preload plus a second project in packages/p whose preload is the same file (cezarion's shape).
c=d-two-projects; rm -rf $R/$c; cp -r $R/a-preload $R/$c; cd $R/$c; rm -rf .git
mkdir -p packages/p/test
echo '{"name":"p","type":"module","private":true}' > packages/p/package.json
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("kind", () => assert.equal(globalThis.__kind, "small"));\n' > packages/p/test/kind.test.mjs
cat > squeal.config.json <<'J'
{ "nodeTest": [
  { "name": "p:unit", "cwd": "packages/p", "argv": ["--import", "../../scripts/preload.mjs"], "include": ["test/*.test.mjs"] },
  { "name": "root:unit", "argv": ["--import", "./scripts/preload.mjs"], "include": ["scripts/*.test.mjs"] } ] }
J
init $R/$c
# e-order: b-plain without its test file at the start; run.md adds the test file after the helper is judged.
c=e-order; rm -rf $R/$c; cp -r $R/b-plain $R/$c; cd $R/$c; rm -rf .git
mv scripts/helper.test.mjs ../e-order.helper.test.mjs.later
printf 'import { test } from "node:test";\ntest("other", () => {});\n' > scripts/other.test.mjs
init $R/$c
