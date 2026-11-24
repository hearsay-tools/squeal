#!/bin/sh
# Throwaway (026, daemonless-hooks). Daemon memory on a shallow clone of this
# repository with every test group at "manual", oxlint at "edit", complexity on.
# Variant "today": the full node_modules (Vitest resolves, so the keying host starts).
# Variant "norunner": a node_modules holding only oxlint, so no runner host can
# start and no test closure is loaded: the state moment-aware keying aims at.
# HOME and XDG_RUNTIME_DIR live under $TMPDIR; the daemon is stopped at the end.
# Usage: restart.sh <worktree root> <variant>
set -u
WT=$1; V=$2
P=$(cd "$(dirname "$0")" && pwd)
B=$TMPDIR/dlh/restart-$V; PH=$B/home; FX=$B/fx
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
c.lint = { enabled: true, tools: ["oxlint"] }; c.daemon = { unusedExitMinutes: 0.5 };
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
# restart.sh: the "norunner" daemon with daemon.unusedExitMinutes 0.5, so it
# stops 30 s after its last use and the next hook starts it again: a
# fire-and-exit helper made of today's daemon. Samples every probe process
# once a second and keeps each pid's last CPU, so a process that exits keeps
# the CPU it had used one second before.
SAMPLES=$B/samples.txt; : > "$SAMPLES"
sample() { # appends "pid cpu_ticks rss_kb name" for every probe process
  for d in /proc/[0-9]*; do
    if { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "HOME=$PH"; then
      s=$(awk '{print $14+$15+$16+$17}' "$d/stat" 2>/dev/null); r=$(awk '/^VmRSS/ {print $2}' "$d/status" 2>/dev/null)
      n=$({ tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null | grep -o -E 'squeal.mjs [a-z-]+' | head -1)
      [ -n "$s" ] && [ -n "$r" ] && echo "${d#/proc/} $s $r ${n:-other}" >> "$SAMPLES"
    fi
  done
}
alive() { sample; tail -n 50 "$SAMPLES" | grep -q 'daemon'; }
live() { n=0; for d in /proc/[0-9]*; do { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qx "HOME=$PH" && { tr '\0' ' ' < "$d/cmdline"; } 2>/dev/null | grep -q 'squeal.mjs daemon' && n=$((n+1)); done; echo $n; }
cpu_total() { awk '{last[$1]=$2} END {s=0; for (p in last) s+=last[p]; printf "%.1f", s/100}' "$SAMPLES"; }
wait_exit() { i=0; while [ $i -lt 900 ]; do sample; [ "$(live)" = 0 ] && break; sleep 1; i=$((i+1)); done; echo "  daemon gone after $i s; probe processes left: $(sh "$P/procs.sh" "$PH" x | tail -1); CPU so far $(cpu_total) s"; }
echo "== variant $V (restart, unusedExitMinutes 0.5)"
t0=$(ms); hook session-start SessionStart ',"source":"startup"' >/dev/null; t1=$(ms)
echo "SessionStart: $((t1 - t0)) ms"
$SQ status --wait 300000 >/dev/null 2>&1
wait_exit
n=1
for f in src/core/code/pass/order.ts src/core/lint/pass/held.ts src/core/code/pass/head.ts; do
  c0=$(cpu_total)
  printf '\nconst probeUnused%s = 1;\nexport function probeBranch%s(x: number): number { if (x > 1) return 1; return 0; }\n' $n $n >> "$f"
  t0=$(ms); hook post-tool-batch PostToolBatch > "$B/hook-$n.json"; t1=$(ms)
  sample
  t2=$(ms); $SQ status --wait 60000 "$f" > "$B/status-$n.txt" 2>&1; t3=$(ms)
  sample
  sleep 1; t4=$(ms); hook post-tool-batch PostToolBatch > "$B/hook-$n-next.json"; t5=$(ms)
  echo "edit $n ($f): PostToolBatch $((t1 - t0)) ms (daemon was down); status --wait $((t3 - t2)) ms; next PostToolBatch $((t5 - t4)) ms; load $(cut -d' ' -f1 /proc/loadavg)"
  echo "  hook: $(grep -o -E 'SQUEAL[^\\]*|Lint[^\\]*|Complexity[^\\]*' "$B/hook-$n.json" "$B/hook-$n-next.json" | tr '\n' '|' | cut -c1-400)"
  echo "  peak RSS while up: $(awk '$4 ~ /daemon/ {if ($3>m) m=$3} END {print int(m/1024)}' "$SAMPLES") MB daemon"
  wait_exit
  echo "  CPU for this edit, start to exit: $(echo "$(cpu_total) $c0" | awk '{printf "%.1f", $1-$2}') s"
  n=$((n+1))
done
$SQ stop >/dev/null 2>&1
