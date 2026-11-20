# 011-416: 011-400's, work directory ~/work/8fdf8a51. Sourced by every probe step on the lab VM. Private HOME, config and runtime
# directory, so this probe shares no daemon pool, config or state with other
# agents' runs on the VM (the store is in the clone's .git/squeal anyway).
# SQ_REPO and SQ_CLI may be set by the caller: a Q4 clone copy, or the CLI
# copy with the patched backlog budget (README, "The budget patch").
export P="${P:-$HOME/work/8fdf8a51}"  # fixed once, so sourcing twice keeps it
export SQ_REPO="${SQ_REPO:-$P/squawk}"
export SQ_CLI="${SQ_CLI:-$P/squeal/plugins/claude-code/dist/cli/squeal.mjs}"
export SQ_PLUGIN="$P/squeal/plugins/claude-code"
export HOME="$P/home"
export XDG_CONFIG_HOME="$P/home/.config"
export XDG_STATE_HOME="$P/home/.local/state"
export XDG_RUNTIME_DIR="$P/xdg"
export OUT="$P/out"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$OUT"
chmod 700 "$XDG_RUNTIME_DIR"
sq() { node --disable-warning=ExperimentalWarning "$SQ_CLI" "$@"; }
cd "$SQ_REPO"
