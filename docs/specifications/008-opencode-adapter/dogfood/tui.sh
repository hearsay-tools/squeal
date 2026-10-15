#!/bin/sh
# Drives one OpenCode TUI in a tmux server private to the dogfood user (socket in dogfood-008/tmp).
#   tui.sh start <model> <cwd> [args]  start opencode in a 200x50 window
#   tui.sh send <text>                 type text and press Enter
#   tui.sh key <tmux key>...           send raw keys (Escape, C-c, ...)
#   tui.sh shot <file>                 append the visible screen to <file>, with time and load
#   tui.sh stop                        kill the tmux server
# Run through as-user.sh, so OpenCode gets the dogfood environment.
set -eu
D=/home/squeal-e2e/dogfood-008
S="$D/tmp/tmux.sock"
cmd=$1
shift
case $cmd in
start)
  m=$1 c=$2
  shift 2
  tmux -S "$S" new-session -d -s tui -x 200 -y 50 -c "$c" "opencode -m $m $*"
  ;;
send)
  tmux -S "$S" send-keys -t tui -l "$1"
  sleep 0.5
  tmux -S "$S" send-keys -t tui Enter
  ;;
key) tmux -S "$S" send-keys -t tui "$@" ;;
shot)
  { printf '\n===== %s load %s =====\n' "$(date +%T)" "$(cut -d' ' -f1 /proc/loadavg)"; tmux -S "$S" capture-pane -p -t tui; } >>"$1"
  ;;
stop) tmux -S "$S" kill-server ;;
esac
