#!/usr/bin/env bash
# Throwaway probe (005-05, question 3). A terminal setup on a fresh fixture with this commit's CLI:
# the warm-up's cost, whether its results survive the idle exit of a `squeal start` daemon, and the
# Codex trust step without a terminal, in the scratch HOME and CODEX_HOME of q1.sh.
# Usage: q3.sh <scratch> <pin> <q1 scratch>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd); Q1=$(cd "$3" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
unset $(env | grep -oE '^(CLAUDE|CEZ_|SQUEAL)[A-Z_]*' ) 2>/dev/null
export XDG_RUNTIME_DIR=$S/run; mkdir -p -m 0700 "$XDG_RUNTIME_DIR"
CLI=$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs
cli(){ node --disable-warning=ExperimentalWarning "$CLI" "$@"; }
ms(){ echo $(( $(date +%s%N)/1000000 )); }
q(){ node "$HERE/q.mjs" "$1" "$2 load $(cut -d' ' -f1 /proc/loadavg)"; }
cpu(){ for p in $(pgrep -f "squeal.mjs daemon $1"); do awk '{printf "  daemon pid %s cpu %.2f s\n", $1, ($14+$15+$16+$17)/100}' /proc/$p/stat; done; }
step(){ echo; echo "### $*"; }

step "warm-up on a fresh fixture: init, start, run --all --wait (daemon.idleExitMinutes 0.1 = 6 s)"
F=$S/F; "$HERE/mkfix.sh" "$F" "$CLI"
node -e 'const f=process.argv[1],c=require(f);c.daemon={idleExitMinutes:0.1};require("fs").writeFileSync(f,JSON.stringify(c,null,2))' "$F/squeal.config.json"
git -C "$F" commit -qam idle
cd "$F"; T=$(ms); cli start | head -1; echo "  start: $(( $(ms)-T )) ms"
cli run --all --wait | grep -E "^(Checkpoint|Known)"; echo "  start + run --all --wait: $(( $(ms)-T )) ms"; cpu "$F"; q "$F" "warm"
step "the daemon's idle exit, then the first session"
for i in $(seq 1 120); do pgrep -f "squeal.mjs daemon $F" >/dev/null || break; sleep 0.5; done; echo "  daemon gone after $(( $(ms)-T )) ms"
cli status | grep -E "idle|Daemon:" | head -2
node -e 'const j=require(process.argv[1]);j.cwd=process.argv[2];j.session_id="s-f1";process.stdout.write(JSON.stringify(j))' "$HERE/recorded/session-start.json" "$F" |
  CLAUDE_PROJECT_DIR=$F CLAUDE_PLUGIN_ROOT=$PIN/v72/plugins/claude-code node --disable-warning=ExperimentalWarning "$PIN/v72/plugins/claude-code/dist/session-start.mjs" | grep -oE "SQUEAL[^.]*\.[^.]*\." | head -1
sleep 4; cli status --wait 30000 | grep -E "^(Revision|Known|Full)"; q "$F" "after the session's daemon settled (runs unchanged = lookup hits)"
cli stop >/dev/null 2>&1; cd "$S"

step "Codex trust without a terminal (scratch HOME of q1, plugin 0.1.72 installed there)"
export HOME=$Q1/home CODEX_HOME=$Q1/home/.codex
G=$S/G; "$HERE/mkfix.sh" "$G" "$CLI"; cd "$G"
echo "  no --yes, stdin not a terminal:"; cli init --harness codex --trust < /dev/null 2>&1 | tail -3 | sed 's/^/    /'; echo "    exit $?"
echo "  --yes:"; T=$(ms); cli init --harness codex --trust --yes < /dev/null 2>&1 | tail -4 | sed 's/^/    /'; echo "    $(( $(ms)-T )) ms"
echo "  hooks.state keys now in the scratch config.toml: $(grep -c 'squeal@hearsay:hooks' "$CODEX_HOME/config.toml")"
echo "  again (idempotent):"; cli init --harness codex --trust --yes < /dev/null 2>&1 | tail -2 | sed 's/^/    /'
