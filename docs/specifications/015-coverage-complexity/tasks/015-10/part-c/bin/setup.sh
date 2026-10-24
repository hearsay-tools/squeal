#!/bin/sh
# Throwaway probe for 015-10 Part C: the case root /home/squeal-e2e/runs/d1510, as squeal-e2e.
#   sh setup.sh <step>...
#     dirs     the case directories
#     pin      `git archive squeal--v0.1.284` of the Claude Code plugin and the marketplace
#              manifest into pin/, the marketplace renamed `hearsay` (005-18, 007-18)
#     bundles  git bundles: squeal at origin/main, cezar at main (03c905a00), in /tmp
#     clone    both clones from the bundles, each on a local branch `dogfood` at its commit
#     deps     squeal: npm ci; cezar: corepack pnpm install --frozen-lockfile (Node 24)
#     install  the plugin at user scope in the case's CLAUDE_CONFIG_DIR, the launcher as
#              bin/squeal, corepack's pnpm shims in bin/
# No model runs here.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/d1510
WT=/home/agent/projects/squeal/.ai/cezar/worktrees/4ddd4e37-a86d-432a-9739-e2292f9332f4
CZ=/home/agent/projects/cezar
B=/tmp/dogfood-015-10/w-4ddd4e37/bundles
SQ_COMMIT=$(git -C "$WT" rev-parse origin/main)
CZ_COMMIT=03c905a00c449c7a6257e2d0d3c16383cd267743
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
      git -C "$WT" archive squeal--v0.1.284 plugins/claude-code .claude-plugin | e2e tar -x -C "$R/pin"
      e2e sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' "$R/pin/.claude-plugin/marketplace.json"
      e2e grep -h '"name"\|"version"' "$R/pin/.claude-plugin/marketplace.json" "$R/pin/plugins/claude-code/.claude-plugin/plugin.json"
      ;;
    bundles)
      rm -f "$B/squeal.bundle" "$B/cezar.bundle"
      git -C "$WT" bundle create "$B/squeal.bundle" origin/main
      [ "$(git -C "$CZ" rev-parse main)" = "$CZ_COMMIT" ] || { echo "cezar main moved"; exit 1; }
      git -C "$CZ" bundle create "$B/cezar.bundle" main
      chmod 644 "$B"/*.bundle
      echo "squeal $SQ_COMMIT cezar $CZ_COMMIT"
      ;;
    clone)
      for repo in squeal cezar; do
        e2e rm -rf "$R/$repo"
        as . git init -q -b bundle-base "$repo"
        as "$repo" git fetch -q "$B/$repo.bundle" '+refs/*:refs/remotes/bundle/*'
        as "$repo" git config user.name dogfood
        as "$repo" git config user.email dogfood@squeal-e2e.invalid
      done
      as squeal git checkout -q -b dogfood "$SQ_COMMIT"
      as cezar git checkout -q -b dogfood "$CZ_COMMIT"
      as squeal git log --oneline -1
      as cezar git log --oneline -1
      ;;
    deps)
      E2E_NODE=24 as squeal npm ci --no-audit --no-fund --loglevel=error
      E2E_NODE=24 as cezar corepack pnpm install --frozen-lockfile --reporter=silent
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
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
