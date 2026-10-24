#!/bin/sh
# Sparse-clones the two catalogues under /tmp and counts their tiers. Needs PyYAML.
set -e
S=${TMPDIR:-/tmp}/pm16-catalogues; rm -rf "$S"; mkdir -p "$S"; D=$(cd "$(dirname "$0")" && pwd)
git clone -q --depth 1 --branch v1.11.0 https://github.com/trunk-io/plugins.git "$S/trunk"
git clone -q --depth 1 --filter=blob:none --sparse --branch v10.1.0 https://github.com/oxsecurity/megalinter.git "$S/megalinter"
(cd "$S/megalinter" && git sparse-checkout set --no-cone /megalinter/descriptors/)
python3 -I "$D/trunk_tiers.py" "$S/trunk"
python3 -I "$D/megalinter_tiers.py" "$S/megalinter"
