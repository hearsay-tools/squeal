#!/usr/bin/env bash
# Throwaway (018-01). Builds a small Vitest fixture repository under $1 as
# a bare "origin", the way a CI runner would see a remote. Two passing test
# files and one failing one. Vitest comes from the e2e harness's install
# cache (/tmp/squeal-e2e-cache), copied, never written.
set -euo pipefail
base=$1
cache=/tmp/squeal-e2e-cache/vitest-5.0.3-vite-8.3.2-node24-linux-x64
src=$base/src-repo
rm -rf "$src" "$base/origin.git"
mkdir -p "$src/src" "$src/test"
cp "$cache/package.json" "$cache/package-lock.json" "$src/"
printf 'node_modules\n' >"$src/.gitignore"
printf 'export default { test: {} };\n' >"$src/vitest.config.ts"
printf 'export const add = (a: number, b: number) => a + b;\n' >"$src/src/math.ts"
printf 'export const up = (s: string) => s.toUpperCase();\n' >"$src/src/strings.ts"
cat >"$src/test/math.test.ts" <<'EOF'
import { expect, it } from "vitest";
import { add } from "../src/math.js";
it("adds", () => { expect(add(1, 2)).toBe(3); });
EOF
cat >"$src/test/strings.test.ts" <<'EOF'
import { expect, it } from "vitest";
import { up } from "../src/strings.js";
it("uppers", () => { expect(up("a")).toBe("A"); });
EOF
cat >"$src/test/broken.test.ts" <<'EOF'
import { expect, it } from "vitest";
import { add } from "../src/math.js";
it("is broken on purpose", () => { expect(add(2, 2)).toBe(5); });
EOF
git -C "$src" init -q -b main
git -C "$src" add -A
git -C "$src" -c user.name=probe -c user.email=probe@invalid commit -qm "fixture: two passing, one failing"
# A second commit, so a depth-1 clone is really shallow.
printf '// second commit\n' >>"$src/src/strings.ts"
git -C "$src" -c user.name=probe -c user.email=probe@invalid commit -qam "fixture: touch strings"
git clone -q --bare "$src" "$base/origin.git"
echo "origin: $base/origin.git"
