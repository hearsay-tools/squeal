#!/bin/sh
# Throwaway (026, tiered-pre-pr). Runs `squeal code --base main` with no daemon
# in the fixture after a branch edit, for a policy whose test groups are at
# "manual" or "stop". Usage: code-base.sh <worktree root> <variant>
set -u
WT=$1; VARIANT=$2
P=$(cd "$(dirname "$0")" && pwd)
BASE=$TMPDIR/tpc-$VARIANT; PH=$BASE/home; FX=$BASE/fx
rm -rf "$BASE"; mkdir -p "$PH" "$BASE/run"; chmod 700 "$BASE/run"
sh "$P/make-fixture.sh" "$WT" "$FX" "$VARIANT"
SQ="env HOME=$PH XDG_RUNTIME_DIR=$BASE/run node --disable-warning=ExperimentalWarning $WT/plugins/claude-code/dist/cli/squeal.mjs"
cd "$FX"
git checkout -q -b topic
printf 'export const f1 = (a, b) => a + b + 2;\n' > src/m1.js
cat > src/complex.js <<'J'
export function classify(x) {
  if (x > 1) return 1;
  if (x > 2) return 2;
  if (x > 3) return 3;
  return 0;
}
J
printf '{ "n": 1 }\n' > src/data.json
git add -A && git -c user.email=p@p -c user.name=p commit -qm topic
echo "== variant $VARIANT: squeal code --base main"
$SQ code --base main 2>&1 | sed "s#$FX#<fx>#g; s#$TMPDIR#\$TMPDIR#g"; echo "[exit $?]"
echo "== squeal code --base main --group unit"
$SQ code --base main --group unit 2>&1 | sed "s#$FX#<fx>#g; s#$TMPDIR#\$TMPDIR#g"; echo "[exit $?]"
$SQ stop >/dev/null 2>&1
sh "$P/procs.sh" "$PH" "leftover processes"
