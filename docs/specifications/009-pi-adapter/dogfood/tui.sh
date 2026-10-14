#!/bin/sh
# Drives one Pi TUI in a tmux server private to the dogfood user (socket in dogfood-009/tmp).
#   tui.sh start <model> <cwd>   start pi in a 200x50 window
#   tui.sh send <text>           type text and press Enter
#   tui.sh key <tmux key>...     send raw keys (Escape, C-d, ...)
#   tui.sh shot <file>           append the visible screen to <file>, with time and load
#   tui.sh stop                  kill the tmux server
# Run through as-user.sh, so Pi gets the dogfood environment.
set -eu
D=/home/squeal-e2e/dogfood-009
S="$D/tmp/tmux.sock"
cmd=$1
shift
case $cmd in
start) tmux -S "$S" new-session -d -s tui -x 200 -y 50 -c "$2" "pi --model $1" ;;
send)
  tmux -S "$S" send-keys -t tui -l "$1"
  sleep 0.3
  tmux -S "$S" send-keys -t tui Enter
  ;;
key) tmux -S "$S" send-keys -t tui "$@" ;;
shot)
  { printf '\n===== %s load %s =====\n' "$(date +%T)" "$(cut -d' ' -f1 /proc/loadavg)"; tmux -S "$S" capture-pane -p -t tui; } >>"$1"
  ;;
stop) tmux -S "$S" kill-server ;;
esac
