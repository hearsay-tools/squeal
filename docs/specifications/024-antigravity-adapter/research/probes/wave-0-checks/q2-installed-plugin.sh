#!/bin/sh
# Throwaway probe (row 024-01, Q2). Usage: q2-installed-plugin.sh <antigravity-binary> <work-dir>
# Builds a temp HOME under <work-dir> with only the CLI OAuth token symlinked (never read), installs
# ./logger-plugin, runs live turns, and walks disable / enable / reinstall / uninstall.
# Prints paths with the temp HOME rewritten to "~". Raw payloads stay in <work-dir>/hooks.log.
set -u
AG=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd)
TH=$W/home; WS=$W/ws; LOG=$W/hooks.log; MODEL=${MODEL:-gemini-3.8-flash-low}
rm -rf "$W"; mkdir -p "$TH/.gemini/antigravity-cli" "$WS"
ln -s "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" "$TH/.gemini/antigravity-cli/"
ag() { env HOME="$TH" XDG_CONFIG_HOME="$TH/.config" XDG_STATE_HOME="$TH/.local/state" \
  XDG_DATA_HOME="$TH/.local/share" XDG_CACHE_HOME="$TH/.cache" AG_PROBE_LOG="$LOG" "$AG" "$@"; }
tilde() { sed "s#$TH#~#g; s#$W#<work>#g"; }
state() {
  echo "-- config.json:"; cat "$TH/.gemini/config/config.json" 2>/dev/null | tilde; echo
  echo "-- plugins dir:"; ls "$TH/.gemini/config/plugins" 2>/dev/null
  echo "-- data dirs (find ~ -path '*sqprobe*' -prune):"
  find "$TH" -name '*sqprobe*' -prune -print 2>/dev/null | grep -v '/config/plugins/sqprobe$' | tilde
}
run() { (cd "$WS" && ag -p "$1" --model "$MODEL" --dangerously-skip-permissions \
  --output-format json --print-timeout 240s) >"$W/out-$2.json" 2>"$W/err-$2.txt"; echo "run $2 exit=$?"; }

(cd "$WS" && git init -q && git commit -q --allow-empty -m init)
echo "== 1 install"; ag plugin install "$HERE/logger-plugin" 2>&1 | tilde; state
echo "== plugin list --json"; ag plugin list --json 2>&1 | tilde
echo "== 2 live run (continue Stop once)"
AG_PROBE_CONTINUE=1; export AG_PROBE_CONTINUE
run "Create the file a.txt containing the line hello. Then edit a.txt to replace hello with world. Then run the shell command: cat a.txt. Then reply DONE." 1
unset AG_PROBE_CONTINUE
echo "-- PLUGIN_ROOT / PLUGIN_DATA seen by hooks:"
grep -o '"event":"[A-Za-z]*"\|"pwd":"[^"]*"\|"PLUGIN_ROOT":"[^"]*"\|"PLUGIN_DATA":"[^"]*"\|"PLUGIN_DATA_set":[a-z]*' "$LOG" | tilde | paste - - - - - | sort | uniq -c
state
echo "== 3 disable"; ag plugin disable sqprobe 2>&1 | tilde; state
ag plugin list --json 2>&1 | grep -E '"(name|enabled)"'
before=$(wc -l < "$LOG"); run "Reply OK." 2; echo "hook records while disabled: $(( $(wc -l < "$LOG") - before ))"
echo "== 4 enable"; ag plugin enable sqprobe 2>&1 | tilde; state
echo "== 5 reinstall in place (data kept?)"; sum=$(cat "$TH"/.gemini/*/*/sqprobe/seen 2>/dev/null | wc -l)
D=$(grep -o '"PLUGIN_DATA":"[^"]*"' "$LOG" | head -1 | cut -d'"' -f4); echo "seen lines before: $(wc -l < "$D/seen" 2>/dev/null)"
touch "$D/marker"; ag plugin install "$HERE/logger-plugin" 2>&1 | tilde; state
echo "PLUGIN_DATA after reinstall: $(ls "$D" 2>&1 | tr '\n' ' ')"
before=$(wc -l < "$LOG"); run "Reply OK." 3; echo "hook records after reinstall: $(( $(wc -l < "$LOG") - before ))"
grep -o '"PLUGIN_DATA":"[^"]*"' "$LOG" | sort | uniq -c | tilde
echo "== 6 uninstall"; ag plugin uninstall sqprobe 2>&1 | tilde; state
echo "PLUGIN_DATA after uninstall: $(ls "$D" 2>&1 | tr '\n' ' ' | tilde)"
echo "== 7 install again after uninstall"; ag plugin install "$HERE/logger-plugin" 2>&1 | tilde
echo "PLUGIN_DATA after reinstall-from-scratch: $(ls "$D" 2>&1 | tr '\n' ' ' | tilde)"
ag plugin uninstall sqprobe >/dev/null 2>&1
