#!/usr/bin/env bash
# Throwaway probe for ../../issue-36.md. Usage: probe.sh <squeal.mjs> <touches> <vitest node_modules>
# Builds a two-test repo under a fresh /tmp dir with HOME and XDG_* inside it, makes
# tests/a.test.ts end `unknown` by rewriting the git-ignored dist/lib.js it imports with
# the same bytes during its run (task 001-159's "written during this run and ended as
# it was"), then asks retry, a named wait and run --all what they do with that file.
set -u
CLI=$1 TOUCHES=$2 NM=$3 MODE=${4:-baseline}
T=$(mktemp -d /tmp/issue36.XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run XDG_CONFIG_HOME=$T/home/.config \
  XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache XDG_DATA_HOME=$T/home/.data
mkdir -p "$XDG_RUNTIME_DIR" "$T/repo/tests" "$T/repo/dist" && chmod 700 "$XDG_RUNTIME_DIR"
cd "$T/repo"
sq() { echo "\$ squeal $*"; node --disable-warning=ExperimentalWarning "$CLI" "$@"; echo "(exit $?)"; }
# outside the worktree, so never keyed; MODE=edit touches only after an edit to a.test.ts
if [ "$MODE" = edit ]; then echo 0; else echo "$TOUCHES"; fi > "$T/touches"
ln -s "$NM" node_modules
printf 'node_modules\ndist/\n' > .gitignore
echo '{"name":"issue36","private":true,"type":"module"}' > package.json
echo 'export default { test: { include: ["tests/**/*.test.ts"] } };' > vitest.config.ts
echo 'export const v = 1;' > dist/lib.js
cat > tests/ok.test.ts <<'T'
import { test, expect } from "vitest";
test("ok", () => expect(1).toBe(1));
T
cp tests/ok.test.ts tests/b.test.ts
cat > tests/a.test.ts <<T
import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "vitest";
import { v } from "../dist/lib.js";
test("a", async () => {
  const n = Number(readFileSync("$T/touches", "utf8"));
  if (n > 0) {
    writeFileSync("$T/touches", String(n - 1));
    writeFileSync(new URL("../dist/lib.js", import.meta.url), "export const v = 1;\n");
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(v).toBe(1);
});
T
git init -q && git add -A && git -c user.email=p@x -c user.name=p commit -qm fixture
echo "== $(node "$CLI" --version) at $(cat /proc/loadavg | cut -d' ' -f1) load, $(nproc) CPUs, root $T/repo"
sq init >/dev/null
git add -A && git -c user.email=p@x -c user.name=p commit -qm init
sq start
echo "\$ squeal run --all --wait"; timeout 180 node --disable-warning=ExperimentalWarning "$CLI" run --all --wait; echo "(run --all --wait exit $?)"
if [ "$MODE" = edit ]; then
  echo "$TOUCHES" > "$T/touches"; echo "// edit" >> tests/a.test.ts; echo "\$ echo // edit >> tests/a.test.ts"
  sleep 2; sq status --wait 60000
fi
echo "touches left: $(cat "$T/touches")"
sq status
sq retry tests/a.test.ts --reason environment
sq retry tests/a.test.ts --reason load
sq status --wait 20000 tests/a.test.ts
echo 0 > "$T/touches"
echo "\$ squeal run --all --wait"; timeout 180 node --disable-warning=ExperimentalWarning "$CLI" run --all --wait; echo "(run --all --wait exit $?)"
sq status
sq stop
echo "== probe root $T"
