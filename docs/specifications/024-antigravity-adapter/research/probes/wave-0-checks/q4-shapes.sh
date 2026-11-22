#!/bin/sh
# Throwaway probe (row 024-01, Q4). Usage: q4-shapes.sh <antigravity-binary> <work-dir>
# Same temp HOME as q2 (only the OAuth token symlinked). Turn A starts a background subagent and
# ends before it finishes (fullyIdle false); turn B is cut by --print-timeout mid-command.
set -u
AG=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd)
TH=$W/home; WS=$W/ws; LOG=$W/hooks.log; MODEL=${MODEL:-gemini-3.8-flash-low}
rm -rf "$W"; mkdir -p "$TH/.gemini/antigravity-cli" "$WS"
ln -s "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" "$TH/.gemini/antigravity-cli/"
ag() { env HOME="$TH" XDG_CONFIG_HOME="$TH/.config" XDG_STATE_HOME="$TH/.local/state" \
  XDG_DATA_HOME="$TH/.local/share" XDG_CACHE_HOME="$TH/.cache" AG_PROBE_LOG="$LOG" "$AG" "$@"; }
(cd "$WS" && git init -q && git commit -q --allow-empty -m init)
ag plugin install "$HERE/logger-plugin" >/dev/null 2>&1 && echo installed
echo "== A: background subagent"
(cd "$WS" && ag -p "Start one subagent with invoke_subagent (type research) whose task is: run the shell command 'sleep 25' and then report the word FINISHED. Do not wait for it; as soon as it has started, reply STARTED and end your turn." \
  --model "$MODEL" --dangerously-skip-permissions --output-format json --print-timeout 180s) >"$W/out-A.json" 2>"$W/err-A.txt"; echo "A exit=$?"
echo "== B: print-timeout during a command"
(cd "$WS" && ag -p "Run the shell command 'sleep 60' and wait for it, then reply DONE." \
  --model "$MODEL" --dangerously-skip-permissions --output-format json --print-timeout 15s) >"$W/out-B.json" 2>"$W/err-B.txt"; echo "B exit=$?"
sleep 5
cat "$LOG.d"/*.json > "$LOG"
ag plugin uninstall sqprobe >/dev/null 2>&1
