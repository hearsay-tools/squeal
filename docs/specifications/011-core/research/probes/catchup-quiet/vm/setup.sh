#!/bin/bash
# setup.sh (011-416): on the VM, in ~/work/8fdf8a51 holding squawk.bundle,
# squeal-0.1.570.tgz and this directory as probe/. Unpacks Squeal 0.1.570 and
# makes two CLI copies whose only change is the catch-up quiet
# (CATCHUP_QUIET_MS, src/core/scheduler/quiet.ts): squeal-q60.mjs (60 s) and
# squeal-q30.mjs (30 s); squeal.mjs stays at 120 s. Clones squawk at
# c11e4edf0 (011-395 and 011-400's commit) and installs it as squawk's own
# packageManager does. No credentials are used.
set -e
P=$HOME/work/8fdf8a51; cd "$P"
mkdir -p squeal && tar -xzf squeal-0.1.570.tgz -C squeal
C=squeal/plugins/claude-code/dist/cli
for q in 60 30; do
  cp "$C/squeal.mjs" "$C/squeal-q$q.mjs"
  sed -i "s/CATCHUP_QUIET_MS = 12e4;/CATCHUP_QUIET_MS = ${q}e3;/" "$C/squeal-q$q.mjs"
  [ "$(grep -c "CATCHUP_QUIET_MS = ${q}e3;" "$C/squeal-q$q.mjs")" = 1 ] || { echo "patch $q failed"; exit 1; }
  diff "$C/squeal.mjs" "$C/squeal-q$q.mjs" || true
done
sha256sum "$C"/squeal*.mjs | tee "$P/sha256.txt"
git clone -q -b probe416 squawk.bundle squawk
cd squawk; git log --oneline -1
corepack pnpm@12.11.2 install --frozen-lockfile > "$P/install.log" 2>&1; tail -3 "$P/install.log"
