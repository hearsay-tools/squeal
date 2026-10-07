#!/usr/bin/env bash
# Throwaway Q2c: interactive TUI in tmux session w0c-tui, started in /tmp with -C <repo>/pkg/sub.
# Plugin hook trust and project trust are written to the scratch CODEX_HOME's config.toml (the
# user-layer file of that scratch home; ~/.codex is untouched). Ends with /exit.
set -e
B="$(cd "$(dirname "$0")" && pwd)"
bash "$B/q2-setup.sh" >/dev/null; export CODEX_HOME=/tmp/w0c/home-q2
{ echo; echo '[projects."/tmp/w0c/r-q2"]'; echo 'trust_level = "trusted"'; echo; echo '[hooks.state]'
  while read -r k h; do printf '"%s" = { trusted_hash = "%s" }\n' "$k" "$h"; done < /tmp/w0c/logs/q2-hashes.txt; } >> "$CODEX_HOME/config.toml"
rm -f /tmp/w0c/logs/q2-tui.jsonl
tmux kill-session -t w0c-tui 2>/dev/null || true
tmux new-session -d -s w0c-tui -x 200 -y 50 -c /tmp \
  "env CODEX_HOME=$CODEX_HOME W0C_LOG=/tmp/w0c/logs/q2-tui.jsonl codex -C /tmp/w0c/r-q2/pkg/sub"
sleep 8; tmux send-keys -t w0c-tui 'Run `pwd` with your shell tool, once, and reply with its output only.'; sleep 1; tmux send-keys -t w0c-tui Enter
for i in $(seq 60); do sleep 3; grep -q '"label":"Stop"' /tmp/w0c/logs/q2-tui.jsonl 2>/dev/null && break; done
sleep 2; tmux capture-pane -p -t w0c-tui | grep -v '^\s*$' | tail -8
tmux send-keys -t w0c-tui '/exit'; sleep 1; tmux send-keys -t w0c-tui Enter; sleep 4
tmux kill-session -t w0c-tui 2>/dev/null && echo "killed leftover session" || echo "tui exited"
