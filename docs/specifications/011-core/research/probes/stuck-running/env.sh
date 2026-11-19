# Source on the lab VM: isolated Squeal 0.1.563 for row 011-394.
# Own HOME and XDG dirs, so no socket, capacity pool or user config is shared
# with another agent's Squeal on the same machine.
export REAL_HOME=${REAL_HOME:-$HOME}
W=$REAL_HOME/work/011-394
export PATH=$W/bin:$REAL_HOME/.nvm/versions/node/v26.13.0/bin:$PATH
export HOME=$W/home XDG_RUNTIME_DIR=$W/run XDG_CACHE_HOME=$W/cache \
  XDG_CONFIG_HOME=$W/config XDG_STATE_HOME=$W/state XDG_DATA_HOME=$W/data
mkdir -p $W/bin $HOME $XDG_CACHE_HOME $XDG_CONFIG_HOME $XDG_STATE_HOME $XDG_DATA_HOME
mkdir -p -m 700 $XDG_RUNTIME_DIR
[ -x $W/bin/sq ] || printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning %s/squeal/dist/cli/squeal.mjs "$@"\n' $W > $W/bin/sq
chmod +x $W/bin/sq
FIX=$W/cezar
