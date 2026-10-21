# Throwaway probe for research 011-53. Source with the scratch path: `. env.sh /tmp/dm-XXXXXX`.
# Sets the isolated environment for the daemon and for `sq`, the copied Squeal CLI.
S=$1
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
export DM_LOG=$S/log/inside.jsonl DM_CTL=$S/ctl
mkdir -p "$DM_CTL"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
sq() { (cd "$S/cezar" && node "$S/squeal/dist/cli/squeal.mjs" "$@"); }
# Starts the daemon detached, as a hook would, with the inside probe; writes its pid to
# $S/log/pid. Extra node flags come from $DM_NODE_FLAGS.
start_daemon() {
  # `exec` twice, so $! is the node process itself, not a wrapping shell.
  (cd "$S/cezar" && exec setsid node --expose-gc ${DM_NODE_FLAGS:-} --import "$HERE/inside.mjs" \
    "$S/squeal/dist/cli/squeal.mjs" daemon "$S/cezar" </dev/null >"$S/log/daemon.out" 2>&1) &
  echo $! >"$S/log/pid"
}
# Asks the inside probe for a command (gc, sample, mark-<label>) and waits until it ran.
ctl() { : >"$DM_CTL/$1"; while [ -e "$DM_CTL/$1" ]; do sleep 0.2; done; }
# Appends a comment to <file> (relative to the clone), then waits for Squeal's verdict on it
# through the copied CLI and this scratch's own socket. Logs label, wall ms and load to
# $S/log/edits.tsv and marks the inside log with <label>.
edit_and_wait() {
  local file=$1 label=$2 t0 t1
  t0=$(date +%s%3N)
  printf '\n// probe 011-53 %s\n' "$label" >>"$S/cezar/$file"
  sq status --wait 600000 "$file" >"$S/log/status-$label.txt" 2>&1 || true
  t1=$(date +%s%3N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%SZ)" "$label" "$file" "$((t1 - t0))" "$(cut -d' ' -f1 /proc/loadavg)" >>"$S/log/edits.tsv"
  ctl "mark-$label"
}
