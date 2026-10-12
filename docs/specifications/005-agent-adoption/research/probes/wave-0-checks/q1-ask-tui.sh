#!/bin/sh
# Throwaway (005-04, question 1): Claude Code's question tool inside a skill, interactive.
# A private tmux server (-L wave0) runs `claude` in fx/ask under the scratch homes; the
# script answers first-run screens with Enter, types /ask-probe, and captures the pane.
D=$(dirname "$0"); . "$D/env.sh"
T="tmux -L wave0"
cap() { sleep "$1"; echo "=== +$2 load $(load)"; $T capture-pane -p -t s | sed '/^\s*$/d' | tail -40; }
echo "$(date -Is) cc7-ask-tui claude start load $(load)" | tee -a "$W/logs/sessions.txt"
$T new-session -d -s s -x 160 -y 50 -c "$W/fx/ask" "env PATH='$PATH' HOME='$HOME' CLAUDE_CONFIG_DIR='$CLAUDE_CONFIG_DIR' XDG_RUNTIME_DIR='$XDG_RUNTIME_DIR' DISABLE_AUTOUPDATER=1 claude --model claude-haiku-5-5 --effort low --permission-mode acceptEdits"
cap 8 start
for i in 1 2 3 4; do
  if $T capture-pane -p -t s | grep -q 'Yes, I trust this folder'; then $T send-keys -t s Down Enter; cap 5 "trust answered (Down, Enter)";
  elif $T capture-pane -p -t s | grep -qiE 'theme|Press Enter|Yes, proceed|Use this API key'; then $T send-keys -t s Enter; cap 4 "first-run screen $i answered"; fi
done
$T send-keys -t s '/ask-probe' Enter
cap 20 asked
$T send-keys -t s Enter   # picks the highlighted option if a question is shown
cap 15 answered
echo "colour.txt: $(cat "$W/fx/ask/colour.txt" 2>/dev/null)"
$T send-keys -t s '/exit' Enter; sleep 3; $T kill-server 2>/dev/null
echo "$(date -Is) cc7-ask-tui claude end load $(load)" | tee -a "$W/logs/sessions.txt"
