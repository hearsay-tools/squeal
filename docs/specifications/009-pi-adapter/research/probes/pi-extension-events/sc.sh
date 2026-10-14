#!/usr/bin/env bash
# THROWAWAY research probe. Runs one scenario as the throwaway user squeal-e2e only:
#   sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... bash /home/squeal-e2e/pee/probe/sc.sh <scenario>
# Everything lives under /home/squeal-e2e/pee; Pi's agent dir is redirected there too.
set -u
[ "$(id -un)" = squeal-e2e ] || { echo "refusing: run as squeal-e2e" >&2; exit 2; }
W=/home/squeal-e2e/pee
P=$W/probe
SC=$1
OUT=$W/out/$SC
rm -rf "$OUT"; mkdir -p "$OUT/sessions"
export PI_CODING_AGENT_DIR=$W/agent PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
export PROBE_LOG=$OUT/probe.jsonl SQUEAL_PROBE_PARENT=inherited
PROJ=$W/proj
mkdir -p "$PROJ" "$PI_CODING_AGENT_DIR"
printf 'alpha\n' > "$PROJ/a.txt"; printf 'beta\n' > "$PROJ/b.txt"; rm -f "$PROJ/AGENTS.md" "$PROJ"/out.txt "$PROJ"/blocked.txt "$PROJ"/ok.txt
rm -rf "$PI_CODING_AGENT_DIR/skills"
cd "$PROJ"
BASE=(--provider fake --model fake-1 -e "$P/probe.ts" --session-dir "$OUT/sessions")
plan() { export PROBE_PLAN=$P/plans/$1.json; }
rpc() { node "$P/rpc-drive.mjs" "$P/steps/$1.json" "$OUT/rpc.jsonl" -- "${BASE[@]}" "${@:2}"; }
pp() { /usr/bin/time -f "wall=%e" pi "${BASE[@]}" "$@" </dev/null >"$OUT/stdout" 2>"$OUT/stderr"; echo "exit=$?" >>"$OUT/stderr"; }

case $SC in
  events-print) plan events; pp -p "probe the environment" ;;
  events-json) plan events; pp --mode json -p "probe the environment" ;;
  events-rpc) plan events; rpc two-prompts ;;
  inject) plan inject; PROBE_FLAGS=inject_tool_result,inject_turn_end,inject_steer,inject_context pp -p "inject" ;;
  inject-followup) plan inject; PROBE_FLAGS=inject_followup pp -p "inject" ;;
  inject-nextturn) plan inject; PROBE_FLAGS=inject_nextturn rpc two-prompts ;;
  inject-turnend-only) plan inject; PROBE_FLAGS=inject_turn_end pp -p "inject" ;;
  parallel2) plan parallel2; PROBE_FLAGS=inject_tool_result,inject_turn_end pp -p "parallel" ;;
  parallel) plan parallel; PROBE_FLAGS=inject_tool_result,inject_turn_end,inject_steer pp -p "parallel" ;;
  deny) plan deny; PROBE_FLAGS=deny_once pp -p "deny" ;;
  settle-silent) plan texts; pp -p "settle" ;;
  settle-once-print) plan texts; PROBE_FLAGS=settle_once pp -p "settle" ;;
  settle-once-json) plan texts; PROBE_FLAGS=settle_once pp --mode json -p "settle" ;;
  settle-once-rpc) plan texts; PROBE_FLAGS=settle_once rpc two-prompts ;;
  settle-entry-only) plan texts; PROBE_FLAGS=settle_entry_only pp -p "settle" ;;
  settle-always) plan texts; PROBE_FLAGS=settle_always timeout 30 pi "${BASE[@]}" -p "loop" </dev/null >"$OUT/stdout" 2>"$OUT/stderr"; echo "exit=$?" >>"$OUT/stderr" ;;
  settle-abort) plan abort; PROBE_FLAGS=settle_once,inject_turn_end rpc abort ;;
  settle-eof) plan abort; PROBE_FLAGS=settle_once,inject_turn_end rpc eof ;;
  primer)
    plan texts
    printf 'AGENTSMD-project-instructions\n' > "$PROJ/AGENTS.md"
    mkdir -p "$PI_CODING_AGENT_DIR/skills/probe-skill"
    printf -- '---\nname: probe-skill\ndescription: SKILLMARK-description of the probe skill\n---\nSKILLMARK-body\n' > "$PI_CODING_AGENT_DIR/skills/probe-skill/SKILL.md"
    PROBE_FLAGS=primer_section,primer_message,compact_custom rpc primer --append-system-prompt "APPENDSP-appended" ;;
  primer-big) plan texts; PROBE_PRIMER_PAD=${PAD:-200000} PROBE_FLAGS=primer_section pp -p "big" ;;
  throw-print) plan onetool; PROBE_THROW=session_start,before_agent_start,turn_end,tool_result,agent_before_settle,agent_end,context pp -p "throw" ;;
  throw-rpc) plan onetool; PROBE_THROW=session_start,before_agent_start,turn_end,tool_result,agent_before_settle,agent_end,context rpc one-prompt ;;
  throw-toolcall) plan onetool; PROBE_THROW=tool_call pp -p "throw" ;;
  slow) plan onetool; PROBE_SLOW=tool_result:3000,turn_end:2000 pp -p "slow" ;;
  hang-rpc) plan onetool; PROBE_HANG=tool_result rpc hang ;;
  timing)
    plan timing
    node "$P/sock-server.mjs" "$W/daemon.sock" & SRV=$!
    sleep 0.5
    for r in 1 2 3; do
      for f in none trivial socket; do
        PROBE_QUIET=1 PROBE_LOG=$OUT/t-$f-$r.jsonl PROBE_SOCK=$W/daemon.sock PROBE_FLAGS=$( [ $f = none ] || echo $f ) pi "${BASE[@]}" -p "time" </dev/null >/dev/null 2>>"$OUT/stderr"
      done
    done
    kill $SRV ;;
  tui)
    plan tui
    T="tmux -L pee"
    $T kill-server 2>/dev/null
    PROBE_FLAGS=inject_tool_result,inject_turn_end,inject_steer,settle_once $T new-session -d -s pee -x 150 -y 60 "TERM=xterm-256color pi ${BASE[*]}"
    sleep 6; $T send-keys -t pee "first prompt" Enter; sleep 5
    $T capture-pane -t pee -p -S -200 > "$OUT/screen1.txt"
    $T send-keys -t pee "second prompt" Enter; sleep 3; $T send-keys -t pee Escape; sleep 3
    $T capture-pane -t pee -p -S -200 > "$OUT/screen2.txt"
    $T send-keys -t pee C-c; sleep 1; $T send-keys -t pee C-c; sleep 2
    $T kill-server 2>/dev/null ;;
  nested)
    plan nested
    mkdir -p "$PI_CODING_AGENT_DIR/extensions"; cp "$P/probe.ts" "$PI_CODING_AGENT_DIR/extensions/probe.ts"
    pi --provider fake --model fake-1 --session-dir "$OUT/sessions" -p "parent" </dev/null >"$OUT/stdout" 2>"$OUT/stderr"
    rm -rf "$PI_CODING_AGENT_DIR/extensions" ;;
  socket-leak)
    plan onetool
    node "$P/sock-server.mjs" "$W/daemon.sock" & SRV=$!
    sleep 0.5
    PROBE_SOCK=$W/daemon.sock PROBE_FLAGS=socket_leak pp -p "leak"
    PROBE_SOCK=$W/daemon.sock PROBE_FLAGS=socket_leak rpc one-prompt
    kill $SRV ;;
  dead-daemon)
    plan onetool
    rm -f "$W/daemon.sock"
    PROBE_SOCK=$W/daemon.sock PROBE_FLAGS=socket pp -p "no daemon" ;;
  sessions-rpc) plan texts; rpc sessions ;;
  fork-rpc) plan texts; rpc fork ;;
  fork-cli)
    plan texts
    pi "${BASE[@]}" -p "first" </dev/null >"$OUT/stdout" 2>"$OUT/stderr"
    F=$(ls "$OUT"/sessions/*.jsonl | head -1)
    echo "forking $F" >>"$OUT/stderr"
    pi "${BASE[@]}" --fork "$F" -p "forked" </dev/null >>"$OUT/stdout" 2>>"$OUT/stderr"
    pi "${BASE[@]}" --session "$F" -p "resumed" </dev/null >>"$OUT/stdout" 2>>"$OUT/stderr"
    pi "${BASE[@]}" --continue -p "continued" </dev/null >>"$OUT/stdout" 2>>"$OUT/stderr" ;;
  *) echo "unknown scenario $SC" >&2; exit 2 ;;
esac
echo "scenario $SC finished" >&2
