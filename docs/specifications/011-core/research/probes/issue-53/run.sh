#!/usr/bin/env bash
# Throwaway probe for issue 53. Usage: run.sh <checkout root>
set -u
CHECKOUT=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
CLI="$CHECKOUT/plugins/claude-code/dist/cli/squeal.mjs"
T=$(mktemp -d /tmp/sq53.XXXX)
export HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_STATE_HOME="$T/home/.state" XDG_RUNTIME_DIR="$T/run"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
R="$T/repo"; cp -r "$HERE/fixture" "$R"; cd "$R"
git init -q -b main . && git -c user.name=p -c user.email=p@p add -A && git -c user.name=p -c user.email=p@p commit -qm init
sq() { echo "\$ squeal $*"; node "$CLI" "$@" 2>&1; echo "[exit $?]"; }
echo "== load: $(cat /proc/loadavg) cpus: $(nproc)"; echo "== squeal $(node "$CLI" --version) node $(node --version)"
sq start
sq run --all --wait
sq status
echo "== remove project gone from squeal.config.json"
cat > squeal.config.json <<'J'
{
  "nodeTest": [
    { "name": "keep", "cwd": "keep", "include": ["*.test.mjs"] }
  ]
}
J
git -c user.name=p -c user.email=p@p commit -qam "drop gone"
sleep 3
sq status --wait 30000
echo "== edit gone's test file (a revision touching only the removed project's file)"
echo "// touched" >> gone/gone.test.mjs; sleep 3
sq status --wait 30000
sq status --wait 30000 gone/gone.test.mjs
sq retry gone/gone.test.mjs --reason environment
sq status --wait 30000 gone/gone.test.mjs
sq run --all --wait
sq failures
echo "== restart the daemon on the new config"
sq stop; sleep 2; sq start
sq run --all --wait
sq status
sq retry gone/gone.test.mjs --reason environment
sq stop
echo "== tmp: $T"
