#!/bin/bash
# setup.sh: on the VM, in ~/work/0d5248b3 holding squawk.bundle, one
# squeal-<arm>.tgz per arm and this directory as probe/. Unpacks each arm's
# plugin, clones squawk at c11e4edf0 (branch probe423) and installs it as
# squawk's own packageManager does. No credentials are used.
set -e
# Row 011-423: as 011-420's, the clone's branch renamed probe423.
P=$HOME/work/0d5248b3; cd "$P"
for t in squeal-*.tgz; do a=${t%.tgz}; mkdir -p "$a" && tar -xzf "$t" -C "$a"; done
sha256sum squeal-*/plugins/claude-code/dist/cli/squeal.mjs | tee "$P/sha256.txt"
git clone -q -b probe423 squawk.bundle squawk
cd squawk; git log --oneline -1
corepack pnpm@12.11.2 install --frozen-lockfile > "$P/install.log" 2>&1; tail -3 "$P/install.log"
