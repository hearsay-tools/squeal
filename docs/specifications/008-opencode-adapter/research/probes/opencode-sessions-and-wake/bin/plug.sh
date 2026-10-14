#!/bin/sh
# Throwaway. `opencode plugin <local package> -g` in this probe's XDG dirs: what does it write, and does it load?
. "$(dirname "$0")/env.sh"
cd $W/repo
cp $XDG_CONFIG_HOME/opencode/opencode.jsonc /tmp/008s-before.jsonc 2>/dev/null
opencode plugin "file:$W/probe/cfgdir/pkg" -g </dev/null 2>&1 | tail -8
echo "== global config after:"; cat $XDG_CONFIG_HOME/opencode/opencode.json* 2>/dev/null
echo "== cache packages:"; find $XDG_CACHE_HOME/opencode/packages -maxdepth 3 2>/dev/null | head
export PROBE_LABEL=p1
opencode run -m $MODEL "Reply OK" </dev/null >/dev/null 2>&1
grep '"label":"p1"' $PROBE_LOG | grep pkg.init
