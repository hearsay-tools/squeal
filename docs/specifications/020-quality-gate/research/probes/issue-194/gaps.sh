#!/bin/sh
# Issue #194 gaps probe (row 020-33; synthetic, throwaway). Reuses ./fixture. Every repository lives
# under one mktemp -d in /tmp, with its own HOME, XDG dirs and TMPDIR (env -i): nothing reaches the real HOME.
# Usage:  sh gaps.sh <squeal.mjs>
# Refuses when the one-minute load is 24 or more (the row's limit).
set -u
CLI=$1
HERE=$(cd "$(dirname "$0")" && pwd)
LOAD=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$LOAD >= 24" | bc)" = 1 ]; then echo "load $LOAD >= 24: skipped"; exit 0; fi
W=$(mktemp -d /tmp/r194g-XXXXXX)
mkdir -p "$W/home" "$W/run" "$W/config" "$W/tmp"
chmod 700 "$W/run"
E="env -i PATH=$PATH HOME=$W/home XDG_RUNTIME_DIR=$W/run XDG_CONFIG_HOME=$W/config TMPDIR=$W/tmp GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p"
echo "load at start: $LOAD on $(getconf _NPROCESSORS_ONLN) CPUs; node $(node --version); cli $CLI ($($E node "$CLI" --version))"

EDIT='s|    if (name.startsWith("@private/")) continue;|    if (name.startsWith("@private/")) continue;\n    if (name === "") throw new Error("empty name");|'
mkrepo() { # dir, squeal.config.json body: base commit, then a head that edits only publish()
  cp -r "$HERE/fixture" "$1"; printf '%s\n' "$2" >"$1/squeal.config.json"
  printf 'dist/\nnode_modules/\n' >"$1/.gitignore"; rm "$1/test/e2e/release-inproc.alt"
  (cd "$1" && $E git init -q -b main && $E git add -A && $E git commit -qm base \
    && sed -i "$EDIT" scripts/release.mjs && $E git commit -qam head-release-only)
}
gate() { # dir, label, extra args
  d=$1; l=$2; shift 2
  (cd "$d" && $E /usr/bin/time -f "%e s wall" node "$CLI" code --base HEAD~1 --json "$@" >"$W/$l.json" 2>"$W/$l.err"; echo "exit $?" >"$W/$l.exit")
  echo "== $l: $(cat "$W/$l.exit"), $(tail -1 "$W/$l.err")"
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log("  verdict", r.verdict, JSON.stringify(r.counts ?? {}));
    for (const f of r.functions) console.log("  ", f.path, f.qualifiedName ?? f.name, f.state, f.gap ?? "", "loaders", JSON.stringify(f.loaders ?? null));
    for (const run of r.runs ?? []) console.log("   run", run.runner, "selected", JSON.stringify(run.selected), "children", JSON.stringify(run.children ?? null));
  ' "$W/$l.json" 2>/dev/null || echo "  (no JSON on stdout)"
  echo "  stderr:"; grep -v "^[0-9.]* s wall" "$W/$l.err" | sed 's/^/    /' | cut -c1-260 | head -12
}
UNIT='{ "coverage": { "enabled": true, "children": CHILDREN }, "nodeTest": [ { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] } ] }'
PKG='{ "coverage": { "enabled": true, "children": CHILDREN }, INPUTS "nodeTest": [
  { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] },
  { "name": "package", "argv": [], "include": ["test/e2e/*.test.mjs"] PREPARE } ] }'
cfg() { # children, inputs fragment, prepare fragment
  echo "$PKG" | sed "s|CHILDREN|$1|; s|INPUTS|$2|; s|PREPARE|$3|"
}
PREP=', "prepare": { "command": ["node", "scripts/build.mjs"], "timeoutSeconds": 60 }'
MAP='"inputs": { "test/e2e/*.test.mjs": ["scripts/*.mjs"] },'

echo "### G1: two entries, prepare, children FALSE, publish() only edited (Q1: is the second entry the cause?)"
mkrepo "$W/g1" "$(cfg false '' "$PREP")"; gate "$W/g1" G1
echo "### G2: one unit entry, children TRUE, publish() only edited (Q1: is coverage.children the cause?)"
mkrepo "$W/g2" "$(echo "$UNIT" | sed s/CHILDREN/true/)"; gate "$W/g2" G2
echo "### G3: one unit entry, children FALSE, publish() only edited (case 8 control)"
mkrepo "$W/g3" "$(echo "$UNIT" | sed s/CHILDREN/false/)"; gate "$W/g3" G3
echo "### G4: case 6 plus a test-glob inputs map naming scripts/*.mjs at base and head (Q2: do declared inputs select?)"
mkrepo "$W/g4" "$(cfg true "$MAP" "$PREP")"; gate "$W/g4" G4
echo "### G5: G4 with --test (control: the run completes publish())"
gate "$W/g4" G5 --test test/e2e/release.test.mjs

echo "### G6: daemon evidence. Package entry WITHOUT prepare (the daemon opens it), children true, dist built by hand."
mkrepo "$W/g6" "$(cfg true '' '')"
(cd "$W/g6" && $E git reset -q --hard HEAD~1 && $E node scripts/build.mjs)
(cd "$W/g6" && $E node "$CLI" daemon "$W/g6" >"$W/g6.daemon.log" 2>&1 & echo $! >"$W/g6.pid")
sleep 3
(cd "$W/g6" && $E timeout 120 node "$CLI" run --all --wait >"$W/g6.run" 2>&1; echo "  run --all --wait (the fixture's two test files) exit $?"; head -4 "$W/g6.run" | cut -c1-200)
(cd "$W/g6" && $E timeout 60 node "$CLI" status --wait 30000 test/e2e/release.test.mjs >"$W/g6.status" 2>&1; echo "  status exit $?"; head -4 "$W/g6.status" | cut -c1-200)
(cd "$W/g6" && $E node "$CLI" reach scripts/release.mjs --json >"$W/g6.reach.json" 2>"$W/g6.reach.err"; echo "  reach exit $?")
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = JSON.stringify(r); const i = s.indexOf("child process");
  console.log("  reach names \"child process\":", i >= 0, i >= 0 ? s.slice(Math.max(0, i - 220), i + 40) : "");
' "$W/g6.reach.json" 2>/dev/null || { echo "  (reach JSON unreadable)"; head -5 "$W/g6.reach.err"; }
kill -TERM "$(cat "$W/g6.pid")" 2>/dev/null; sleep 2; kill -KILL "$(cat "$W/g6.pid")" 2>/dev/null
echo "### G7: the gate on G6's repository after the daemon stopped, publish() only edited (Q2: do stored observed reads select?)"
(cd "$W/g6" && sed -i "$EDIT" scripts/release.mjs && $E git commit -qam head-release-only)
gate "$W/g6" G7
echo "load at end: $(cut -d' ' -f1 /proc/loadavg)"
echo "daemon log tail:"; tail -5 "$W/g6.daemon.log" | cut -c1-200
pgrep -f "$W" >/dev/null && echo "LEFTOVER processes under $W" || echo "no leftover processes"
echo "kept in $W"
