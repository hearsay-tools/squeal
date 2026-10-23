#!/bin/sh
# 011-157 probe (throwaway): run a command with every home under /tmp/md157, nothing inherited but PATH (so no PLUGIN_ROOT, PLUGIN_DATA or SQUEAL_*), at nice 10.
S=/tmp/md157
exec env -i PATH="$PATH" HOME=$S/home XDG_RUNTIME_DIR=$S/xdg XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache XDG_DATA_HOME=$S/data XDG_STATE_HOME=$S/state TMPDIR=$S/tmp CODEX_HOME=$S/home/.codex npm_config_cache=$S/home/.npm PNPM_HOME=$S/home/.pnpm COREPACK_HOME=$S/home/.corepack nice -n 10 "$@"
