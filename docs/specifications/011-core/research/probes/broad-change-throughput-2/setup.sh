#!/bin/bash
# setup.sh: on the VM, in ~/work/011-400 holding squawk.bundle,
# squeal-0.1.563.tgz and this directory as probe/. Unpacks Squeal 0.1.563,
# makes the CLI copy with the patched backlog budget (README, "The budget
# patch"), clones squawk at c11e4edf0 and installs it as squawk's own
# packageManager does. No credentials are used.
set -e
P=$HOME/work/011-400; cd "$P"
mkdir -p squeal && tar -xzf squeal-0.1.563.tgz -C squeal
C=squeal/plugins/claude-code/dist/cli
cp "$C/squeal.mjs" "$C/squeal-big.mjs"
sed -i 's/BACKLOG_TIER_BUDGET_MS = 12e4;/BACKLOG_TIER_BUDGET_MS = 36e5;/' "$C/squeal-big.mjs"
[ "$(grep -c 'BACKLOG_TIER_BUDGET_MS = 36e5;' "$C/squeal-big.mjs")" = 1 ] || { echo "patch failed"; exit 1; }
diff <(cat "$C/squeal.mjs") <(cat "$C/squeal-big.mjs") || true
sha256sum "$C/squeal.mjs" "$C/squeal-big.mjs" | tee "$P/sha256.txt"
git clone -q -b probe400 squawk.bundle squawk
cd squawk; git log --oneline -1
corepack pnpm@12.11.2 install --frozen-lockfile > "$P/install.log" 2>&1; tail -3 "$P/install.log"
