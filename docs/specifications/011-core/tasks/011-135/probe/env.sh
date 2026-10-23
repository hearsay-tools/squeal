# Sourced by setup.sh and measure.sh (row 011-135). Every home, config, cache, runtime and temp
# directory lies under $S in /tmp, so nothing reaches the real HOME (memory: probe isolation).
# S is the scratch root, given as the first argument or D1_SCRATCH.
: "${S:?set S to the scratch root under /tmp}"
case "$S" in /tmp/*) ;; *) echo "S must lie under /tmp: $S"; exit 2 ;; esac
export HOME="$S/home"
export XDG_CONFIG_HOME="$S/xdg/config" XDG_CACHE_HOME="$S/xdg/cache"
export XDG_DATA_HOME="$S/xdg/data" XDG_STATE_HOME="$S/xdg/state"
export XDG_RUNTIME_DIR="$S/run" TMPDIR="$S/tmp"
export COREPACK_HOME="$S/corepack" npm_config_cache="$S/npm-cache"
export PNPM_HOME="$S/pnpm-home" npm_config_store_dir="$S/pnpm-store"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
# No inherited Squeal or harness markers reach the probe's processes.
unset SQUEAL_OBSERVE CEZ_TASK_ID CEZ_HANDOFF_FILE CEZ_ARTIFACTS_DIR
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" \
  "$TMPDIR" "$COREPACK_HOME" "$npm_config_cache" "$PNPM_HOME" "$npm_config_store_dir"
[ -d "$XDG_RUNTIME_DIR" ] || mkdir -m 700 "$XDG_RUNTIME_DIR"
REPO="$S/repo"
