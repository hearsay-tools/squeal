#!/bin/sh
# Issue #194 probe (synthetic, throwaway). Temporary git repositories from ./fixture under one mktemp -d,
# with TMPDIR inside it. The head edits publish() in scripts/release.mjs and a callback in
# test/e2e/release.test.mjs. Usage:  sh run.sh <squeal.mjs> [<older squeal.mjs>]
# Refuses when the one-minute load is above the CPU count.
set -u
CLI=$1; OLD=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
LOAD=$(cut -d' ' -f1 /proc/loadavg); CPUS=$(getconf _NPROCESSORS_ONLN)
if [ "$(echo "$LOAD > $CPUS" | bc)" = 1 ]; then echo "load $LOAD > $CPUS CPUs: skipped"; exit 0; fi
echo "load at start: $LOAD on $CPUS CPUs; node $(node --version); cli $CLI"
W=$(mktemp -d /tmp/r194-XXXXXX)
export TMPDIR="$W/tmp"; mkdir -p "$TMPDIR"
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p
mkrepo() { # dir, squeal.config.json body, variant (child|inproc)
  cp -r "$HERE/fixture" "$1"; printf '%s\n' "$2" >"$1/squeal.config.json"
  printf 'dist/\nnode_modules/\n' >"$1/.gitignore"
  if [ "$3" = inproc ]; then mv "$1/test/e2e/release-inproc.alt" "$1/test/e2e/release.test.mjs"; else rm "$1/test/e2e/release-inproc.alt"; fi
  (cd "$1" && git init -q -b main && git add -A && git commit -qm base)
  # Head: one more branch in publish() and one more branch in the test callback's loop.
  (cd "$1" && sed -i 's|    if (name.startsWith("@private/")) continue;|    if (name.startsWith("@private/")) continue;\n    if (name === "") throw new Error("empty name");|' scripts/release.mjs \
    && sed -i 's|    assert.match(line, /^would publish/);|    assert.match(line, /^would publish/);\n    if (line.endsWith("@private/b")) assert.fail("private package published");|' test/e2e/release.test.mjs \
    && git commit -qam head)
}
gate() { # dir, label, extra args
  d=$1; l=$2; shift 2
  (cd "$d" && /usr/bin/time -f "%e s wall" node "$CLI" code --base HEAD~1 --json "$@" >"$W/$l.json" 2>"$W/$l.err"; echo "exit $?" >"$W/$l.exit")
  echo "== $l: $(cat "$W/$l.exit"), $(tail -1 "$W/$l.err")"
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log("verdict", r.verdict, JSON.stringify(r.counts ?? {}));
    for (const f of r.functions) console.log(" ", f.path ?? f.identity?.path, f.qualifiedName ?? f.identity?.qualifiedName ?? f.name, f.state, f.gap ?? "", "cc", f.cc ?? f.complexity, "cov", JSON.stringify(f.coverage ?? null), "crap", f.crap, "loaders", JSON.stringify(f.loaders ?? null));
    for (const run of r.runs ?? []) console.log("  run", JSON.stringify(run));
  ' "$W/$l.json" 2>/dev/null || echo "  (no JSON on stdout)"
  echo "  stderr:"; grep -v "^[0-9.]* s wall" "$W/$l.err" | sed 's/^/    /' | head -12
}
UNIT='{ "coverage": { "enabled": true }, "nodeTest": [ { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] } ] }'
PKG='{ "coverage": { "enabled": true, "children": CHILDREN }, "nodeTest": [
  { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] },
  { "name": "package", "argv": [], "include": ["test/e2e/*.test.mjs"], "prepare": { "command": ["node", "scripts/build.mjs"], "timeoutSeconds": 60 } } ] }'

echo "### Case 1: #194's shape, no runner lists test/e2e (child variant)"
mkrepo "$W/c1" "$UNIT" child
(cd "$W/c1" && npm run -s test:package >/dev/null 2>&1; echo "== 1a project's own suite: npm run test:package exit $?")
gate "$W/c1" 1b-gate
(cd "$W/c1" && node "$CLI" code --base HEAD~1 --test test/e2e/release.test.mjs >/dev/null 2>"$W/1c.err"; echo "== 1c --test test/e2e/release.test.mjs: exit $?"; head -3 "$W/1c.err")
if [ -n "$OLD" ]; then
  (cd "$W/c1" && node "$OLD" code --base HEAD~1 --json >/dev/null 2>"$W/1d.err"; echo "== 1d reported version gate: exit $?"; grep -v '^$' "$W/1d.err" | head -6)
  (cd "$W/c1" && node "$OLD" code --base HEAD~1 --test test/e2e/release.test.mjs >/dev/null 2>"$W/1e.err"; echo "== 1e reported version --test: exit $?"; head -3 "$W/1e.err")
fi

echo "### Case 2: package entry with prepare at the base, coverage.children true, child variant"
mkrepo "$W/c2" "$(echo "$PKG" | sed s/CHILDREN/true/)" child
gate "$W/c2" 2-gate
echo "### Case 3: as case 2 with coverage.children false"
mkrepo "$W/c3" "$(echo "$PKG" | sed s/CHILDREN/false/)" child
gate "$W/c3" 3-gate
echo "### Case 4: as case 2, in-process variant (the test imports publish)"
mkrepo "$W/c4" "$(echo "$PKG" | sed s/CHILDREN/true/)" inproc
gate "$W/c4" 4-gate
echo "### Case 5: as case 2, --test on the packaged file"
gate "$W/c2" 5-gate-test --test test/e2e/release.test.mjs
echo "### Case 6: as case 2 (children true, child variant), but the head edits only publish(), not the test"
mkrepo "$W/c6" "$(echo "$PKG" | sed s/CHILDREN/true/)" child
(cd "$W/c6" && git reset -q --hard HEAD~1 && sed -i 's|    if (name.startsWith("@private/")) continue;|    if (name.startsWith("@private/")) continue;\n    if (name === "") throw new Error("empty name");|' scripts/release.mjs && git commit -qam head-release-only)
gate "$W/c6" 6-gate
echo "### Case 7: case 6 with --test on the packaged file"
gate "$W/c6" 7-gate-test --test test/e2e/release.test.mjs
echo "### Case 8: unit-only config (case 1), head edits only publish()"
mkrepo "$W/c8" "$UNIT" child
(cd "$W/c8" && git reset -q --hard HEAD~1 && sed -i 's|    if (name.startsWith("@private/")) continue;|    if (name.startsWith("@private/")) continue;\n    if (name === "") throw new Error("empty name");|' scripts/release.mjs && git commit -qam head-release-only)
gate "$W/c8" 8-gate
echo "### Case 9: case 6 with the package entry's prepare removed in the working tree (does prepare hide the hint?)"
(cd "$W/c6" && node -e 'const f="squeal.config.json",c=JSON.parse(require("fs").readFileSync(f));delete c.nodeTest[1].prepare;require("fs").writeFileSync(f,JSON.stringify(c))')
gate "$W/c6" 9-gate
(cd "$W/c6" && git checkout -q squeal.config.json)
echo "load at end: $(cut -d' ' -f1 /proc/loadavg)"
echo "kept in $W"
