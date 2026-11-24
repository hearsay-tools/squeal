#!/bin/sh
# Throwaway (026, daemonless-hooks). Daemon memory on a shallow clone of this
# repository with every test group at "manual", oxlint at "edit", complexity on.
# Variant "today": the full node_modules (Vitest resolves, so the keying host starts).
# Variant "norunner": a node_modules holding only oxlint, so no runner host can
# start and no test closure is loaded: the state moment-aware keying aims at.
# HOME and XDG_RUNTIME_DIR live under $TMPDIR; the daemon is stopped at the end.
# Usage: mem.sh <worktree root> <variant>
set -u
WT=$1; V=$2
P=$(cd "$(dirname "$0")" && pwd)
B=$TMPDIR/dlh/mem-$V; PH=$B/home; FX=$B/fx
rm -rf "$B"; mkdir -p "$PH" "$B/run"; chmod 700 "$B/run"
git clone -q --depth 1 "file://$WT" "$FX"
if [ "$V" = norunner ]; then
  mkdir -p "$B/nm"; ln -s "$(readlink -f "$WT/node_modules/oxlint")" "$B/nm/oxlint"; ln -s "$B/nm" "$FX/node_modules"
else
  ln -s "$WT/node_modules" "$FX/node_modules"
fi
printf '{ "plugins": ["typescript", "unicorn", "oxc"], "categories": { "correctness": "error" } }\n' > "$FX/.oxlintrc.json"
node -e '
const fs = require("fs"); const p = process.argv[1]; const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.checks = [{ name: "unit", runner: "vitest", at: "manual" }, { name: "lint", lint: ["oxlint"], at: "edit" }];
c.lint = { enabled: true, tools: ["oxlint"] };
fs.writeFileSync(p, JSON.stringify(c, null, 2));' "$FX/squeal.config.json"
( cd "$FX" && git add -A && git -c user.email=p@p -c user.name=p commit -qm probe-config )
SQ="env HOME=$PH XDG_RUNTIME_DIR=$B/run node --disable-warning=ExperimentalWarning $WT/plugins/claude-code/dist/cli/squeal.mjs"
hook() {
  {
    printf '{"session_id":"probe-1",'
    printf '"cwd":"%s","hook_event_name":"%s"%s}' "$FX" "$2" "${3:-}"
  } |
    env HOME=$PH XDG_RUNTIME_DIR=$B/run CLAUDE_PLUGIN_ROOT="$WT/plugins/claude-code" \
    node --disable-warning=ExperimentalWarning "$WT/plugins/claude-code/dist/$1.mjs"
}
ms() { date +%s%3N; }
cd "$FX"
echo "== variant $V"
hook session-start SessionStart ',"source":"startup"' >/dev/null
t0=$(ms); $SQ status --wait 300000 >/dev/null 2>&1; t1=$(ms)
echo "first status --wait: $((t1 - t0)) ms"
sh "$P/procs.sh" "$PH" "settled after start"
sleep 60
sh "$P/procs.sh" "$PH" "60 s later"
$SQ status 2>&1 | sed "s#$FX#<fx>#g" | head -12
echo "== edit: src/core/code/count/walk.ts gains an unused variable and a branch"
printf '\nconst probeUnused = 1;\nexport function probeBranch(x: number): number { if (x > 1) return 1; return 0; }\n' >> src/core/code/count/walk.ts
sleep 2
t0=$(ms); hook post-tool-batch PostToolBatch | sed "s#$FX#<fx>#g" | head -12; t1=$(ms)
echo "PostToolBatch: $((t1 - t0)) ms"
$SQ status --wait 60000 >/dev/null 2>&1
sh "$P/procs.sh" "$PH" "edit settled"
sleep 20
t0=$(ms); hook post-tool-batch PostToolBatch | sed "s#$FX#<fx>#g" | head -12; t1=$(ms)
echo "PostToolBatch (next): $((t1 - t0)) ms"
sh "$P/procs.sh" "$PH" "20 s after the edit"
sleep "${IDLE_WAIT:-120}"
sh "$P/procs.sh" "$PH" "${IDLE_WAIT:-120} s idle after the edit"
$SQ stop 2>&1 | tail -1
sleep 3
sh "$P/procs.sh" "$PH" "after squeal stop"
