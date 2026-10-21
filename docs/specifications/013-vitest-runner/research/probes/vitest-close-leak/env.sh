# Throwaway probe for research 013-05. Source with the scratch and the project directory in it:
#   . env.sh /tmp/vcl-d-XXXXXX fixture|cezar
# Sets the isolated environment (HOME, XDG_*, TMPDIR under the scratch) for the research's own
# daemon and for `sq`, the copied Squeal CLI. Never reaches a live daemon's socket or store.
S=$1 PROJ=$S/$2
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
export VCL_LOG=$S/log/inside.jsonl VCL_CTL=$S/ctl VCL_SNAP_DIR=$S/snap
mkdir -p "$VCL_CTL" "$VCL_SNAP_DIR"
VCL_HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
sq() { (cd "$PROJ" && node "$S/squeal/dist/cli/squeal.mjs" "$@"); }
# Starts the daemon detached, as a hook would, with the inside probe; its pid in $S/log/pid.
start_daemon() {
  (cd "$PROJ" && exec setsid node --expose-gc --import "$VCL_HERE/inside.mjs" \
    "$S/squeal/dist/cli/squeal.mjs" daemon "$PROJ" </dev/null >"$S/log/daemon.out" 2>&1) &
  echo $! >"$S/log/pid"
}
# Asks the inside probe for a command and waits until it ran.
ctl() { : >"$VCL_CTL/$1"; while [ -e "$VCL_CTL/$1" ]; do sleep 0.3; done; }
load1() { cut -d' ' -f1 /proc/loadavg; }
# Waits until the one-minute load is below 24 (the brief's rule), checking every 20 s.
wait_load() { while awk '{exit !($1 >= 24)}' /proc/loadavg; do sleep 20; done; }
# Appends a comment to <file>, then waits for Squeal's verdict on <wait-file> (default: <file>).
edit_and_wait() {
  local file=$1 label=$2 waitfile=${3:-$1} t0 t1
  t0=$(date +%s%3N)
  printf '\n// probe 013-05 %s\n' "$label" >>"$PROJ/$file"
  sq status --wait 600000 "$waitfile" >"$S/log/status-$label.txt" 2>&1 || true
  t1=$(date +%s%3N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%SZ)" "$label" "$file" "$((t1 - t0))" "$(load1)" >>"$S/log/edits.tsv"
}
