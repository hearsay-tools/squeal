# Throwaway (row 020-38), sourced by the steps: released Squeal 0.1.451, a scratch
# HOME and TMPDIR, an empty environment otherwise (no session, no CI, no ~/.local/bin),
# on 8 vCPUs at nice 10 (Node and Vitest size their pools from the affinity: width 7).
R=${R:-/tmp/ndr}
HERE=${HERE:?set HERE to the probe directory}
CLEANPATH=$(printf %s "$PATH" | tr : '\n' | grep -v "/.local/bin" | paste -sd:)
sq() { nice -n 10 taskset -c 0-7 env -i PATH="$CLEANPATH" HOME="$R/home" TMPDIR="$R/tmp" LANG=C.UTF-8 \
  node --disable-warning=ExperimentalWarning "$R/squeal-0.1.451/dist/cli/squeal.mjs" "$@"; }
# The edit both clones get: one added function in TARGET, so the gate selects its loaders.
TARGET=${TARGET:-src/core/code/gate/estimate.ts}
edit() { printf '\nexport function ndrProbeEdit(): number {\n  return 1;\n}\n' >> "$1/$TARGET"; }
# One gate run: `squeal code --base HEAD --json`, timed, after guard.sh's load wait.
gate() { # clone name [timeout-seconds]
  ( cd "$1" || exit 1
    "$HERE/guard.sh" true 2> "$R/out/$2.err" || exit 99
    s=$(date +%s%N)
    sq code --base HEAD --json --timeout "${3:-1500}" > "$R/out/$2.json" 2>> "$R/out/$2.err"; rc=$?
    echo "exit $rc wall-ms $(( ($(date +%s%N) - s) / 1000000 )) load-1m-at-end $(cut -d' ' -f1 /proc/loadavg)" >> "$R/out/$2.err" )
  tail -1 "$R/out/$2.err"
}
