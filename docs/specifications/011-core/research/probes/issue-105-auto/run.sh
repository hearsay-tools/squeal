#!/bin/bash
# Throwaway research. No daemon, browser, network, or live SQLite connection.
set -euo pipefail
tree=$(cd "$1" && pwd)
cezar=$(cd "$2" && pwd)
base=$(mktemp -d /tmp/issue105-auto-XXXXXX)
trap 'rm -rf "$base"' EXIT
mkdir -p "$base"/{home,tmp,config,data,state,cache,run,codex,plugin,npm,pnpm,corepack}
chmod 700 "$base/run"
unset PLUGIN_ROOT PLUGIN_DATA
env -i PATH="$PATH" HOME="$base/home" USERPROFILE="$base/home" \
  XDG_CONFIG_HOME="$base/config" XDG_DATA_HOME="$base/data" \
  XDG_STATE_HOME="$base/state" XDG_CACHE_HOME="$base/cache" \
  XDG_RUNTIME_DIR="$base/run" TMPDIR="$base/tmp" TMP="$base/tmp" TEMP="$base/tmp" \
  CODEX_HOME="$base/codex" PLUGIN_DATA="$base/plugin" npm_config_cache="$base/npm" \
  PNPM_HOME="$base/pnpm" COREPACK_HOME="$base/corepack" \
  nice -n 10 bash -eu -c '
    git clone --quiet --shared "$1" "$3/squeal"
    git clone --quiet --shared "$2" "$3/cezar"
    # Include the uncommitted probe being developed, but execute only the clone copy.
    dest="$3/squeal/docs/specifications/011-core/research/probes/issue-105-auto"
    mkdir -p "$dest"
    cp "$1"/docs/specifications/011-core/research/probes/issue-105-auto/{run.sh,probe.py} "$dest/"
    python3 -I "$dest/probe.py" "$1" "$2" "$3" "$4"
  ' _ "$tree" "$cezar" "$base" "${3:-all}"
