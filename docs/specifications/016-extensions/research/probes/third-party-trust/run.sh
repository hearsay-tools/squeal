#!/usr/bin/env bash
# Throwaway probe for research 016-06 Q3. Usage: run.sh <worktree root>.
# Builds everything under a fresh /tmp scratch directory with its own HOME,
# XDG and TMPDIR; writes nothing outside it; removes it at the end.
set -euo pipefail
ROOT=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
S=$(mktemp -d /tmp/tpt-probe.XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config TMPDIR=$S/tmp
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$TMPDIR" "$S/bin" "$S/wt" "$S/out"
gcc -O1 -o "$S/bin/reader-dyn" "$HERE/reader.c"
gcc -O1 -static -o "$S/bin/reader-static" "$HERE/reader.c"
gcc -O1 -shared -fPIC -o "$S/bin/shim.so" "$HERE/shim.c" -ldl
mkdir -p "$S/rec" && cp "$ROOT"/src/runners/observe/*.cjs "$S/rec/"
cd "$S/wt"
for f in node py dyn static env sh; do echo "$f" > "data-$f.txt"; done
cp "$HERE/fake.test.cjs" .
export PROBE_BIN=$S/bin
file "$S/bin/reader-dyn" "$S/bin/reader-static" | sed "s|$S|\$S|g" | cut -c1-110

echo "== A. Squeal's Node recorder (src/runners/observe/recorder.cjs), as --require"
SQUEAL_OBSERVE="{\"out\":\"$S/out\",\"root\":\"$S/wt\",\"skip\":[],\"file\":\"fake.test.cjs\"}" \
  NODE_OPTIONS="--require $S/rec/recorder.cjs" node fake.test.cjs
cat "$S"/out/*.ndjson | node -e '
  const seen = { f: new Set(), w: new Set() };
  for (const line of require("fs").readFileSync(0, "utf8").trim().split("\n")) {
    const r = JSON.parse(line); for (const k of ["f", "w"]) for (const p of r[k] ?? []) seen[k].add(p);
  }
  console.log("recorded reads:", [...seen.f].map((p) => p.replace(process.argv[1] + "/", "")).sort().join(" "));
' "$S/wt"

echo "== B. strace -f (ptrace), same test, no recorder"
strace -f -qq -e trace=open,openat,execve -o "$S/strace.log" node fake.test.cjs > /dev/null
echo "data files strace saw opened:" $(grep -o 'data-[a-z]*\.txt' "$S/strace.log" | sort -u)

echo "== C. LD_PRELOAD shim on the two C readers"
LD_PRELOAD=$S/bin/shim.so "$S/bin/reader-dyn" data-dyn.txt 2>&1 | grep -E 'shim\] open data|read ' || true
LD_PRELOAD=$S/bin/shim.so "$S/bin/reader-static" data-static.txt 2>&1 | grep -E 'shim\] open data|read ' || true

cd /; rm -rf "$S"; test ! -e "$S" && echo "scratch removed: $S"
