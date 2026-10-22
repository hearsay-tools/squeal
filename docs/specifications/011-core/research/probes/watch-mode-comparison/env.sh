# Sourced: the scratch environment every tool runs in (011-119). Nothing reaches the real HOME,
# the live permit pool ($XDG_RUNTIME_DIR/squeal) or a live daemon.
export HOME=/tmp/wm119/home XDG_RUNTIME_DIR=/tmp/wm119/run XDG_CONFIG_HOME=/tmp/wm119/home/.config TMPDIR=/tmp/wm119/tmp
unset CLAUDECODE CEZ_HANDOFF_FILE CEZ_TASK_ID CEZ_ARTIFACTS_DIR SQUEAL_OBSERVE
for v in $(env | grep -o '^CEZ_[A-Z_]*'); do unset $v; done
