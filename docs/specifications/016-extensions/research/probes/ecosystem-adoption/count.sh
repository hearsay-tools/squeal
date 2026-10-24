#!/bin/bash
# Throwaway. Repeats the registry queries behind ../../ecosystem-adoption.md.
# Read-only HTTP GET/POST to public registries; writes only under /tmp/eco016.
set -euo pipefail
out=/tmp/eco016/probe
mkdir -p "$out"

# Terraform: totals per tier, then the top 100 by downloads.
for t in official partner community; do
  echo -n "$t "
  curl -s "https://registry.terraform.io/v2/providers?filter%5Btier%5D=$t&page%5Bsize%5D=1" | jq '.meta.pagination["total-count"]'
done
curl -s "https://registry.terraform.io/v2/providers?sort=-downloads&page%5Bsize%5D=100" > "$out/tf-top100.json"
jq -r '[.data[] | {t:.attributes.tier, d:.attributes.downloads}] | group_by(.t)
  | map({tier:.[0].t, n:length, downloads:(map(.d)|add)}) | .[] | "\(.tier)\t\(.n)\t\(.downloads)"' "$out/tf-top100.json"

# VS Code Marketplace: all extensions, then the Testing category by installs.
q() { curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=3.0-preview.1' -d "$1"; }
q '{"filters":[{"criteria":[{"filterType":8,"value":"Microsoft.VisualStudio.Code"},{"filterType":12,"value":"4096"}],"pageNumber":1,"pageSize":1,"sortBy":4,"sortOrder":0}],"assetTypes":[],"flags":0}' \
  | jq '.results[0].resultMetadata'
q '{"filters":[{"criteria":[{"filterType":8,"value":"Microsoft.VisualStudio.Code"},{"filterType":5,"value":"Testing"},{"filterType":12,"value":"4096"}],"pageNumber":1,"pageSize":50,"sortBy":4,"sortOrder":0}],"assetTypes":[],"flags":914}' \
  > "$out/vscode-testing-top50.json"

# npm keyword counts (self-declared keywords).
for k in eslint-plugin vite-plugin rollup-plugin prettier-plugin; do
  echo -n "$k "; curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:$k&size=1" | jq .total
done

# PyPI: top pytest plugins and where their repositories live.
curl -sL https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json -o "$out/top-pypi.json"
jq -r '.rows[] | select(.project|test("^pytest[-_]")) | [.project, .download_count]|@tsv' "$out/top-pypi.json" | head -15
