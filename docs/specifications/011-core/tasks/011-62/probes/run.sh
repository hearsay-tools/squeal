#!/usr/bin/env bash
# Throwaway probe for row 011-62 (gh-53). Usage: run.sh <checkout root>
# Runs the checkout's committed CLI bundle in a fresh repository under /tmp,
# with a scratch HOME and XDG_* and an otherwise empty environment.
set -u
CHECKOUT=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
CLI="$CHECKOUT/plugins/claude-code/dist/cli/squeal.mjs"
T=$(mktemp -d /tmp/sq62.XXXX)
mkdir -p "$T/home/.config" "$T/home/.state" "$T/home/.cache" "$T/home/.local/share" "$T/run"
chmod 700 "$T/run"
R="$T/repo"; cp -r "$HERE/fixture" "$R"; cd "$R" || exit 1
run() {
  env -i PATH="$PATH" HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" \
    XDG_STATE_HOME="$T/home/.state" XDG_CACHE_HOME="$T/home/.cache" \
    XDG_DATA_HOME="$T/home/.local/share" XDG_RUNTIME_DIR="$T/run" "$@"
}
g() { run git -c user.name=p -c user.email=p@p "$@"; }
sq() { echo "\$ squeal $*"; run node "$CLI" "$@" 2>&1; echo "[exit $?]"; }
config() { cat > squeal.config.json; g commit -qam "$1"; echo "== $1 (committed)"; sleep 3; }
g init -q -b main . && g add -A && g commit -qm init
echo "== load: $(cat /proc/loadavg) cpus: $(nproc)"
echo "== squeal $(run node "$CLI" --version) node $(node --version)"
sq start
sq run --all --wait

config "C1: keep's env PROBE_MODE a to b, include widened to more/*.test.mjs" <<'J'
{
  "nodeTest": [
    { "name": "keep", "cwd": "keep", "include": ["*.test.mjs", "more/*.test.mjs"], "env": { "PROBE_MODE": "b" } },
    { "name": "gone", "cwd": "gone", "include": ["*.test.mjs"] },
    { "name": "slow", "cwd": "slow", "include": ["*.test.mjs"] }
  ]
}
J
sq status --wait 30000

config "C2: project gone renamed gone2, same cwd and include" <<'J'
{
  "nodeTest": [
    { "name": "keep", "cwd": "keep", "include": ["*.test.mjs", "more/*.test.mjs"], "env": { "PROBE_MODE": "b" } },
    { "name": "gone2", "cwd": "gone", "include": ["*.test.mjs"] },
    { "name": "slow", "cwd": "slow", "include": ["*.test.mjs"] }
  ]
}
J
sq status --wait 30000
sq retry gone/gone.test.mjs --reason environment

config "C3: project added" <<'J'
{
  "nodeTest": [
    { "name": "keep", "cwd": "keep", "include": ["*.test.mjs", "more/*.test.mjs"], "env": { "PROBE_MODE": "b" } },
    { "name": "gone2", "cwd": "gone", "include": ["*.test.mjs"] },
    { "name": "slow", "cwd": "slow", "include": ["*.test.mjs"] },
    { "name": "added", "cwd": "added", "include": ["*.test.mjs"] }
  ]
}
J
sq status --wait 30000

echo "== edit slow's test file; its 8 s run starts"
echo "// touched" >> slow/slow.test.mjs; sleep 3
sq status
config "C4: project slow removed while its run is in flight" <<'J'
{
  "nodeTest": [
    { "name": "keep", "cwd": "keep", "include": ["*.test.mjs", "more/*.test.mjs"], "env": { "PROBE_MODE": "b" } },
    { "name": "gone2", "cwd": "gone", "include": ["*.test.mjs"] },
    { "name": "added", "cwd": "added", "include": ["*.test.mjs"] }
  ]
}
J
sq status --wait 30000 slow/slow.test.mjs
sq run --all --wait

echo "== restart the daemon on C4"
sq stop; sleep 2; sq start
sq run --all --wait
sq failures
sq retry slow/slow.test.mjs --reason environment

echo "== C5: squeal.config.json made invalid JSON (a trailing comma), daemon running"
sed -i 's/"added", "include": \["\*.test.mjs"\] }/"added", "include": ["*.test.mjs"] },/' squeal.config.json
g commit -qam "C5: invalid JSON"; sleep 3
sq status --wait 30000
echo "== restart the daemon on C5"
sq stop; sleep 2; sq start
sleep 5
sq status
sq stop
echo "== tmp: $T"
