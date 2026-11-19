#!/usr/bin/env bash
# Throwaway probe (row 011-408): one isolated `squeal status` call on the scratch clone.
# usage: S=<scratch> run.sh <566|567|main> <label> [extra node flags...] -- <status args...>
set -euo pipefail
: "${S:?scratch folder}"
ver=$1 label=$2; shift 2
nodeflags=(); while [ $# -gt 0 ] && [ "$1" != "--" ]; do nodeflags+=("$1"); shift; done; shift
cli=$S/bin/$ver/plugins/claude-code/dist/cli/squeal.mjs
out=$S/out/$ver; mkdir -p "$out" "$S/home" "$S/xdg/config" "$S/xdg/cache" "$S/xdg/data" "$S/xdg/state" "$S/xdg/run" "$S/tmp"
chmod 700 "$S/xdg/run"
case "$S/cezar/.git/squeal/store.sqlite" in */t/*) ;; *) echo "store not in scratch" >&2; exit 9;; esac
load=$(cut -d' ' -f1-3 /proc/loadavg)
cd "$S/cezar"
set +e
env -i PATH=/usr/bin:/bin HOME="$S/home" XDG_CONFIG_HOME="$S/xdg/config" XDG_CACHE_HOME="$S/xdg/cache" \
  XDG_DATA_HOME="$S/xdg/data" XDG_STATE_HOME="$S/xdg/state" XDG_RUNTIME_DIR="$S/xdg/run" TMPDIR="$S/tmp" ROWS_OUT="${ROWS_OUT:-/dev/null}" \
  timeout 180 /usr/bin/time -v -o "$out/$label.time" "$(command -v node)" "${nodeflags[@]}" "$cli" status "$@" \
  >"$out/$label.stdout" 2>"$out/$label.stderr"
code=$?
set -e
wall=$(grep 'Elapsed (wall' "$out/$label.time" | awk '{print $NF}')
user=$(grep 'User time' "$out/$label.time" | awk '{print $NF}')
sys=$(grep 'System time' "$out/$label.time" | awk '{print $NF}')
rss=$(grep 'Maximum resident' "$out/$label.time" | awk '{print $NF}')
echo "$ver $label exit=$code wall=$wall user=$user sys=$sys maxrss_kb=$rss load=[$load]" | tee -a "$S/out/runs.log"
