#!/bin/sh
# From the agent user: copies the installed Cezar (0.16.0-dev.1634) unchanged into
# dogfood-008/cezar-source, its package and the hoisted node_modules beside it, for cezar-drive.mjs.
set -eu
N=$(npm root -g)/cezarion
C=$N/node_modules/@wjarka/cezarion
D=/home/squeal-e2e/dogfood-008/cezar-source
sudo -n -u squeal-e2e rm -rf "$D"
sudo -n -u squeal-e2e mkdir -p "$D/node_modules"
tar -C "$C" -cf - --exclude=node_modules . | sudo -n -u squeal-e2e tar -C "$D" -xf -
tar -C "$N/node_modules" -cf - --exclude=@wjarka . | sudo -n -u squeal-e2e tar -C "$D/node_modules" -xf -
sudo -n -u squeal-e2e sha256sum "$D/dist/core/opencode-server-runner.js"
