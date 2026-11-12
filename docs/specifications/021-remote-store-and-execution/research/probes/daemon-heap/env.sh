# Throwaway probe for research 021-27. Source with the scratch path and repo name:
#   . env.sh <scratch> <cezar|squeal>
# Sets the isolated environment for the daemon and for `sq`, the copied Squeal CLI.
S=$1 R=$2
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
export DH_LOG=$S/log DH_CTL=$S/ctl
mkdir -p "$DH_CTL"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
sq() { (cd "$S/$R" && node "$S/bundle/dist/cli/squeal.mjs" "$@"); }
# Starts the daemon detached, as a hook would, with the inside probe (also in its runner hosts,
# which take the daemon's execArgv); writes its pid to $S/log/pid.
start_daemon() {
  (cd "$S/$R" && exec setsid node --expose-gc ${DH_NODE_FLAGS:-} --import "$HERE/inside.mjs" \
    "$S/bundle/dist/cli/squeal.mjs" daemon "$S/$R" </dev/null >"$S/log/daemon.out" 2>&1) &
  # setsid forks, so $! is not the node pid: read it from the inside log once it starts.
  sleep 2; ls "$S/log"/daemon-*.jsonl | tail -1 | sed "s/.*daemon-//;s/.jsonl//" >"$S/log/pid"
}
# Asks the inside probe of <role> (daemon, host-vitest) for a command and waits until it ran.
ctl() { mkdir -p "$DH_CTL/$1"; : >"$DH_CTL/$1/$2"; while [ -e "$DH_CTL/$1/$2" ]; do sleep 0.2; done; }
load1() { cut -d' ' -f1 /proc/loadavg; }
# Appends a comment to <file>, then waits for Squeal's verdict through this scratch's socket.
# Logs utc, label, file, wall ms and load to $S/log/edits.tsv and marks both inside logs.
edit_and_wait() {
  local file=$1 label=$2 t0 t1
  t0=$(date +%s%3N)
  printf '\n// probe 021-27 %s\n' "$label" >>"$S/$R/$file"
  sq status --wait 600000 "$file" >"$S/log/status-$label.txt" 2>&1 || true
  t1=$(date +%s%3N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%SZ)" "$label" "$file" "$((t1 - t0))" "$(load1)" >>"$S/log/edits.tsv"
}
