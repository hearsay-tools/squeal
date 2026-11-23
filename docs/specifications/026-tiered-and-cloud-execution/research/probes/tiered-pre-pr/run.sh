#!/bin/sh
# Throwaway (026, tiered-pre-pr). Starts the fixture's daemon with HOME and
# XDG_RUNTIME_DIR under $TMPDIR, edits files, and lists the processes the
# daemon started after each step. Usage: run.sh <worktree root> <variant>
set -u
WT=$1; VARIANT=$2
P=$(cd "$(dirname "$0")" && pwd)
BASE=$TMPDIR/tp-$VARIANT
PH=$BASE/home; FX=$BASE/fx
rm -rf "$BASE"; mkdir -p "$PH" "$BASE/run"; chmod 700 "$BASE/run"
sh "$P/make-fixture.sh" "$WT" "$FX" "$VARIANT"
SQ="env HOME=$PH XDG_RUNTIME_DIR=$BASE/run node --disable-warning=ExperimentalWarning $WT/plugins/claude-code/dist/cli/squeal.mjs"
hook() { # entry event extra
  # The fake hook input: a session id and the fixture as the working directory.
  printf '{"session_id":"probe-1","%s":"%s","hook_event_name":"%s"%s}' cwd "$FX" "$2" "${3:-}" |
    env HOME=$PH XDG_RUNTIME_DIR=$BASE/run CLAUDE_PLUGIN_ROOT="$WT/plugins/claude-code" \
    node --disable-warning=ExperimentalWarning "$WT/plugins/claude-code/dist/$1.mjs"
}
ms() { date +%s%3N; }
cd "$FX"
echo "== variant $VARIANT"
t0=$(ms); hook session-start SessionStart ',"source":"startup"' >/dev/null; t1=$(ms)
echo "SessionStart hook: $((t1 - t0)) ms (starts the daemon)"
$SQ status --wait 60000 >/dev/null 2>&1
sleep 5
sh "$P/procs.sh" "$PH" "after start and first status --wait"
$SQ status 2>&1 | sed "s#$FX#<fx>#g"

echo "== edit 1: src/m1.js (a test file's closure), adds an unused variable"
printf 'const unused = 1;\nexport const f1 = (a, b) => a + b + 2;\n' > src/m1.js
t0=$(ms); hook post-tool-batch PostToolBatch | sed "s#$FX#<fx>#g"; t1=$(ms)
echo "PostToolBatch hook after edit 1: $((t1 - t0)) ms"
$SQ status --wait 30000 2>&1 | sed "s#$FX#<fx>#g" | tail -4
sh "$P/procs.sh" "$PH" "after edit 1 settled"

echo "== edit 2: src/complex.js gets more branches"
cat > src/complex.js <<'J'
export function classify(x) {
  if (x > 1) return 1;
  if (x > 2) return 2;
  if (x > 3) return 3;
  if (x > 4 && x < 9) return 4;
  return 0;
}
J
sleep 3
t0=$(ms); hook post-tool-batch PostToolBatch | sed "s#$FX#<fx>#g"; t1=$(ms)
echo "PostToolBatch hook after edit 2: $((t1 - t0)) ms"
$SQ status --wait 30000 2>&1 | sed "s#$FX#<fx>#g" | tail -6
$SQ code 2>&1 | sed "s#$FX#<fx>#g" | head -8
sh "$P/procs.sh" "$PH" "after edit 2 settled"

echo "== 5 more edits, 2 s apart, PostToolBatch latency each"
i=2
while [ $i -le 6 ]; do
  printf 'export const f%s = (a, b) => a + b + %s + 0;\n' $i $i > src/m$i.js
  sleep 2
  t0=$(ms); hook post-tool-batch PostToolBatch >/dev/null; t1=$(ms)
  echo "PostToolBatch hook after edit m$i: $((t1 - t0)) ms"
  i=$((i + 1))
done
$SQ status --wait 30000 >/dev/null 2>&1
sh "$P/procs.sh" "$PH" "after 5 more edits settled"

echo "== squeal run unit src/m1.js --wait 120000 (narrow run)"
t0=$(ms); $SQ run unit src/m1.js --wait 120000 2>&1 | sed "s#$FX#<fx>#g"; t1=$(ms)
echo "narrow run: $((t1 - t0)) ms"
sh "$P/procs.sh" "$PH" "right after the narrow run"
echo "== squeal run unit --wait 120000 (whole group)"
t0=$(ms); $SQ run unit --wait 120000 2>&1 | sed "s#$FX#<fx>#g"; t1=$(ms)
echo "group run: $((t1 - t0)) ms"
sh "$P/procs.sh" "$PH" "right after the group run"
sleep "${IDLE_WAIT:-75}"
sh "$P/procs.sh" "$PH" "${IDLE_WAIT:-75} s after the group run"
echo "== edit 3: README.md only (no test reads it)"
printf '# fixture\nmore\n' > README.md
sleep 4
t0=$(ms); hook post-tool-batch PostToolBatch | sed "s#$FX#<fx>#g"; t1=$(ms)
echo; echo "PostToolBatch hook after edit 3: $((t1 - t0)) ms"
$SQ status --wait 30000 >/dev/null 2>&1
sleep 3
sh "$P/procs.sh" "$PH" "after the README edit settled"
$SQ stop 2>&1 | tail -1
sleep 3
sh "$P/procs.sh" "$PH" "after squeal stop"
