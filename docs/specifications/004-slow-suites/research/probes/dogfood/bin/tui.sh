#!/bin/sh
# An interactive Codex TUI session in a detached tmux session, so that after a turn the
# session stays registered and idle (codex exec ends its session, and the daemon exits
# 3 s later). Installed Squeal plugin, hooks as trusted in the real ~/.codex, no bypass flag.
# Usage: bin/tui.sh start <tmux name> <worktree> <prompt file>
#        bin/tui.sh send <tmux name> <prompt file>      (a follow-up prompt in the same session)
#        bin/tui.sh screen <tmux name>                  (print the visible pane)
#        bin/tui.sh quit <tmux name>
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
case $1 in
  start)
    echo "start $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" > "$here/logs/$2.times.txt"
    tmux new-session -d -s "$2" -x 220 -y 60 \
      "codex --no-alt-screen --no-daemon -C '$3' -s danger-full-access -a never -m gpt-6.1-sol \"\$(cat '$4')\"" ;;
  send)
    echo "send $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg) $3" >> "$here/logs/$2.times.txt"
    tmux send-keys -t "$2" -l "$(tr '\n' ' ' < "$3")"
    sleep 1
    tmux send-keys -t "$2" Enter ;;
  screen) tmux capture-pane -p -t "$2" ;;
  quit)
    echo "quit $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$here/logs/$2.times.txt"
    tmux send-keys -t "$2" C-c; sleep 1; tmux send-keys -t "$2" C-c; sleep 2
    tmux kill-session -t "$2" 2>/dev/null || true ;;
esac
