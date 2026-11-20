# Sourced by every probe step on the lab VM (row 011-413; 011-400's, with the
# work directory ~/work/796e796e and one Squeal bundle per arm: ARM=base, a,
# b, c, d or cd picks $P/squeal-$ARM, built from 0.1.570 plus that arm's patch).
# Private HOME, config and runtime directory, so this probe shares no daemon
# pool, config or state with other agents' runs on the VM.
export P="${P:-$HOME/work/796e796e}"
export ARM="${ARM:-base}"
export SQ_REPO="${SQ_REPO:-$P/squawk}"
export SQ_PLUGIN="$P/squeal-$ARM/plugins/claude-code"
export SQ_CLI="$SQ_PLUGIN/dist/cli/squeal.mjs"
export HOME="$P/home"
export XDG_CONFIG_HOME="$P/home/.config"
export XDG_STATE_HOME="$P/home/.local/state"
export XDG_RUNTIME_DIR="$P/xdg"
export OUT="$P/out"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$OUT"
chmod 700 "$XDG_RUNTIME_DIR"
sq() { node --disable-warning=ExperimentalWarning "$SQ_CLI" "$@"; }
cd "$SQ_REPO"
