#!/usr/bin/env bash
# Throwaway (019-04): a small repository with 40 source and 40 test files and 12 commits
# that each edit one to three files, to replay through sync.sh. Usage: make-fixture.sh <dir>
set -euo pipefail
D=$1; rm -rf "$D"; mkdir -p "$D/src" "$D/test"; cd "$D"; git init -q
printf '{"name":"fixture","type":"module","devDependencies":{"vitest":"5.0.3"}}\n' > package.json
for i in $(seq 1 40); do
  { for j in $(seq 1 60); do echo "export const v${i}_${j} = ${j} * ${i}; // line $j of module $i"; done; } > "src/m$i.ts"
  printf 'import { test, expect } from "vitest";\nimport { v%s_1 } from "../src/m%s";\ntest("m%s", () => expect(v%s_1).toBe(%s));\n' $i $i $i $i $i > "test/m$i.test.ts"
done
git add -A; git -c user.email=p@p -c user.name=p commit -qm base
for c in $(seq 1 12); do
  n=$(( (c % 3) + 1 ))
  for k in $(seq 1 $n); do f="src/m$(( (c*7+k) % 40 + 1 )).ts"; sed -i "$(( (c+k) % 60 + 1 ))s/\$/ \/\/ edit $c/" "$f"; done
  git add -A; git -c user.email=p@p -c user.name=p commit -qm "edit $c"
done
