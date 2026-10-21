#!/usr/bin/env bash
# Throwaway probe for research 011-52. Makes a scratch under /tmp with its own HOME, XDG dirs
# and TMPDIR, installs vitest@4.1.10 there, writes two copies of a two-test project (4 files),
# and runs two-roots.mjs in the modes bare, one and two. Removes the scratch at the end.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
S=$(mktemp -d /tmp/ds-scope-XXXXXX)
trap 'rm -rf "$S"' EXIT
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$TMPDIR"
mkdir -p "$S/a/test"
cat > "$S/a/package.json" <<'J'
{ "name": "ds-scope", "private": true, "type": "module" }
J
cat > "$S/a/vitest.config.mjs" <<'J'
export default { test: { include: ["test/**/*.test.mjs"] } };
J
cat > "$S/a/test/cwd.test.mjs" <<'J'
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
// A test that reads a fixture by a relative path, as many projects do.
test("the cwd is this project's root", () => {
  expect(existsSync("fixture.txt")).toBe(true);
  expect(readFileSync("fixture.txt", "utf8").trim()).toBe(process.env.ROOT_NAME ?? readFileSync(new URL("../fixture.txt", import.meta.url), "utf8").trim());
});
J
cat > "$S/a/test/plain.test.mjs" <<'J'
import { test, expect } from "vitest";
test("adds", () => expect(1 + 1).toBe(2));
J
echo a > "$S/a/fixture.txt"
(cd "$S/a" && npm install --no-audit --no-fund --silent vitest@4.1.10 >/dev/null 2>&1)
cp -r "$S/a" "$S/b"; echo b > "$S/b/fixture.txt"
echo "load1 $(cut -d' ' -f1 /proc/loadavg)  node $(node -v)  vitest $(node -p "require('$S/a/node_modules/vitest/package.json').version")"
for mode in bare one two; do
  echo "== $mode"
  node --expose-gc "$here/two-roots.mjs" $mode "$S/a" "$S/b" 2>&1 | grep -E '^\{|✓|×|FAIL|expected' | head -40
done
