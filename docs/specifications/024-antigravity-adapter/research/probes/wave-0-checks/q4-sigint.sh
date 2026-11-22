#!/bin/sh
# Throwaway probe (row 024-01, Q4): SIGINT to the CLI mid-turn; does Stop fire, and with which
# terminationReason? Usage: q4-sigint.sh <antigravity-binary> <work-dir>
set -u
AG=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd)
TH=$W/home; WS=$W/ws; LOG=$W/hooks.log; MODEL=${MODEL:-gemini-3.8-flash-low}
rm -rf "$W"; mkdir -p "$TH/.gemini/antigravity-cli" "$WS"
ln -s "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" "$TH/.gemini/antigravity-cli/"
ag() { env HOME="$TH" XDG_CONFIG_HOME="$TH/.config" XDG_STATE_HOME="$TH/.local/state" \
  XDG_DATA_HOME="$TH/.local/share" XDG_CACHE_HOME="$TH/.cache" AG_PROBE_LOG="$LOG" "$AG" "$@"; }
(cd "$WS" && git init -q && git commit -q --allow-empty -m init)
ag plugin install "$HERE/logger-plugin" >/dev/null 2>&1
(cd "$WS" && exec env HOME="$TH" AG_PROBE_LOG="$LOG" "$AG" -p "Run the shell command 'sleep 40' in the foreground, wait for it to finish, then reply DONE." \
  --model "$MODEL" --dangerously-skip-permissions --output-format json) >"$W/out.json" 2>"$W/err.txt" &
pid=$!
i=0; while [ $i -lt 60 ] && ! ls "$LOG.d" 2>/dev/null | grep -q .; do sleep 1; i=$((i+1)); done
sleep 12; kill -INT $pid; echo "sent SIGINT to $pid"; wait $pid; echo "exit=$?"; sleep 5
cat "$LOG.d"/*.json > "$LOG"; ag plugin uninstall sqprobe >/dev/null 2>&1
