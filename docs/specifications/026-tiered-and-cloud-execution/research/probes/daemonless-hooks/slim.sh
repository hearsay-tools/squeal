#!/bin/sh
# Throwaway (026, daemonless-hooks). Daemon memory on a shallow clone of this
# repository with every test group at "manual", oxlint at "edit", complexity on.
# Variant "today": the full node_modules (Vitest resolves, so the keying host starts).
# Variant "norunner": a node_modules holding only oxlint, so no runner host can
# start and no test closure is loaded: the state moment-aware keying aims at.
# HOME and XDG_RUNTIME_DIR live under $TMPDIR; the daemon is stopped at the end.
# Usage: slim.sh <worktree root> <variant>
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
  printf '{"%s":"probe-1","cwd":"%s","%s":"%s"%s}' "session_id" "$FX" "hook_event_name" "$2" "${3:-}" |
    env HOME=$PH XDG_RUNTIME_DIR=$B/run CLAUDE_PLUGIN_ROOT="$WT/plugins/claude-code" \
    node --disable-warning=ExperimentalWarning "$WT/plugins/claude-code/dist/$1.mjs"
}
ms() { date +%s%3N; }
cd "$FX"
# slim.sh: after the first pass settles (CPU flat for 30 s), idle CPU over 60 s,
# then 5 edits 15 s apart: hook latency and the CPU every probe process used per edit.
cpu() { sh "$P/procs.sh" "$PH" x | awk '/processes/ {print $(NF-1)}'; }
echo "== variant $V (slim)"
hook session-start SessionStart ',"source":"startup"' >/dev/null
$SQ status --wait 300000 >/dev/null 2>&1
prev=-1; i=0
while [ $i -lt 40 ]; do c=$(cpu); [ "$c" = "$prev" ] && break; prev=$c; sleep 30; i=$((i+1)); done
sh "$P/procs.sh" "$PH" "settled (CPU flat for 30 s)"
c0=$(cpu); sleep 60; c1=$(cpu)
echo "idle CPU over 60 s: $c0 -> $c1 s"
n=1
for f in src/core/code/pass/order.ts src/core/code/pass/plan.ts src/core/lint/pass/moment.ts src/core/lint/pass/held.ts src/core/code/pass/head.ts; do
  c0=$(cpu)
  printf '\nconst probeUnused%s = 1;\nexport function probeBranch%s(x: number): number { if (x > 1) return 1; return 0; }\n' $n $n >> "$f"
  sleep 1
  t0=$(ms); hook post-tool-batch PostToolBatch > "$B/hook-$n.json"; t1=$(ms)
  sleep 14
  t2=$(ms); hook post-tool-batch PostToolBatch > "$B/hook-$n-next.json"; t3=$(ms)
  c1=$(cpu)
  echo "edit $n ($f): PostToolBatch $((t1 - t0)) ms, next $((t3 - t2)) ms, CPU $c0 -> $c1 s, load $(cut -d' ' -f1 /proc/loadavg); lint news: $(grep -o 'Lint[^\\]*' "$B/hook-$n.json" "$B/hook-$n-next.json" | head -2 | tr '\n' ' ')"
  n=$((n+1))
done
sh "$P/procs.sh" "$PH" "after 5 edits"
$SQ stop 2>&1 | tail -1
sleep 3
sh "$P/procs.sh" "$PH" "after squeal stop"
