#!/usr/bin/env bash
# Throwaway probe (005-05, question 2 skew, question 3 warm-up). Two Squeal versions on one store:
# release 0.1.62 and this commit (0.1.72), CLIs and Claude Code hook bundles from `git archive`.
# Hooks are run as Claude Code runs them: node <bundle> with a recorded JSON input on stdin.
# Own XDG_RUNTIME_DIR, so sockets and the slow slot are this probe's. Usage: q2.sh <scratch> <pin>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
unset $(env | grep -oE '^(CLAUDE|CEZ_|SQUEAL)[A-Z_]*' ) 2>/dev/null
export XDG_RUNTIME_DIR=$S/run; mkdir -p -m 0700 "$XDG_RUNTIME_DIR"
cli(){ node --disable-warning=ExperimentalWarning "$PIN/v$1/plugins/claude-code/dist/cli/squeal.mjs" "${@:2}"; }
hook(){ # hook <62|72> <name> <fixture> <session>
  node -e 'const [f,cwd,s]=process.argv.slice(1);const j=require(f);j.cwd=cwd;j.session_id=s;process.stdout.write(JSON.stringify(j))' \
    "$HERE/recorded/$2.json" "$3" "$4" |
  (cd "$3" && CLAUDE_PROJECT_DIR=$3 CLAUDE_PLUGIN_ROOT=$PIN/v$1/plugins/claude-code \
    node --disable-warning=ExperimentalWarning "$PIN/v$1/plugins/claude-code/dist/$2.mjs") | head -c 600; echo; }
q(){ node "$HERE/q.mjs" "$1" "$2 t=$(( $(date +%s%N)/1000000 - T0 ))ms load $(cut -d' ' -f1 /proc/loadavg)"; }
step(){ echo; echo "### $*"; }
waitfor(){ for i in $(seq 1 ${3:-200}); do node "$HERE/q.mjs" "$1" x | grep -q "$2" && return 0; sleep 0.25; done; echo "  (timed out waiting for $2)"; }
alldone(){ for i in $(seq 1 400); do cli 72 status --json -C "$1" >/dev/null 2>&1; s=$(cd "$1" && cli 72 status 2>/dev/null | grep -c "pending\|running\|queued"); [ "$s" = 0 ] && return 0; sleep 0.25; done; }

step "A. warm-up from the terminal with the older CLI (0.1.62 start), then a newer (0.1.72) SessionStart"
A=$S/A; "$HERE/mkfix.sh" "$A" "$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs"; T0=$(( $(date +%s%N)/1000000 ))
(cd "$A" && cli 62 start | head -1); q "$A" "after start"
(cd "$A" && cli 62 status --wait 60000 | grep -E "^(Revision|Known)"); q "$A" "warm (status --wait)"
hook 72 session-start "$A" s-a1 | grep -oE "SQUEAL[^.]*\.[^.]*\." | head -2
waitfor "$A" "daemon 0.1.72"; q "$A" "after the 0.1.72 hook"
(cd "$A" && cli 72 status --wait 60000 | grep -E "^(Revision|Known)|superseded|stepped|step"); q "$A" "settled"
hook 72 session-end "$A" s-a1 >/dev/null; sleep 4; q "$A" "3 s after SessionEnd"

step "A2. step-down while a tier runs: 0.1.62 daemon, run --all --force (one 8 s file), then a 0.1.72 hook mid-tier"
A2=$S/A2; "$HERE/mkfix.sh" "$A2" "$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs"
sed -i 's/sleep(2500)/sleep(8000)/; s/10000);/20000);/' "$A2/test/integration.test.js"; git -C "$A2" commit -qam slow; T0=$(( $(date +%s%N)/1000000 ))
(cd "$A2" && cli 62 start >/dev/null && cli 62 status --wait 60000 | grep -E "^Known"); q "$A2" "warm"
(cd "$A2" && cli 62 run --all --force | head -1); sleep 1.5; q "$A2" "tier in flight"
hook 72 session-start "$A2" s-a2 | grep -oE "SQUEAL[^.]*\." | head -1; q "$A2" "hook returned"
waitfor "$A2" "daemon 0.1.72" 200; q "$A2" "successor serving"
(cd "$A2" && cli 72 status --wait 60000 | grep -E "^(Revision|Known|Full)"); q "$A2" "settled"
(cd "$A2" && cli 72 status | grep -iE "superseded|newer|step" | head -3)
hook 72 session-end "$A2" s-a2 >/dev/null

step "B. newer CLI's daemon (0.1.72 start) under an older (0.1.62) session"
B=$S/B; "$HERE/mkfix.sh" "$B" "$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs"; T0=$(( $(date +%s%N)/1000000 ))
(cd "$B" && cli 72 start >/dev/null && cli 72 status --wait 60000 | grep -E "^Known"); q "$B" "warm, 0.1.72"
hook 62 session-start "$B" s-b1 | grep -oE "SQUEAL[^.]*\.[^.]*\." | head -2; sleep 2; q "$B" "after the 0.1.62 hook"
sed -i 's/return a + b/return a + b + 1/; s/\* 100)/* 100 + 1)/' "$B/src/money.js"; sleep 0.3
(cd "$B" && cli 62 status --wait 60000 | grep -E "^(Revision|Known)"); q "$B" "after an edit, 0.1.62 status"
hook 62 post-tool-batch "$B" s-b1 | head -c 300; echo
git -C "$B" checkout -q src/money.js
hook 62 session-end "$B" s-b1 >/dev/null; sleep 4; q "$B" "3 s after SessionEnd"

step "C. a store schema newer than both (user_version + 1 on a copy of B's store)"
C=$S/C; cp -r "$B" "$C"; (cd "$C" && cli 72 stop >/dev/null 2>&1); rm -rf "$C/.git/squeal/locks"
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);const v=d.prepare("PRAGMA user_version").get().user_version;d.exec("PRAGMA user_version="+(v+1));console.log("  user_version",v,"->",v+1)' "$C/.git/squeal/store.sqlite"
for v in 62 72; do echo "  0.1.$v status: $(cd "$C" && cli $v status 2>&1 | head -2 | tr '\n' ' ')"; done
hook 62 session-start "$C" s-c1 | head -c 300; echo

step "cleanup"
for f in "$A" "$A2" "$B" "$C"; do (cd "$f" && cli 72 stop >/dev/null 2>&1); done; sleep 1
pgrep -af "squeal.mjs daemon $S" || echo "  no probe daemon left"
