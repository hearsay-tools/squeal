#!/bin/sh
# 015-14 Round 3: builds the A/B template, a clone of a release tag with its
# pnpm install and one commit of its own, and copies this folder's scripts and
# Round 2's fixed edit script beside it. Reads the repository; writes only
# under the base. The install is offline from the pnpm store at the tag's lock.
# Usage: setup.sh <repository> <tag> [base]
set -eu
repo=$1; tag=$2; B=${3:-/tmp/dogfood-015-14/w-d3937b73}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$B/bin" "$B/out" "$B/runs"
cp "$here"/* "$B/bin/"
cp "$here/../../part-b/bin/edits.json" "$B/bin/edits.json"
if [ ! -d "$B/tmpl" ]; then
  mkdir "$B/tmpl"
  git -C "$repo" archive "$tag" | tar -x -C "$B/tmpl"
  (cd "$B/tmpl" && pnpm install --frozen-lockfile --offline)
  git -C "$B/tmpl" init -q
  git -C "$B/tmpl" -c user.name=dogfood -c user.email=d@x add -A
  git -C "$B/tmpl" -c user.name=dogfood -c user.email=d@x -c commit.gpgsign=false \
    commit -qm "$tag ($(git -C "$repo" rev-parse --short "$tag^{commit}"))"
fi
node "$B/tmpl/plugins/claude-code/dist/cli/squeal.mjs" --version
