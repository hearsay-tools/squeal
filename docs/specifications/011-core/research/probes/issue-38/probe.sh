#!/usr/bin/env bash
# Throwaway probe for ../../issue-38.md. Usage: probe.sh <squeal.mjs> <vitest node_modules>
# Builds a three-test repo under a fresh /tmp dir with HOME and XDG_* inside it, sets
# baseline.onStart "lookup-only", passes everything once, then makes files stale two ways:
# (B) a whitespace-only edit of squeal.config.json while the daemon runs, which
# tests/cfg.test.ts names as an input (the issue's shape); (A) an edit of src/lib.js while
# the daemon is stopped, then a lookup-only start. After each it asks status, named waits by
# source and by exact path, retry by source and by exact path, and run --all what they do.
set -u
CLI=$1 NM=$2
T=$(mktemp -d /tmp/issue38.XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run XDG_CONFIG_HOME=$T/home/.config \
  XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache XDG_DATA_HOME=$T/home/.data
unset CLAUDE_SESSION_ID CODEX_THREAD_ID PI_SESSION_ID SQUEAL_SESSION_ID
mkdir -p "$XDG_RUNTIME_DIR" "$T/repo/tests" "$T/repo/src" && chmod 700 "$XDG_RUNTIME_DIR"
cd "$T/repo"
sq() { echo "\$ squeal $*"; timeout 120 node --disable-warning=ExperimentalWarning "$CLI" "$@"; echo "(exit $?)"; }
commit() { git add -A && git -c user.email=p@x -c user.name=p commit -qm "$1"; }
ln -s "$NM" node_modules
printf 'node_modules\n' > .gitignore
echo '{"name":"issue38","private":true,"type":"module"}' > package.json
echo 'export default { test: { include: ["tests/**/*.test.ts"] } };' > vitest.config.ts
echo 'export const v = 1;' > src/lib.js
cat > tests/a.test.ts <<'T'
import { test, expect } from "vitest";
import { v } from "../src/lib.js";
test("a", () => expect(v).toBe(1));
T
cat > tests/b.test.ts <<'T'
import { test, expect } from "vitest";
test("b", () => expect(1).toBe(1));
T
cat > tests/cfg.test.ts <<'T'
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
test("cfg", () => expect(JSON.parse(readFileSync("squeal.config.json", "utf8"))).toBeTruthy());
T
git init -q && commit fixture
echo "== $(node "$CLI" --version) at $(cut -d' ' -f1 /proc/loadavg) load, $(nproc) CPUs, root $T/repo"
sq init >/dev/null
node -e '
const fs=require("fs"); const c=JSON.parse(fs.readFileSync("squeal.config.json","utf8"));
c.baseline={onStart:"lookup-only"}; c.inputs={...(c.inputs??{}),"tests/cfg.test.ts":["squeal.config.json"]};
fs.writeFileSync("squeal.config.json", JSON.stringify(c,null,2)+"\n");'
echo "\$ cat squeal.config.json"; cat squeal.config.json
commit init
sq start
echo "\$ squeal run --all --wait"; timeout 180 node --disable-warning=ExperimentalWarning "$CLI" run --all --wait; echo "(exit $?)"

echo; echo "=== B: whitespace-only edit of squeal.config.json while the daemon runs"
echo "" >> squeal.config.json; echo '$ echo "" >> squeal.config.json'
sleep 3
sq status --wait 30000
sq status
sq status --wait 20000 squeal.config.json
sq status --wait 20000 tests/cfg.test.ts
sq retry squeal.config.json --reason environment
sq run --help
sq run
sq retry tests/cfg.test.ts --reason environment
sq retry tests/cfg.test.ts --reason environment
sq status --wait 60000 tests/cfg.test.ts

echo; echo "=== A: edit src/lib.js while stopped, then a lookup-only start"
sq stop
echo 'export const v = 1; // edit' > src/lib.js; echo '$ echo "export const v = 1; // edit" > src/lib.js'
echo "" >> squeal.config.json; echo '$ echo "" >> squeal.config.json'
sq start
sleep 3
sq status --wait 30000
sq status
sq status --wait 20000 src/lib.js
sq status --wait 20000 tests/a.test.ts
sq retry src/lib.js --reason load
sq retry tests/a.test.ts --reason load
sq retry tests/a.test.ts --reason environment
sq status --wait 60000 src/lib.js
sq status
echo "\$ squeal run --all --wait"; timeout 180 node --disable-warning=ExperimentalWarning "$CLI" run --all --wait; echo "(exit $?)"
sq status --wait 20000 src/lib.js
sq stop
echo "== end load $(cut -d' ' -f1 /proc/loadavg); probe root $T"
