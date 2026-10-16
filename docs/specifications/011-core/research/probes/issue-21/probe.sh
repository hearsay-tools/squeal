#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#21. See README.md.
set -u
variant=${1:?negated|valid|brace}
cli=${SQUEAL_CLI:-$HOME/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs}
case $variant in
  negated) inputs='{ "a.test.mjs": ["!docs/**"] }' ;;
  valid) inputs='{ "a.test.mjs": ["docs/**"] }' ;;
  brace) inputs='{ "a.test.mjs": ["docs/**/*.{md,txt}"] }' ;;
  *) echo "unknown variant $variant" >&2; exit 2 ;;
esac
scratch=$(mktemp -d /tmp/squeal-issue21-XXXXXX)
repo=$scratch/repo
mkdir -p "$repo/docs" "$scratch/home"
cd "$repo" || exit 2
git init -q -b main .
printf 'import { test } from "node:test";\ntest("a", () => {});\n' > a.test.mjs
printf 'doc\n' > docs/x.md
printf '{ "name": "fixture", "private": true, "type": "module" }\n' > package.json
printf '{ "inputs": %s }\n' "$inputs" > squeal.config.json
git add -A && git -c user.name=probe -c user.email=probe@example.invalid commit -qm fixture
run() {
  echo "\$ squeal $*"
  env HOME="$scratch/home" XDG_CONFIG_HOME="$scratch/home/.config" XDG_DATA_HOME="$scratch/home/.local/share" \
    XDG_STATE_HOME="$scratch/home/.local/state" CODEX_HOME="$scratch/home/.codex" CLAUDE_CONFIG_DIR="$scratch/home/.claude" \
    timeout 60 node "$cli" "$@" 2>&1
  echo "[exit $?]"
  echo
}
echo "variant: $variant"
echo "cli: $cli"
echo "squeal.config.json: $(cat squeal.config.json)"
echo
run --version
run status
run status --json
run setup --check
run setup --plan --json
echo "store after: $(ls "$(git rev-parse --git-common-dir)/squeal" 2>&1)"
rm -rf "$scratch"
