#!/bin/sh
# Runs as squeal-e2e (from the agent user: sudo -n -u squeal-e2e -H sh .../scripts/setup.sh).
# Makes the sandbox: HOME, TMPDIR and XDG directories, a bin/ holding only opencode (OpenCode
# 1.18.35 from squeal-e2e's npm prefix), OpenCode's global config with the cliproxy provider at
# the logging proxy (a placeholder key), and the remeda clone. Cezar's runner is copied by copy-cezar.sh.
set -eu
D=/home/squeal-e2e/dogfood-008
[ "$(id -un)" = squeal-e2e ] || { echo "setup.sh: must run as squeal-e2e" >&2; exit 1; }
mkdir -p "$D/home" "$D/tmp" "$D/xdg/config/opencode" "$D/xdg/data" "$D/xdg/cache" "$D/xdg/state" "$D/bin" "$D/src" "$D/logs"
ln -sfn /home/squeal-e2e/.npm-global/bin/opencode "$D/bin/opencode"
cp "$D/scripts/opencode.json" "$D/xdg/config/opencode/opencode.json"
if [ ! -d "$D/remeda" ]; then
  git clone -q --no-local /home/squeal-e2e/dogfood-009/home/remeda "$D/remeda"
  git -C "$D/remeda" checkout -q 8e6e78f6
  git -C "$D/remeda" remote set-url origin https://github.com/remeda/remeda.git
fi
sh "$D/scripts/as-user.sh" -C "$D/remeda" npm ci --no-audit --no-fund >"$D/logs/npm-ci.txt" 2>&1
echo "setup done: opencode $(sh "$D/scripts/as-user.sh" opencode --version), remeda $(git -C "$D/remeda" rev-parse --short HEAD)"
