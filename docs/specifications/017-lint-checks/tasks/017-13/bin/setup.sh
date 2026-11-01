#!/bin/sh
# Throwaway probe for 017-13 (after 015-10 Part C's setup.sh). Not product code.
# The case root /home/squeal-e2e/runs/d1713, as squeal-e2e.
#   sh setup.sh <step>...
#     dirs     the case directories
#     pin      `git archive squeal--v0.1.390` of the Claude Code plugin and the marketplace
#              manifest into pin/, the marketplace renamed `hearsay` (005-18, 007-18)
#     bundles  git bundles: saas at b36f7150 (origin/release/next), svelte at 356c8766a
#     clone    both clones from the bundles, each on a local branch `dogfood` at its commit
#     deps     corepack pnpm install --frozen-lockfile in each clone (Node 24)
#     install  the plugin at user scope in the case's CLAUDE_CONFIG_DIR, the launcher as
#              bin/squeal, corepack's pnpm shims in bin/
#     lint-on  squeal.config.json with "lint": { "enabled": true }, committed on `dogfood`
# No model runs here.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/d1713
WT=$(cd "$here/../../../../../.." && pwd)
SAAS=/home/agent/projects/saas-bp-management-dashboard
SV=/tmp/dogfood-017-13/w-4a90e840/src/svelte
B=/tmp/dogfood-017-13/w-4a90e840/bundles
SAAS_COMMIT=b36f715091e8189674952ce804f764a101085c16
SV_COMMIT=356c8766a024d5982c276e898903fadaceaca960
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }

for step in "$@"; do
  echo "== $step $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    dirs)
      e2e mkdir -p "$R/home" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/pin" "$R/logs" "$R/corepack" "$R/pnpm-store"
      ;;
    pin)
      e2e rm -rf "$R/pin" && e2e mkdir "$R/pin"
      git -C "$WT" archive squeal--v0.1.390 plugins/claude-code .claude-plugin | e2e tar -x -C "$R/pin"
      e2e sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' "$R/pin/.claude-plugin/marketplace.json"
      e2e grep -h '"name"\|"version"' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/plugins/claude-code/.claude-plugin/plugin.json"
      ;;
    bundles)
      rm -f "$B/saas.bundle" "$B/svelte.bundle"
      [ "$(git -C "$SAAS" rev-parse refs/remotes/origin/release/next)" = "$SAAS_COMMIT" ] || { echo "saas release/next moved"; exit 1; }
      git -C "$SAAS" bundle create "$B/saas.bundle" refs/remotes/origin/release/next
      git -C "$SV" branch -f dogfood-base "$SV_COMMIT"
      git -C "$SV" bundle create "$B/svelte.bundle" dogfood-base
      chmod 644 "$B"/*.bundle
      git bundle verify "$B/saas.bundle" >/dev/null && git bundle verify "$B/svelte.bundle" >/dev/null && echo "verified"
      echo "saas $SAAS_COMMIT svelte $SV_COMMIT"
      ;;
    clone)
      for repo in saas svelte; do
        e2e rm -rf "$R/$repo"
        as . git init -q -b bundle-base "$repo"
        as "$repo" git fetch -q "$B/$repo.bundle" '+refs/*:refs/remotes/bundle/*'
        as "$repo" git config user.name dogfood
        as "$repo" git config user.email dogfood@squeal-e2e.invalid
      done
      as saas git checkout -q -b dogfood "$SAAS_COMMIT"
      as svelte git checkout -q -b dogfood "$SV_COMMIT"
      as saas git log --oneline -1
      as svelte git log --oneline -1
      ;;
    deps)
      E2E_NODE=24 as saas corepack pnpm install --frozen-lockfile --reporter=silent
      E2E_NODE=24 as svelte corepack pnpm install --frozen-lockfile --reporter=silent
      ;;
    install)
      e2e cp "$R/pin/plugins/claude-code/bin/squeal-launcher" "$R/bin/squeal"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/claude "$R/bin/claude"
      E2E_NODE=24 as . corepack enable --install-directory "$R/bin" pnpm
      as . claude plugin marketplace add "$R/pin"
      as . claude plugin install squeal@hearsay
      as . squeal --version
      as . claude --version
      ;;
    lint-on)
      for repo in saas svelte; do
        as "$repo" sh -c '[ ! -e squeal.config.json ] && printf "%s\n" "{" "  \"lint\": { \"enabled\": true }" "}" > squeal.config.json && git add squeal.config.json && git commit -q -m "dogfood 017-13: lint on" && git log --oneline -1'
      done
      ;;
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
