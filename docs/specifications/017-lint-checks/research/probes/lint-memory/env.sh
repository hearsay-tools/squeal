# Throwaway probe for research 017-26. The scratch's isolated environment, written by hand
# to <scratch>/env.sh and sourced by run-stages.sh and run-daemon.sh. S is the scratch.
S=/tmp/lint-memory-b8bcebbe
export HOME=$S/home TMPDIR=$S/tmp XDG_CONFIG_HOME=$S/xdg-config XDG_RUNTIME_DIR=$S/xdg-run \
  XDG_CACHE_HOME=$S/home/.cache XDG_DATA_HOME=$S/home/.local/share COREPACK_HOME=$S/home/.corepack \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_store_dir=$S/store CI=true
