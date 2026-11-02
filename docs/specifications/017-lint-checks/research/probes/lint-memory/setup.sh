#!/bin/sh
# Throwaway probe for research 017-26: the scratch, as it was made (2026-11-02).
# The clones come from dogfood 017-13's bundles in /tmp/dogfood-017-13/w-4a90e840/bundles
# (saas at b36f7150, Svelte at 356c8766a); the base commits are made again here, as
# 017-13's notes describe them. Installs use corepack's pinned pnpm and a store in the scratch.
set -e
S=/tmp/lint-memory-b8bcebbe B=/tmp/dogfood-017-13/w-4a90e840
mkdir -p $S/home $S/tmp $S/xdg-config $S/xdg-run $S/store $S/repos $S/squeal; chmod 700 $S/xdg-run
cp "$(dirname "$0")/env.sh" $S/env.sh; . $S/env.sh
cp -r plugins/claude-code/dist $S/squeal/          # the worktree's committed 0.1.391 bundle
cd $S/repos
git init -q saas; git -C saas fetch -q $B/bundles/saas.bundle 'refs/remotes/origin/release/next:refs/heads/base'
git -C saas checkout -q -b dogfood base
printf 'public-hoist-pattern[]=*eslint*\npublic-hoist-pattern[]=*prettier*\n' >saas/.npmrc
echo '{ "lint": { "enabled": true } }' >saas/squeal.config.json
git -C saas add .npmrc squeal.config.json; git -C saas -c user.email=p@x -c user.name=probe commit -q --no-verify -m "probe: lint on, eslint hoist"
git clone -q $B/bundles/svelte.bundle svelte; git -C svelte checkout -q -b dogfood origin/dogfood-base
echo '{ "lint": { "enabled": true } }' >svelte/squeal.config.json
(cd svelte && node $B/bin/svelte-warn.cjs && git add -A && git -c user.email=p@x -c user.name=probe commit -q --no-verify -m "probe: lint on, TODO rule warn")
# The untyped variant: projectService off and the two typed rules off.
git -C svelte checkout -q -b untyped
sed -i "s/projectService: true,/projectService: false,/; s/'@typescript-eslint\/await-thenable': 'error'/'@typescript-eslint\/await-thenable': 'off'/; s/'@typescript-eslint\/require-await': 'error'/'@typescript-eslint\/require-await': 'off'/" svelte/eslint.config.js
git -C svelte -c user.email=p@x -c user.name=probe commit -qam "probe: typed rules off" --no-verify; git -C svelte checkout -q dogfood
(cd saas && corepack pnpm install --frozen-lockfile && git checkout -- .)
(cd svelte && corepack pnpm install --frozen-lockfile)
