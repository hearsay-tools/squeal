#!/bin/sh
# Q2/Q3 probe: what `squeal code --base` gives today for a changed helper in a test file that
# only a build wrapper runs, and what it gives once a nodeTest entry lists that file, with the
# build done by hand first (the "prepare" design) and without it. Throwaway. Usage:
#   sh gate-today.sh <squeal-cli.mjs>      (refuses while the one-minute load is above 24)
set -u
CLI=$1
HERE=$(cd "$(dirname "$0")" && pwd)
LOAD=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$LOAD > 24" | bc)" = 1 ]; then echo "load $LOAD > 24: skipped"; exit 0; fi
echo "load at start: $LOAD; cli $CLI"
W=$(mktemp -d /tmp/r174-gate-XXXXXX)
export HOME="$W/home" TMPDIR="$W/tmp"; mkdir -p "$HOME" "$TMPDIR"
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p
mkrepo() { # dir, squeal.config.json body
  cp -r "$HERE/fixture" "$1"; printf '%s\n' "$2" >"$1/squeal.config.json"
  printf 'dist/\nnode_modules/\n' >"$1/.gitignore"
  (cd "$1" && git init -q -b main && git add -A && git commit -qm base)
  # The head edits the helper: one more branch in verify().
  (cd "$1" && sed -i 's|  if (rebrand) assert.match|  if (name === "") throw new Error("empty");\n  if (rebrand) assert.match|' test/e2e/bin.test.mjs && git commit -qam head)
}
gate() { # dir, label
  (cd "$1" && /usr/bin/time -f "%e s wall, %U+%S s cpu" node "$CLI" code --base HEAD~1 --json >"$W/$2.json" 2>"$W/$2.err"; echo "exit $?" >"$W/$2.exit")
  echo "== $2: $(cat "$W/$2.exit"), $(tail -1 "$W/$2.err")"
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log("verdict", r.verdict, JSON.stringify(r.counts ?? {}));
    for (const f of r.functions) console.log(" ", f.path ?? f.identity?.path, f.qualifiedName ?? f.identity?.qualifiedName, f.state, f.gap ?? "", "cc", f.complexity ?? f.cc, "crap", f.crap, "loaders", JSON.stringify(f.loaders ?? {expected: f.expected, measured: f.measured}));
    for (const run of r.runs ?? []) console.log("  run", JSON.stringify(run));
  ' "$W/$2.json" || head -20 "$W/$2.err"
  grep -v "^[0-9.]* s wall" "$W/$2.err" | head -5
}
UNIT='{ "nodeTest": [ { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] } ] }'
PKG='{ "nodeTest": [ { "name": "package", "argv": [], "include": ["test/e2e/*.test.mjs"] } ],
  "checks": [ { "name": "package", "runner": "nodeTest", "project": "package", "at": "manual" } ] }'
mkrepo "$W/no-runner" "$UNIT"
gate "$W/no-runner" 1-no-runner
(cd "$W/no-runner" && node "$CLI" code --base HEAD~1 --test test/e2e/bin.test.mjs >/dev/null 2>"$W/1b.err"; echo "== 1b --test on it: exit $?"; head -3 "$W/1b.err")
mkrepo "$W/group-unbuilt" "$PKG"
gate "$W/group-unbuilt" 2-group-unbuilt
mkrepo "$W/group-built" "$PKG"
(cd "$W/group-built" && node scripts/build.mjs)
gate "$W/group-built" 3-group-built
echo "load at end: $(cut -d' ' -f1 /proc/loadavg)"
echo "kept in $W"
